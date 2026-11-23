#!/usr/bin/env python3
"""Scarica tutte le partite di un utente BGG tramite la XML API2 e salva data/plays.json.

Uso:
  BGG_TOKEN=xxxx python3 scripts/fetch_plays.py            # scarica da BGG
  python3 scripts/fetch_plays.py --xml file1.xml file2.xml # converte XML già scaricati

Il token si ottiene registrando un'applicazione su https://boardgamegeek.com/applications
"""
import json, os, re, sys, time, unicodedata, urllib.request, urllib.error
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = json.load(open(os.path.join(ROOT, "config.json"), encoding="utf-8"))
API = "https://boardgamegeek.com/xmlapi2/plays?username={u}&type=thing&subtype=boardgame&page={p}"


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s.lower()).strip()


def match_game(name):
    n = norm(name)
    for g in CONFIG["games"]:
        if any(re.search(p, n) for p in g["match"]):
            return g["key"]
    return None


def fetch_page(page, token):
    url = API.format(u=CONFIG["username"], p=page)
    headers = {"User-Agent": "bgg-stats-site/1.0"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    for attempt in range(8):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as r:
                if r.status == 202:  # BGG sta preparando la risposta
                    time.sleep(3 + attempt * 2)
                    continue
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(5 + attempt * 5)
                continue
            if e.code == 401:
                sys.exit("401 Unauthorized: serve un token BGG valido nella variabile BGG_TOKEN.")
            raise
    raise RuntimeError(f"Pagina {page}: troppi tentativi falliti")


def parse(xml_bytes):
    root = ET.fromstring(xml_bytes)
    out = []
    for p in root.findall("play"):
        item = p.find("item")
        name = item.get("name") if item is not None else ""
        key = match_game(name)
        if not key:
            continue
        players = []
        for pl in p.findall("players/player"):
            players.append({
                "name": (pl.get("name") or pl.get("username") or "?").strip(),
                "username": pl.get("username") or "",
                "score": pl.get("score") or "",
                "win": pl.get("win") == "1",
                "color": pl.get("color") or "",
                "start": pl.get("startposition") or "",
            })
        comments = p.find("comments")
        out.append({
            "id": int(p.get("id")),
            "date": p.get("date"),
            "quantity": int(p.get("quantity") or 1),
            "length": int(p.get("length") or 0),
            "incomplete": p.get("incomplete") == "1",
            "location": p.get("location") or "",
            "game": key,
            "bggName": name,
            "bggId": int(item.get("objectid")) if item is not None else None,
            "comments": (comments.text or "").strip() if comments is not None else "",
            "players": players,
        })
    total = int(root.get("total") or 0)
    return out, total, len(root.findall("play"))


def main():
    plays = []
    if len(sys.argv) > 2 and sys.argv[1] == "--xml":
        for f in sys.argv[2:]:
            plays += parse(open(f, "rb").read())[0]
    else:
        token = os.environ.get("BGG_TOKEN", "").strip()
        if not token and os.environ.get("GITHUB_ACTIONS"):
            print("BGG_TOKEN non impostato: mantengo i dati esistenti.")
            return
        page = 1
        while True:
            got, total, n = parse(fetch_page(page, token))
            plays += got
            print(f"pagina {page}: {n} partite registrate ({len(got)} dei giochi scelti), totale BGG {total}")
            if n < 100:
                break
            page += 1
            time.sleep(2)
    plays = sorted({p["id"]: p for p in plays}.values(), key=lambda p: (p["date"], p["id"]))
    data = {
        "username": CONFIG["username"],
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "plays": plays,
    }
    path = os.path.join(ROOT, "data", "plays.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"Salvate {len(plays)} partite in {path}")


if __name__ == "__main__":
    main()
