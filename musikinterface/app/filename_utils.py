import os
import re

from . import config
from .db import get_db

_INVALID_CHARS = re.compile(r'[\\/:*?"<>|]')


def sanitize(name: str) -> str:
    name = _INVALID_CHARS.sub("", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name


def build_filename(artist: str, title: str, ext: str) -> str:
    artist = sanitize(artist) or "Unbekannt"
    title = sanitize(title) or "Unbekannt"
    return f"{artist} - {title}{ext}"


def rename_to_tags(rel_path: str) -> dict:
    """Benennt eine Datei nach dem Schema 'Interpret - Titel.ext' um,
    basierend auf den aktuellen Tags in der Datei / im Index.
    Gibt {"old": ..., "new": ..., "skipped": bool, "reason": str|None} zurück.
    """
    with get_db() as conn:
        row = conn.execute("SELECT * FROM songs WHERE path = ?", (rel_path,)).fetchone()
        if row is None:
            return {"old": rel_path, "new": None, "skipped": True, "reason": "Nicht im Index gefunden"}

        if not row["artist"] or not row["title"]:
            return {"old": rel_path, "new": None, "skipped": True, "reason": "Interpret oder Titel fehlt"}

        new_filename = build_filename(row["artist"], row["title"], row["ext"])
        if new_filename == row["filename"]:
            return {"old": rel_path, "new": rel_path, "skipped": True, "reason": "Bereits korrekt benannt"}

        old_full = os.path.join(config.MUSIC_ROOT, rel_path)
        folder_full = os.path.join(config.MUSIC_ROOT, row["folder"])
        new_full = os.path.join(folder_full, new_filename)

        counter = 2
        base_name, ext = os.path.splitext(new_filename)
        while os.path.exists(new_full) and os.path.abspath(new_full) != os.path.abspath(old_full):
            new_filename = f"{base_name} ({counter}){ext}"
            new_full = os.path.join(folder_full, new_filename)
            counter += 1

        os.rename(old_full, new_full)

        new_rel_path = f"{row['folder']}/{new_filename}" if row["folder"] else new_filename
        conn.execute(
            "UPDATE songs SET path = ?, filename = ? WHERE path = ?",
            (new_rel_path, new_filename, rel_path),
        )

        return {"old": rel_path, "new": new_rel_path, "skipped": False, "reason": None}
