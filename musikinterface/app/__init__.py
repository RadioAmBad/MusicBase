import os
import re
import time

from flask import Flask, jsonify, render_template, request, send_file, abort

from . import config
from .db import get_db, init_db
from . import scanner as scanner_mod
from . import tagger
from . import filename_utils
from . import title_cleaner
from . import artist_cleaner
from . import normalizer
from . import azuracast


def create_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = config.SECRET_KEY
    init_db()

    @app.route("/")
    @app.route("/artists/<path:name>")
    @app.route("/genres/<path:name>")
    def index(name=None):
        return render_template("index.html")

    @app.route("/api/folders")
    def api_folders():
        with get_db() as conn:
            rows = conn.execute(
                "SELECT folder, COUNT(*) as cnt FROM songs GROUP BY folder ORDER BY folder"
            ).fetchall()
            total = conn.execute("SELECT COUNT(*) as cnt FROM songs").fetchone()["cnt"]

        folders = [{"path": r["folder"] or "(Hauptordner)", "raw": r["folder"], "count": r["cnt"]} for r in rows]
        return jsonify({"folders": folders, "total": total})

    @app.route("/api/songs")
    def api_songs():
        folder = request.args.get("folder", "")
        search = request.args.get("search", "").strip()
        genre = request.args.get("genre", "")
        year = request.args.get("year", "")
        sort = request.args.get("sort", "artist")
        order = request.args.get("order", "asc")
        page = max(int(request.args.get("page", 1)), 1)
        per_page = min(int(request.args.get("per_page", config.PER_PAGE_DEFAULT)), 500)

        artist_is = request.args.get("artist_is", "").strip()
        genre_is = request.args.get("genre_is", "").strip()
        if artist_is or genre_is:
            return jsonify(_songs_by_exact_value(
                field="artist" if artist_is else "genre",
                value=artist_is or genre_is,
                search=search, sort=sort, order=order, page=page, per_page=per_page,
            ))

        sort_columns = {
            "artist": "artist COLLATE NOCASE",
            "title": "title COLLATE NOCASE",
            "album": "album COLLATE NOCASE",
            "year": "year",
            "genre": "genre COLLATE NOCASE",
            "duration": "duration",
            "filename": "filename COLLATE NOCASE",
        }
        sort_col = sort_columns.get(sort, "artist COLLATE NOCASE")
        order_sql = "DESC" if order == "desc" else "ASC"

        where = []
        params = []
        if folder:
            where.append("folder = ?")
            params.append(folder)
        if genre:
            where.append("genre = ?")
            params.append(genre)
        if year:
            where.append("year = ?")
            params.append(year)
        if search:
            where.append("(artist LIKE ? OR title LIKE ? OR album LIKE ? OR filename LIKE ?)")
            like = f"%{search}%"
            params.extend([like, like, like, like])

        where_sql = f"WHERE {' AND '.join(where)}" if where else ""

        with get_db() as conn:
            total = conn.execute(f"SELECT COUNT(*) as cnt FROM songs {where_sql}", params).fetchone()["cnt"]
            rows = conn.execute(
                f"""SELECT * FROM songs {where_sql}
                    ORDER BY {sort_col} {order_sql}
                    LIMIT ? OFFSET ?""",
                [*params, per_page, (page - 1) * per_page],
            ).fetchall()

        songs = [dict(r) for r in rows]
        return jsonify({"songs": songs, "total": total, "page": page, "per_page": per_page})

    def _songs_by_exact_value(field, value, search, sort, order, page, per_page):
        """Filtert auf einen einzelnen, exakten Wert innerhalb eines
        mehrwertigen Feldes (z.B. genre = "Pop, Rock" -> matcht "Pop").
        Beim Interpret werden zusätzlich zu "," auch ";" und "/" als
        Trenner erkannt (z.B. "A7S/David Guetta/Wizkid"), weil das in der
        Praxis häufig uneinheitlich getaggt ist.
        Läuft in Python statt SQL, weil SQLite kein sauberes "ist einer der
        getrennten Werte" kann. Bei ein paar tausend Titeln ist das
        performant genug, ohne die Datenbank umzubauen.
        """
        target = value.strip().lower()
        search_l = search.lower()
        split_pattern = re.compile(r"\s*[,;/]\s*") if field == "artist" else re.compile(r"\s*,\s*")

        with get_db() as conn:
            rows = conn.execute(
                f"SELECT * FROM songs WHERE {field} LIKE ? COLLATE NOCASE", (f"%{value}%",)
            ).fetchall()

        def field_matches(row):
            parts = [p.strip().lower() for p in split_pattern.split(row[field] or "")]
            return target in parts

        def search_matches(row):
            if not search_l:
                return True
            haystack = " ".join([row["artist"] or "", row["title"] or "", row["album"] or "", row["filename"] or ""]).lower()
            return search_l in haystack

        filtered = [dict(r) for r in rows if field_matches(r) and search_matches(r)]

        sort_keys = {
            "artist": lambda s: (s["artist"] or "").lower(),
            "title": lambda s: (s["title"] or "").lower(),
            "album": lambda s: (s["album"] or "").lower(),
            "year": lambda s: s["year"] or "",
            "genre": lambda s: (s["genre"] or "").lower(),
            "duration": lambda s: s["duration"] or 0,
            "filename": lambda s: (s["filename"] or "").lower(),
        }
        key_fn = sort_keys.get(sort, sort_keys["artist"])
        filtered.sort(key=key_fn, reverse=(order == "desc"))

        total = len(filtered)
        start = (page - 1) * per_page
        page_songs = filtered[start:start + per_page]
        return {"songs": page_songs, "total": total, "page": page, "per_page": per_page}

    @app.route("/api/facets")
    def api_facets():
        with get_db() as conn:
            genres = [r["genre"] for r in conn.execute(
                "SELECT DISTINCT genre FROM songs WHERE genre != '' ORDER BY genre COLLATE NOCASE")]
            years = [r["year"] for r in conn.execute(
                "SELECT DISTINCT year FROM songs WHERE year != '' ORDER BY year DESC")]
        return jsonify({"genres": genres, "years": years})

    @app.route("/api/scan/start", methods=["POST"])
    def api_scan_start():
        started = scanner_mod.start_scan_async()
        if not started:
            return jsonify({"started": False, "reason": "Es läuft bereits ein Scan."}), 409
        return jsonify({"started": True})

    @app.route("/api/scan/status")
    def api_scan_status():
        return jsonify(scanner_mod.get_scan_status())

    @app.route("/api/scan/cancel", methods=["POST"])
    def api_scan_cancel():
        scanner_mod.cancel_scan()
        return jsonify({"ok": True})

    @app.route("/api/tags/bulk", methods=["POST"])
    def api_tags_bulk():
        payload = request.get_json(force=True)
        paths = payload.get("paths", [])
        fields = payload.get("fields", {})
        fields = {k: v for k, v in fields.items() if k in tagger.EDITABLE_FIELDS}

        if not paths or not fields:
            return jsonify({"error": "Keine Titel oder keine Änderungen übergeben."}), 400

        results, errors = [], []
        for path in paths:
            try:
                tagger.write_tags(path, fields)
                results.append(path)
            except Exception as exc:
                errors.append({"path": path, "error": str(exc)})

        return jsonify({"updated": results, "errors": errors})

    @app.route("/api/rename", methods=["POST"])
    def api_rename():
        payload = request.get_json(force=True)
        paths = payload.get("paths", [])
        results = [filename_utils.rename_to_tags(p) for p in paths]
        return jsonify({"results": results})

    @app.route("/api/clean-titles", methods=["POST"])
    def api_clean_titles():
        payload = request.get_json(force=True)
        paths = payload.get("paths", [])

        results = []
        with get_db() as conn:
            for path in paths:
                row = conn.execute("SELECT title FROM songs WHERE path = ?", (path,)).fetchone()
                if row is None:
                    results.append({"path": path, "changed": False, "reason": "Nicht im Index"})
                    continue
                new_title = title_cleaner.clean_title(row["title"])
                if new_title == row["title"]:
                    results.append({"path": path, "changed": False, "old": row["title"], "new": new_title})
                    continue
                try:
                    tagger.write_tags(path, {"title": new_title})
                    results.append({"path": path, "changed": True, "old": row["title"], "new": new_title})
                except Exception as exc:
                    results.append({"path": path, "changed": False, "reason": str(exc)})

        return jsonify({"results": results})

    @app.route("/api/clean-artists", methods=["POST"])
    def api_clean_artists():
        payload = request.get_json(force=True)
        paths = payload.get("paths", [])

        results = []
        with get_db() as conn:
            for path in paths:
                row = conn.execute("SELECT artist FROM songs WHERE path = ?", (path,)).fetchone()
                if row is None:
                    results.append({"path": path, "changed": False, "reason": "Nicht im Index"})
                    continue
                new_artist = artist_cleaner.normalize_artist(row["artist"])
                if new_artist == row["artist"]:
                    results.append({"path": path, "changed": False, "old": row["artist"], "new": new_artist})
                    continue
                try:
                    tagger.write_tags(path, {"artist": new_artist})
                    results.append({"path": path, "changed": True, "old": row["artist"], "new": new_artist})
                except Exception as exc:
                    results.append({"path": path, "changed": False, "reason": str(exc)})

        return jsonify({"results": results})

    @app.route("/api/normalize/start", methods=["POST"])
    def api_normalize_start():
        if not normalizer.ffmpeg_available():
            return jsonify({"started": False, "reason": "ffmpeg ist auf dem Server nicht installiert."}), 500
        payload = request.get_json(force=True)
        paths = payload.get("paths", [])
        if not paths:
            return jsonify({"started": False, "reason": "Keine Titel übergeben."}), 400
        started = normalizer.start_batch_async(paths)
        if not started:
            return jsonify({"started": False, "reason": "Es läuft bereits eine Normalisierung."}), 409
        return jsonify({"started": True})

    @app.route("/api/normalize/status")
    def api_normalize_status():
        return jsonify(normalizer.get_status())

    @app.route("/api/normalize/cancel", methods=["POST"])
    def api_normalize_cancel():
        normalizer.cancel_batch()
        return jsonify({"ok": True})

    @app.route("/api/delete", methods=["POST"])
    def api_delete():
        payload = request.get_json(force=True)
        paths = payload.get("paths", [])

        deleted, errors = [], []
        with get_db() as conn:
            for path in paths:
                full_path = os.path.join(config.MUSIC_ROOT, path)
                try:
                    os.remove(full_path)
                    conn.execute("DELETE FROM songs WHERE path = ?", (path,))
                    deleted.append(path)
                except OSError as exc:
                    errors.append({"path": path, "error": str(exc)})

        return jsonify({"deleted": deleted, "errors": errors})

    @app.route("/api/azuracast/rescan", methods=["POST"])
    def api_azuracast_rescan():
        try:
            result = azuracast.trigger_rescan()
            return jsonify(result)
        except azuracast.AzuraCastError as exc:
            return jsonify({"ok": False, "error": str(exc)}), 502

    @app.route("/api/stream/<path:rel_path>")
    def api_stream(rel_path):
        music_root = os.path.realpath(config.MUSIC_ROOT)
        full_path = os.path.realpath(os.path.join(music_root, rel_path))
        if not full_path.startswith(music_root + os.sep):
            abort(404)
        if not os.path.isfile(full_path):
            abort(404)
        return send_file(full_path, conditional=True)

    return app
