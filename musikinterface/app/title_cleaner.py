"""
Entfernt gängige Titel-Zusätze wie "Remastered 2011", "Radio Edit",
"Single Version" etc. - egal ob in Klammern, eckigen Klammern oder mit
" - " abgetrennt.

Die Liste ist bewusst als einfache Python-Liste am Anfang der Datei
gehalten, damit ihr sie ohne Code-Kenntnisse leicht um weitere Begriffe
ergänzen könnt (z.B. "Extended Mix", "Clean Version", ...).
"""

import re

YEAR = r"(?:19|20)\d{2}"

SUFFIX_PATTERNS = [
    rf"remaster(?:ed)?(?:\s*{YEAR})?",
    rf"{YEAR}\s*remaster(?:ed)?",
    r'7\s*["\u2033]\s*version',
    r"single\s+version",
    r"single\s+edit",
    r"radio\s+edit",
    r"album\s+version",
]

_combined = "|".join(SUFFIX_PATTERNS)

_PATTERN = re.compile(
    rf"""
    \s*[\(\[]\s*(?:{_combined})\s*[\)\]]
    |
    \s+-\s*(?:{_combined})\s*$
    """,
    re.IGNORECASE | re.VERBOSE,
)

_TRAILING_JUNK = re.compile(r"[\s\-–—]+$")


def clean_title(title: str) -> str:
    if not title:
        return title
    cleaned = _PATTERN.sub("", title)
    cleaned = _TRAILING_JUNK.sub("", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
    return cleaned or title
