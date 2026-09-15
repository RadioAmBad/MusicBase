"""
Schreibt Tag-Änderungen IMMER direkt in die Audiodatei selbst (ID3 / Vorbis /
MP4-Atoms je nach Format via mutagen easy-Interface).

Das ist bewusst so gewählt: AzuraCast, mAirList und der Windows Explorer
lesen ihre Metadaten alle aus der Datei selbst, nicht aus einer externen
Datenbank. Damit bleibt die Datei die einzige Wahrheitsquelle für alle
Systeme gleichzeitig.
"""

import os

from mutagen import File as MutagenFile

from . import config
from .db import get_db

EDITABLE_FIELDS = ["artist", "title", "album", "genre", "year", "track"]

_EASY_KEY = {
    "artist": "artist",
    "title": "title",
    "album": "album",
    "genre": "genre",
    "year": "date",
    "track": "tracknumber",
}


def write_tags(rel_path: str, fields: dict) -> None:
    """fields: dict mit einer Teilmenge von EDITABLE_FIELDS -> neuer Wert.
    Ein leerer String löscht das jeweilige Tag nicht automatisch (siehe
    Mehrfachauswahl-Logik im API-Layer) - hier wird einfach 1:1 geschrieben.
    """
    full_path = os.path.join(config.MUSIC_ROOT, rel_path)
    audio = MutagenFile(full_path, easy=True)
    if audio is None:
        raise ValueError(f"Datei konnte nicht gelesen werden: {rel_path}")

    for field, value in fields.items():
        if field not in _EASY_KEY:
            continue
        key = _EASY_KEY[field]
        if value == "":
            if key in audio:
                del audio[key]
        else:
            audio[key] = [value]

    audio.save()

    with get_db() as conn:
        stat = os.stat(full_path)
        set_clause = ", ".join(f"{f} = ?" for f in fields)
        conn.execute(
            f"UPDATE songs SET {set_clause}, mtime = ? WHERE path = ?",
            (*fields.values(), stat.st_mtime, rel_path),
        )
