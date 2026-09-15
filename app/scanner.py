"""
Durchsucht MUSIC_ROOT rekursiv und pflegt den SQLite-Index nach.

Die Audiodateien (inkl. ID3-Tags) bleiben immer die Wahrheitsquelle. Diese
Datenbank ist nur ein schneller Cache dafür, damit Suche/Sortierung/Filter
bei mehreren tausend Titeln nicht bei jeder Anfrage das komplette
SFTP-Dateisystem durchsuchen müssen.

Der Scan läuft in einem Hintergrund-Thread und committet JEDE Datei
einzeln in die Datenbank, statt alles erst am Ende in einer einzigen
Transaktion zu speichern. Dadurch tauchen bereits gescannte Titel sofort
in der Oberfläche auf, während der Rest der Bibliothek noch läuft.

Hinweis für den Produktivbetrieb mit mehreren Worker-Prozessen (z.B.
"gunicorn -w 4"): Der Scan-Status unten liegt im Prozessspeicher. Bei
mehreren Workern kann eine Status-Abfrage bei einem anderen Worker
landen als dem, der den Scan gestartet hat. Für den Prototyp mit einem
einzelnen Worker/Prozess ist das unproblematisch.
"""

import os
import threading
import time

from mutagen import File as MutagenFile

from . import config
from .db import get_db

_lock = threading.Lock()
_cancel_event = threading.Event()
_thread = None

_state = {
    "status": "idle",
    "scanned": 0,
    "total_found": 0,
    "added": 0,
    "updated": 0,
    "removed": 0,
    "current_path": "",
    "started_at": None,
    "finished_at": None,
    "error": None,
}


def get_scan_status() -> dict:
    with _lock:
        return dict(_state)


def _set_state(**kwargs):
    with _lock:
        _state.update(kwargs)


def _read_tags(full_path: str) -> dict:
    """Liest Metadaten möglichst formatunabhängig per mutagen."""
    data = {
        "artist": "", "title": "", "album": "",
        "genre": "", "year": "", "track": "",
        "duration": 0.0, "bitrate": 0,
    }
    try:
        audio = MutagenFile(full_path, easy=True)
        if audio is None:
            return data
        info = getattr(audio, "info", None)
        if info is not None:
            data["duration"] = round(getattr(info, "length", 0) or 0, 2)
            data["bitrate"] = int(getattr(info, "bitrate", 0) or 0) // 1000

        def first(key):
            values = audio.get(key)
            return values[0] if values else ""

        data["artist"] = first("artist")
        data["title"] = first("title")
        data["album"] = first("album")
        data["genre"] = first("genre")
        year_raw = first("date") or first("year")
        data["year"] = (year_raw or "")[:4]
        data["track"] = first("tracknumber").split("/")[0] if first("tracknumber") else ""
    except Exception:
        pass
    return data


def _iter_audio_files(root):
    for dirpath, _dirnames, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root)
        rel_dir = "" if rel_dir == "." else rel_dir.replace(os.sep, "/")
        for filename in filenames:
            ext = os.path.splitext(filename)[1].lower()
            if ext not in config.AUDIO_EXTENSIONS:
                continue
            full_path = os.path.join(dirpath, filename)
            rel_path = f"{rel_dir}/{filename}" if rel_dir else filename
            yield rel_dir, filename, full_path, rel_path


def _run_scan(root: str):
    started = time.time()
    _cancel_event.clear()
    _set_state(
        status="counting", scanned=0, total_found=0, added=0, updated=0,
        removed=0, current_path="", started_at=started, finished_at=None, error=None,
    )

    try:
        total_found = sum(1 for _ in _iter_audio_files(root))
        _set_state(status="running", total_found=total_found)

        seen_paths = set()
        added = updated = scanned = 0

        with get_db() as conn:
            existing = {row["path"]: row for row in conn.execute("SELECT * FROM songs")}

        for rel_dir, filename, full_path, rel_path in _iter_audio_files(root):
            if _cancel_event.is_set():
                _set_state(status="cancelled", finished_at=time.time())
                return

            seen_paths.add(rel_path)
            scanned += 1

            try:
                stat = os.stat(full_path)
            except OSError:
                _set_state(scanned=scanned, current_path=rel_path)
                continue

            prior = existing.get(rel_path)
            unchanged = (
                prior is not None
                and abs(prior["mtime"] - stat.st_mtime) < 1
                and prior["filesize"] == stat.st_size
            )

            with get_db() as conn:
                if unchanged:
                    conn.execute("UPDATE songs SET last_seen = ? WHERE path = ?", (started, rel_path))
                else:
                    tags = _read_tags(full_path)
                    fallback_title = os.path.splitext(filename)[0]
                    conn.execute(
                        """
                        INSERT INTO songs (path, folder, filename, ext, artist, title, album,
                                            genre, year, track, duration, bitrate, filesize, mtime, last_seen)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                        ON CONFLICT(path) DO UPDATE SET
                            folder=excluded.folder, filename=excluded.filename, ext=excluded.ext,
                            artist=excluded.artist, title=excluded.title, album=excluded.album,
                            genre=excluded.genre, year=excluded.year, track=excluded.track,
                            duration=excluded.duration, bitrate=excluded.bitrate,
                            filesize=excluded.filesize, mtime=excluded.mtime, last_seen=excluded.last_seen
                        """,
                        (
                            rel_path, rel_dir, filename, ext_of(filename),
                            tags["artist"] or "", tags["title"] or fallback_title,
                            tags["album"], tags["genre"], tags["year"], tags["track"],
                            tags["duration"], tags["bitrate"], stat.st_size, stat.st_mtime, started,
                        ),
                    )
                    if prior is None:
                        added += 1
                    else:
                        updated += 1

            _set_state(scanned=scanned, added=added, updated=updated, current_path=rel_path)

        with get_db() as conn:
            gone = [p for p in existing if p not in seen_paths]
            for p in gone:
                conn.execute("DELETE FROM songs WHERE path = ?", (p,))

        _set_state(status="done", removed=len(gone), finished_at=time.time())

    except Exception as exc:
        _set_state(status="error", error=str(exc), finished_at=time.time())


def ext_of(filename: str) -> str:
    return os.path.splitext(filename)[1].lower()


def start_scan_async(root: str = None) -> bool:
    """Startet den Scan im Hintergrund. Gibt False zurück, wenn schon einer läuft."""
    global _thread
    root = root or config.MUSIC_ROOT
    with _lock:
        if _state["status"] in ("counting", "running"):
            return False
    _thread = threading.Thread(target=_run_scan, args=(root,), daemon=True)
    _thread.start()
    return True


def cancel_scan():
    _cancel_event.set()
