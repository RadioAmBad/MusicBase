"""
Zentrale Konfiguration für das Media-Interface.

Alle Werte lassen sich per Umgebungsvariable überschreiben, damit auf dem
Produktivserver nichts im Code angepasst werden muss.
"""

import os

from dotenv import load_dotenv

load_dotenv()

MUSIC_ROOT = os.environ.get("MUSIC_ROOT", "/mnt/musikcloud")

AUDIO_EXTENSIONS = {".mp3", ".flac", ".wav", ".m4a", ".aac", ".ogg", ".wma"}

DATABASE_PATH = os.environ.get("DATABASE_PATH", os.path.join(os.path.dirname(__file__), "library.db"))

AZURACAST_BASE_URL = os.environ.get("AZURACAST_BASE_URL", "https://radio.example.com")
AZURACAST_API_KEY = os.environ.get("AZURACAST_API_KEY", "")
AZURACAST_STATION_ID = os.environ.get("AZURACAST_STATION_ID", "1")

SECRET_KEY = os.environ.get("SECRET_KEY", "bitte-in-produktion-aendern")
PER_PAGE_DEFAULT = 100
