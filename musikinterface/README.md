# Musikbibliothek-Interface — Radio Am Bad

Prototyp eines eigenständigen Web-Interfaces zur Verwaltung der Musikbibliothek.
Unabhängig von AzuraCast und mAirList — arbeitet direkt auf den Audiodateien
(inkl. ID3-Tags), damit alle Systeme (AzuraCast, mAirList, Windows Explorer)
dieselbe Wahrheitsquelle sehen.

## Funktionen

- Ordneransicht mit Titelanzahl je Ordner
- Suche über Interpret / Titel / Album / Dateiname
- Sortierung (Interpret, Titel, Album, Genre, Jahr, Dauer, Dateiname)
- Filter nach Genre und Jahr
- Mehrfachauswahl (Checkboxen + "Alle auswählen")
- Tag-Editor für Einzel- und Mehrfachauswahl (leere Felder = unverändert lassen)
- **Dateinamen fixen** — benennt Dateien nach dem Schema `Interpret - Titel.ext`
- **Titel bereinigen** — entfernt automatisch Zusätze wie "Remastered 2011",
  "Radio Edit", "Single Version", "7" Version", "Album Version" etc.
  (Liste erweiterbar in `app/title_cleaner.py`)
- Löschen mit Bestätigungsdialog (löscht direkt in der Cloud)
- Button zum Anstoßen des AzuraCast-Rescans
- **Scan läuft im Hintergrund mit Fortschrittsanzeige** ("1247 / 3812 Titel"),
  bereits gescannte Titel tauchen sofort in der Liste auf, während der Rest
  noch läuft. Lässt sich jederzeit über "Abbrechen" stoppen — bereits
  gescannte Titel bleiben dabei im Index.
- **Audioplayer**: Play/Pause-Button direkt in jeder Zeile, Player-Leiste
  unten mit Titel/Interpret, Vor/Zurück (innerhalb der aktuell geladenen
  Liste), Fortschrittsbalken zum Reinklicken/Spulen.
- **Hell-/Dunkelmodus** umschaltbar über den Button oben rechts (Standard:
  dunkel), Einstellung wird im Browser gemerkt.
- Ordneransicht als klapp-/aufklappbarer Baum mit Icons, in "Alle Titel"
  wird der Ordnerpfad mit vor dem Dateinamen angezeigt, in einem
  spezifischen Ordner nur der Dateiname.
- **Interpreten-/Genre-Detailansicht**: Interpret und Genre werden bei
  mehreren kommagetrennten Werten (z.B. "Anna Müller, Ben Schulz") als
  einzeln anklickbare Chips angezeigt. Klick auf einen Namen öffnet eine
  Ansicht mit allen Titeln dieses Interpreten/Genres über die ganze
  Bibliothek hinweg (auch als Co-Interpret o.ä.), mit "Zurück zur
  Bibliothek"-Button.
- **Ordnerleiste ein-/ausklappbar** über den Button mittig am Rand;
  eingeklappt bekommt die Titel-Spalte mehr Platz. Zustand wird gemerkt.
- **Mehrfachauswahl wie im Windows Explorer**: normaler Klick wählt nur
  die angeklickte Zeile, Strg-Klick fügt einzelne Zeilen hinzu/entfernt
  sie, Shift-Klick wählt einen Bereich ab der zuletzt angeklickten Zeile.
- **Interpret bereinigen**: Button in der Auswahlleiste, der uneinheitliche
  Trenner im Interpret-Tag (";" oder "/") durch ein einheitliches ", "
  ersetzt (z.B. "A7S/David Guetta/Wizkid" -> "A7S, David Guetta, Wizkid").
- **Lautheit normalisieren (-23 LUFS, EBU R128)**: Button in der Auswahlleiste,
  normalisiert die ausgewählten Titel per zweistufigem ffmpeg-loudnorm auf
  den im Rundfunk üblichen Zielwert. Läuft als Hintergrund-Batch mit
  Fortschrittsanzeige und Abbrechen-Möglichkeit direkt in der Auswahlleiste.
  ID3/Vorbis-Tags bleiben erhalten.
- **Lautstärkeregler im Player** (rechts, mit Stumm-Schalter), Einstellung
  wird im Browser gemerkt.
- **Eigene URLs für Interpret-/Genre-Ansicht** (`/artists/<name>`,
  `/genres/<name>`) über die Browser-History-API — Browser-Zurück verlässt
  die Seite nicht mehr, sondern springt innerhalb der App zurück.
- **Mobile Ansicht**: Ordnerleiste wird zur ausklappbaren Schublade
  (Hamburger-Menü oben links, Klick auf den abgedunkelten Hintergrund
  schließt sie wieder), Suche/Filter/Aktionen wandern in ein separates
  vertikales Dropdown-Menü (Lupe oben rechts) statt die Titelliste
  einzuengen. Album/Genre/Datei-Spalten werden auf schmalen Bildschirmen
  ausgeblendet, damit Interpret/Titel/Dauer lesbar bleiben.
- **Eigenes Tablet-Layout** (z.B. iPad quer/hoch, ca. 861–1500px Breite):
  Sidebar bleibt als normale, sichtbare Spalte erhalten (genug Platz
  dafür), aber Suche/Filter/Aktionen wandern trotzdem ins Dropdown-Menü,
  weil dafür in einer Zeile neben der Sidebar zu wenig Platz ist.
- **Favicon** unter `app/static/favicon.ico` (eigene Datei einfach dort
  ablegen/ersetzen — wird automatisch eingebunden).

## Architektur (kurz)

- **Wahrheitsquelle** sind immer die Audiodateien selbst (ID3-Tags via
  `mutagen`). Es gibt keine separate Metadaten-Datenbank, die parallel
  gepflegt werden müsste.
- Eine lokale **SQLite-Datei** (`app/library.db`) dient nur als schneller
  **Such-Index/Cache** — nötig, weil eine einzelne Playlist bereits über
  3000 Titel hat und Live-Scans über SFTP bei jeder Suche zu langsam wären.
- Der Button "Bibliothek neu einlesen" scannt `MUSIC_ROOT` rekursiv und
  gleicht den Index ab (nur geänderte/neue Dateien werden neu gelesen,
  gelöschte Dateien fallen aus dem Index raus).

## Setup

```bash
pip install -r requirements.txt
```

Umgebungsvariablen (z.B. in einer `.env` oder im systemd-Service) setzen:

```bash
export MUSIC_ROOT=/pfad/zum/gemounteten/sftp/ordner
export AZURACAST_BASE_URL=https://radio.eure-domain.de
export AZURACAST_API_KEY=euer-api-key
export AZURACAST_STATION_ID=1
export SECRET_KEY=ein-zufaelliger-string
```

Start (Entwicklung):

```bash
python run.py
```

Für den Produktivbetrieb hinter einem Reverse Proxy (nginx) mit z.B.
`gunicorn`:

```bash
pip install gunicorn
gunicorn -w 2 -b 127.0.0.1:5050 "app:create_app()"
```

## Wichtig vor dem produktiven Einsatz

1. **Nur ein Worker-Prozess** (wichtig!): Der Scan-Fortschritt liegt im
   Arbeitsspeicher des Prozesses, der den Scan gestartet hat. Bei
   `gunicorn -w 4` (mehrere Worker-Prozesse) kann eine Fortschritts-Abfrage
   bei einem anderen Worker landen und "idle" statt des echten Fortschritts
   zeigen. Für den Produktivbetrieb also `gunicorn -w 1 ...` verwenden, oder
   bei Bedarf später auf einen geteilten Speicher (z.B. Redis) umstellen.
2. **Player nutzt Range-Requests**: `/api/stream/<pfad>` liefert die
   Audiodatei über `send_file(..., conditional=True)`, damit der Browser
   im Player vor- und zurückspulen kann. Läuft die App hinter nginx als
   Reverse Proxy, sollte `proxy_buffering off;` bzw. Range-Weiterleitung
   nicht blockiert sein — Standard-nginx-Konfiguration macht das bereits
   richtig, nur bei exotischen Proxy-Setups einmal prüfen.
3. **AzuraCast-API-Route prüfen** (`app/azuracast.py`): Ich konnte den
   exakten Endpoint für "Medienbibliothek neu einlesen" nicht garantiert
   korrekt für eure AzuraCast-Version liefern. Einmal kurz unter
   `https://eure-azuracast-domain/docs` (Swagger-UI) nachsehen und die
   Route in `trigger_rescan()` bei Bedarf anpassen — Auth per
   `X-API-Key`-Header ist auf jeden Fall korrekt.
2. **Schreibrechte prüfen**: Der Webserver-Prozess braucht Schreibzugriff
   auf `MUSIC_ROOT` (Umbenennen, Tags schreiben, Löschen).
3. **Backup/Papierkorb überlegen**: Aktuell löscht "Löschen" die Datei
   sofort und endgültig (nach Bestätigungsdialog). Falls gewünscht, lässt
   sich das leicht auf "in einen `_geloescht`-Unterordner verschieben"
   statt `os.remove()` umstellen (in `app/__init__.py`, Route
   `/api/delete`).
4. **Titel-Bereinigungsliste**: Die Muster in `app/title_cleaner.py` decken
   die genannten Fälle ab (Remastered, Radio Edit, Single Version/Edit,
   Album Version, 7" Version). Weitere Begriffe lassen sich einfach in die
   `SUFFIX_PATTERNS`-Liste ergänzen.
5. Erster Start braucht einmal "Bibliothek neu einlesen", danach ist der
   Index aktuell. Bei 3000+ Titeln kann der allererste vollständige Scan
   je nach SFTP-Performance ein paar Minuten dauern — spätere Scans sind
   deutlich schneller, weil nur geänderte Dateien neu gelesen werden.
6. **Mehrere Interpreten/Genres pro Titel**: Die Interpreten-/Genre-Chips
   und die Detailansicht gehen davon aus, dass mehrere Werte mit ", "
   (Komma + Leerzeichen) getrennt sind, z.B. "Anna Müller, Ben Schulz".
   Andere Trennzeichen (nur Komma ohne Leerzeichen, Schrägstrich, "feat.")
   werden nicht automatisch erkannt und als ein einziger Name behandelt.
7. **Normalisierung braucht ffmpeg auf dem Server** (nicht nur für den
   Player, auch für die Lautheits-Normalisierung selbst — dort wird der
   `loudnorm`-Filter zweistufig genutzt). Da die Dateien dabei komplett neu
   encodiert werden, empfiehlt sich vor dem ersten großflächigen Einsatz
   ein Test an ein paar unkritischen Titeln, und ein Backup der Bibliothek
   ist ohnehin immer sinnvoll, bevor Dateien in großer Zahl automatisiert
   verändert werden. Nicht unterstützt: `.wma` (kein brauchbarer freier
   ffmpeg-Encoder dafür).

## Deployment mit nginx auf einer Subdomain

Das Interface läuft als normale Flask-App — am einfachsten dauerhaft mit
`gunicorn` als WSGI-Server (statt des eingebauten Entwicklungsservers),
und nginx davor als Reverse Proxy für die Subdomain.

### 1. gunicorn als systemd-Service

`/etc/systemd/system/musikinterface.service`:

```ini
[Unit]
Description=Radio Am Bad Musikbibliothek-Interface
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/pfad/zu/musikinterface
EnvironmentFile=/pfad/zu/musikinterface/.env
ExecStart=/pfad/zu/musikinterface/venv/bin/gunicorn -w 1 -b 127.0.0.1:5050 "app:create_app()"
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Wichtig: **`-w 1`** (nur ein Worker-Prozess) — siehe Punkt weiter oben,
der Scan- und Normalisierungs-Fortschritt liegt im Prozessspeicher und
würde bei mehreren Workern nicht zuverlässig auf dem "richtigen" Worker
landen. `EnvironmentFile` lädt dabei eure `.env` automatisch, sodass ihr
`MUSIC_ROOT`, `AZURACAST_*` etc. nicht nochmal separat in der Unit-Datei
eintragen müsst (Pfad zur `.env` ggf. anpassen).

```bash
python3 -m venv venv
venv/bin/pip install -r requirements.txt gunicorn
sudo systemctl daemon-reload
sudo systemctl enable --now musikinterface
```

### 2. nginx-Konfiguration

`/etc/nginx/sites-available/musik.radio-am-bad.de` (Domain anpassen):

```nginx
server {
    listen 80;
    server_name musik.radio-am-bad.de;

    location / {
        proxy_pass http://127.0.0.1:5050;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Für den Audio-Player: Range-Requests (Vor-/Zurückspulen) sauber
        # durchreichen statt zu buffern.
        proxy_buffering off;
        proxy_http_version 1.1;
    }

    # Scan und Normalisierung laufen im Hintergrund und können bei sehr
    # großen Bibliotheken/Batches eine Weile dauern — großzügige Timeouts
    # für die einzelnen Anfragen (nicht für den Hintergrund-Job selbst,
    # der läuft unabhängig weiter, auch wenn ein Browser-Request früher
    # abbricht).
    proxy_read_timeout 300s;
    client_max_body_size 20m;
}
```

```bash
sudo ln -s /etc/nginx/sites-available/musik.radio-am-bad.de /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 3. HTTPS (empfohlen, per Let's Encrypt)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d musik.radio-am-bad.de
```

Certbot passt die obige nginx-Konfiguration automatisch um SSL-Zertifikat
und HTTP->HTTPS-Redirect an.

### 4. DNS

Ein `A`-Record (oder `CNAME`, falls die Subdomain auf einen Hostnamen statt
eine feste IP zeigen soll) für `musik.radio-am-bad.de` auf die IP des Servers,
auf dem nginx läuft.

Danach ist das Interface unter `https://musik.radio-am-bad.de` erreichbar,
läuft intern weiter über `127.0.0.1:5050` und ist von außen nicht direkt
auf diesem Port erreichbar (nur über nginx).

## Getestet

Lokal gegen eine Test-Bibliothek mit verschachtelten Ordnern durchgetestet:
Scan (inkl. differenziellem Re-Scan), Ordner-Zählung, Suche, Sortierung,
Filter, Tag-Bulk-Edit (inkl. "leer = unverändert"), Umbenennen nach Tags
(inkl. Kollisions-Handling), Titel-Bereinigung (inkl. mehrerer Zusätze in
einem Titel) und Löschen — jeweils inklusive Prüfung, dass die Änderungen
tatsächlich in den ID3-Tags bzw. auf dem Dateisystem ankommen.

Nicht getestet (da hierfür eure echte Infrastruktur nötig ist): SFTP-Mount
unter Last, der tatsächliche AzuraCast-Rescan-Aufruf, sowie das Verhalten
bei mehreren tausend echten Titeln gleichzeitig.
