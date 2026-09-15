"""
Normalisiert Audiodateien auf -23 LUFS (integrated loudness) nach dem
EBU-R128-Standard — dem in Rundfunk/Radio üblichen Zielwert.

Läuft zweistufig über ffmpegs loudnorm-Filter:
  1. Messung (Pass 1): ffmpeg misst die tatsächliche Lautheit der Datei.
  2. Anwendung (Pass 2): ffmpeg wendet mit den gemessenen Werten eine
     lineare Korrektur an ("linear=true") statt der ungenaueren
     Ein-Pass-Dynamikkompression -> deutlich genaueres Ergebnis.

Die Datei wird NACH erfolgreicher Normalisierung an Ort und Stelle
ersetzt (über eine temporäre Datei + atomarem os.replace, damit bei
einem Absturz mitten im Vorgang nie eine kaputte halbe Datei liegen
bleibt). ID3/Vorbis/etc-Tags werden vorher ausgelesen und danach wieder
geschrieben, falls ffmpegs eigene Metadaten-Übernahme (-map_metadata)
mal nicht vollständig greift.
"""

import os
import json
import re
import shutil
import subprocess
import tempfile
import threading
import time

from mutagen import File as MutagenFile

from . import config
from .db import get_db

TARGET_LUFS = -23.0
TARGET_TP = -1.5
TARGET_LRA = 11.0

_ENCODERS = {
    ".mp3": ("libmp3lame", "192k"),
    ".m4a": ("aac", "192k"),
    ".aac": ("aac", "192k"),
    ".ogg": ("libvorbis", "192k"),
    ".flac": ("flac", None),
    ".wav": ("pcm_s16le", None),
}

_lock = threading.Lock()
_cancel_event = threading.Event()
_thread = None

_state = {
    "status": "idle",
    "total": 0,
    "processed": 0,
    "succeeded": 0,
    "failed": 0,
    "current_path": "",
    "errors": [],
    "started_at": None,
    "finished_at": None,
}


def get_status() -> dict:
    with _lock:
        return {**_state, "errors": list(_state["errors"])}


def _set_state(**kwargs):
    with _lock:
        _state.update(kwargs)


class NormalizeError(Exception):
    pass


def _get_bitrate_kbps(full_path: str, ext: str) -> str:
    try:
        audio = MutagenFile(full_path)
        bitrate = int(getattr(audio.info, "bitrate", 0) or 0)
        if bitrate > 0:
            return f"{max(bitrate // 1000, 64)}k"
    except Exception:
        pass
    return _ENCODERS.get(ext, ("libmp3lame", "192k"))[1] or "192k"


def _measure_loudness(full_path: str) -> dict:
    cmd = [
        "ffmpeg", "-hide_banner", "-nostats", "-i", full_path,
        "-af", f"loudnorm=I={TARGET_LUFS}:TP={TARGET_TP}:LRA={TARGET_LRA}:print_format=json",
        "-f", "null", "-",
    ]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=300)
    match = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", proc.stderr)
    if not match:
        raise NormalizeError("Lautheit konnte nicht gemessen werden (ffmpeg-Ausgabe nicht erkannt).")
    return json.loads(match.group(0))


def normalize_file(rel_path: str) -> None:
    """Normalisiert EINE Datei auf TARGET_LUFS. Wirft NormalizeError bei
    Problemen (nicht unterstütztes Format, ffmpeg-Fehler, ...).
    """
    ext = os.path.splitext(rel_path)[1].lower()
    if ext not in _ENCODERS:
        raise NormalizeError(f"Format {ext} wird für die Normalisierung nicht unterstützt.")

    full_path = os.path.join(config.MUSIC_ROOT, rel_path)
    if not os.path.isfile(full_path):
        raise NormalizeError("Datei nicht gefunden.")

    codec, default_bitrate = _ENCODERS[ext]
    bitrate = _get_bitrate_kbps(full_path, ext) if default_bitrate else None

    measured = _measure_loudness(full_path)

    loudnorm_filter = (
        f"loudnorm=I={TARGET_LUFS}:TP={TARGET_TP}:LRA={TARGET_LRA}:"
        f"measured_I={measured['input_i']}:measured_TP={measured['input_tp']}:"
        f"measured_LRA={measured['input_lra']}:measured_thresh={measured['input_thresh']}:"
        f"offset={measured['target_offset']}:linear=true:print_format=summary"
    )

    fd, tmp_path = tempfile.mkstemp(suffix=ext, dir=os.path.dirname(full_path))
    os.close(fd)

    try:
        cmd = [
            "ffmpeg", "-y", "-hide_banner", "-nostats", "-i", full_path,
            "-af", loudnorm_filter,
            "-map_metadata", "0", "-c:a", codec,
        ]
        if bitrate:
            cmd += ["-b:a", bitrate]
        if ext == ".mp3":
            cmd += ["-id3v2_version", "3"]
        cmd.append(tmp_path)

        try:
            original_tags = dict(MutagenFile(full_path, easy=True) or {})
        except Exception:
            original_tags = {}

        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=600)
        if proc.returncode != 0 or not os.path.exists(tmp_path) or os.path.getsize(tmp_path) == 0:
            raise NormalizeError(f"ffmpeg-Fehler: {proc.stderr.strip()[-400:]}")

        try:
            new_audio = MutagenFile(tmp_path, easy=True)
            if new_audio is not None and original_tags:
                for key, values in original_tags.items():
                    new_audio[key] = values
                new_audio.save()
        except Exception:
            pass

        os.replace(tmp_path, full_path)

        stat = os.stat(full_path)
        with get_db() as conn:
            conn.execute(
                "UPDATE songs SET filesize = ?, mtime = ? WHERE path = ?",
                (stat.st_size, stat.st_mtime, rel_path),
            )
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def _run_batch(paths: list):
    _cancel_event.clear()
    started = time.time()
    _set_state(
        status="running", total=len(paths), processed=0, succeeded=0, failed=0,
        current_path="", errors=[], started_at=started, finished_at=None,
    )

    succeeded = failed = processed = 0
    errors = []

    for path in paths:
        if _cancel_event.is_set():
            _set_state(status="cancelled", finished_at=time.time())
            return

        _set_state(current_path=path)
        try:
            normalize_file(path)
            succeeded += 1
        except Exception as exc:
            failed += 1
            errors.append({"path": path, "error": str(exc)})
        processed += 1
        _set_state(processed=processed, succeeded=succeeded, failed=failed, errors=errors)

    _set_state(status="done", finished_at=time.time())


def start_batch_async(paths: list) -> bool:
    global _thread
    with _lock:
        if _state["status"] == "running":
            return False
    _thread = threading.Thread(target=_run_batch, args=(paths,), daemon=True)
    _thread.start()
    return True


def cancel_batch():
    _cancel_event.set()


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None
