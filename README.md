
# MusicBase - Musikbibliothek Interface für Radiosender

Selbstgehostetes Web Interface zur Verwaltung der Musikbibliothek des Radiosenders.
Arbeitet direkt auf den Audiodateien (inkl. ID3-Tags).
<img width="1919" height="901" alt="2026-09-15 23_33_19-" src="https://github.com/user-attachments/assets/ba8ebae3-2ec6-4d2a-a0de-27cf172b43a5" />
<img width="1919" height="901" alt="2026-09-15 23_34_53-MusicBase" src="https://github.com/user-attachments/assets/66ec4a3a-088b-403c-9858-061d975e3790" />
<img width="1919" height="901" alt="2026-09-15 23_35_33-" src="https://github.com/user-attachments/assets/b932ae04-2069-4edb-b89e-c744dbb2ebb0" />

## Funktionen

- Ordneransicht mit Titelanzahl je Ordner
- Suche über Interpret / Titel / Album / Dateiname
- Sortierung (Interpret, Titel, Album, Genre, Jahr, Dauer, Dateiname)
- Filter nach Genre und Jahr
- Lieder löschen (löscht direkt in der Cloud)
- Tag-Editor für Einzel- und Mehrfachauswahl
- **Dateinamen fixen** — benennt Dateien nach dem Schema `Interpret - Titel.ext`
- **Titel bereinigen** — entfernt automatisch Zusätze wie "Remastered 2011",
  "Radio Edit", "Single Version", "7" Version", "Album Version" etc.
  (Liste erweiterbar in `app/title_cleaner.py`)
- **Audioplayer**: Direktes abspielen der Lieder im Interface.
  **Interpreten-/Genre-Detailansicht**: Übersichtseite für pro Interpet/Genre mit allen Liedern des Interpreten/Genres.
  Unterstützt auch kommagetrennte Mehrfachartists und Mehrfachgenres.
- **Interpret bereinigen**: Uneinheitliche Trenner im Interpret-Tag (";" oder "/") werden durch ein einheitliches ", "
  ersetzt (z.B. "A7S/David Guetta/Wizkid" -> "A7S, David Guetta, Wizkid") ersetzt.
- **Lautheit normalisieren (-23 LUFS, EBU R128)**: Normalisiert die ausgewählten Titel mit einem Klick auf
  den im Rundfunk üblichen Zielwert von -23 LUFS.
- **Hell-/Dunkelmodus** umschaltbar per Button Button oben rechts (Standard:
  dunkel), Einstellung wird im Browser gemerkt.
- Für Azuracast Nutzer: Button zum Anstoßen des AzuraCast-Rescans, also dem neu laden der Musikbibliothek in Azuarcast.

## Installation

Das ganze ist zum selbsthosten!
Erfordert wird ein Server mit Python3.

### Voraussetzungen

- Python 3.9+
- ffmpeg im `PATH`
- Musikbibliothek entweder in einem lokalen Ordner oder als gemounteter
  Cloud-/SFTP-Speicher — Hauptsache, unter einem festen Pfad erreichbar,
  mit Lese- und Schreibrechten für den App-Nutzer (nötig für Tags,
  Umbenennen, Löschen, Normalisieren)

### 1. Repository holen

```bash
git clone https://github.com/RadioAmBad/MusicBase.git
cd MusicBase
```

### 2. Virtuelle Umgebung + Dependencies

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 3. Konfiguration

```bash
cp .env.example .env
nano .env
```

`.env` ausfüllen:

| Variable | Pflicht | Beschreibung |
|---|---|---|
| `MUSIC_ROOT` | ja | Pfad zur Musikbibliothek (lokaler Ordner oder Mount-Punkt) |
| `DATABASE_PATH` | nein | Such-Index-DB (Default: `app/library.db`) |
| `AZURACAST_BASE_URL` | nein* | z.B. `https://azuarcast.radio-domain.de` |
| `AZURACAST_API_KEY` | nein* | API-Key aus AzuraCast |
| `AZURACAST_STATION_ID` | nein* | Stations-ID in AzuraCast |
| `SECRET_KEY` | ja | Zufallsstring, z.B. `python3 -c "import secrets; print(secrets.token_hex(32))"` |

\*nur für Azuracast Nutzer relevant

### 4. Erststart

```bash
python run.py
```

→ `http://127.0.0.1:5050`, dort "Bibliothek neu einlesen" klicken.
