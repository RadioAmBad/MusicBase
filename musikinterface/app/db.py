import sqlite3
from contextlib import contextmanager

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS songs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    path        TEXT UNIQUE NOT NULL,   -- absoluter Pfad relativ zu MUSIC_ROOT
    folder      TEXT NOT NULL,          -- Ordner relativ zu MUSIC_ROOT ("" = Root)
    filename    TEXT NOT NULL,
    ext         TEXT NOT NULL,
    artist      TEXT DEFAULT '',
    title       TEXT DEFAULT '',
    album       TEXT DEFAULT '',
    genre       TEXT DEFAULT '',
    year        TEXT DEFAULT '',
    track       TEXT DEFAULT '',
    duration    REAL DEFAULT 0,
    bitrate     INTEGER DEFAULT 0,
    filesize    INTEGER DEFAULT 0,
    mtime       REAL DEFAULT 0,
    last_seen   REAL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_songs_folder ON songs(folder);
CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_songs_year ON songs(year);
CREATE INDEX IF NOT EXISTS idx_songs_genre ON songs(genre COLLATE NOCASE);
"""


def get_connection():
    conn = sqlite3.connect(config.DATABASE_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


@contextmanager
def get_db():
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with get_db() as conn:
        conn.executescript(SCHEMA)
