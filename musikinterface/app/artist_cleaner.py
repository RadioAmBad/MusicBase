"""
Normalisiert die Trennung mehrerer Interpreten in EINEM Tag-Feld auf ein
einheitliches ", " (Komma + Leerzeichen).

Manche Tags nutzen stattdessen ";" (z.B. "x;y" oder "x; y") oder "/"
(z.B. "A7S/David Guetta/Wizkid"). Diese Funktion erkennt alle drei
Varianten und schreibt sie einheitlich mit ", " getrennt.
"""

import re

_SEPARATORS = re.compile(r"\s*[;/,]\s*")


def normalize_artist(artist: str) -> str:
    if not artist:
        return artist
    parts = [p.strip() for p in _SEPARATORS.split(artist) if p.strip()]
    if not parts:
        return artist
    return ", ".join(parts)
