"""
Triggert in AzuraCast das Neu-Einlesen der Medienbibliothek per Button im
Dashboard.

ACHTUNG: Ich kann die exakte API-Route hier nicht garantiert korrekt
liefern, da sie sich je nach AzuraCast-Version unterscheiden kann und ich
keinen Zugriff auf eure konkrete Instanz habe. Bitte einmal kurz auf
eurer AzuraCast-Instanz unter /docs (Swagger-UI) nach dem Endpoint für
"Station -> Sync/Restart Media" bzw. "Requeue media" suchen und die
Route + Methode unten in trigger_rescan() bei Bedarf anpassen.
Bekannt korrekt ist in jedem Fall: Auth per Header "X-API-Key".
"""

import requests

from . import config


class AzuraCastError(Exception):
    pass


def trigger_rescan() -> dict:
    if not config.AZURACAST_API_KEY:
        raise AzuraCastError("Kein AzuraCast-API-Key konfiguriert (AZURACAST_API_KEY).")

    url = f"{config.AZURACAST_BASE_URL}/api/station/{config.AZURACAST_STATION_ID}/sync"
    headers = {"X-API-Key": config.AZURACAST_API_KEY}

    try:
        resp = requests.post(url, headers=headers, timeout=30)
        resp.raise_for_status()
        return {"ok": True, "status_code": resp.status_code}
    except requests.RequestException as exc:
        raise AzuraCastError(f"AzuraCast-Anfrage fehlgeschlagen: {exc}") from exc
