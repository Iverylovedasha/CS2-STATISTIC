import os
import json
import time
import requests
from datetime import datetime, timezone

API_KEY = os.environ["STEAM_API_KEY"]
STEAM_ID = os.environ.get("STEAM_ID", "76561198000000000")  # 👈 поменяйте

HEADERS = {"User-Agent": "Mozilla/5.0 (CS2-Stats-Tracker)"}


def get_playtime(steam_id):
    url = "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/"
    params = {
        "key": API_KEY,
        "steamid": steam_id,
        "include_appinfo": 0,
        "include_played_free_games": 1,
        "appids_filter[0]": 730,
    }
    for attempt in range(3):
        try:
            r = requests.get(url, params=params, timeout=15)
            r.raise_for_status()
            games = r.json().get("response", {}).get("games", [])
            return games[0].get("playtime_forever", 0) if games else 0
        except Exception as e:
            print(f"playtime attempt {attempt+1} failed: {e}")
            time.sleep(3)
    return 0


def get_inventory(steam_id):
    url = f"https://steamcommunity.com/inventory/{steam_id}/730/2"
    params = {"l": "english", "count": 5000}
    for attempt in range(3):
        try:
            r = requests.get(url, params=params, headers=HEADERS, timeout=30)
            r.raise_for_status()
            data = r.json()
            if not data.get("success"):
                return []
            desc_map = {
                (d.get("classid"), d.get("instanceid")): d
                for d in data.get("descriptions", [])
            }
            items = []
            for a in data.get("assets", []):
                d = desc_map.get((a.get("classid"), a.get("instanceid")))
                if not d:
                    continue
                items.append({
                    "name": d.get("market_name") or d.get("name"),
                    "type": d.get("type"),
                    "rarity": d.get("rarity"),
                    "icon": (
                        f"https://community.cloudflare.steamstatic.com/economy/image/{d['icon_url']}"
                        if d.get("icon_url") else None
                    ),
                    "tradable": bool(d.get("tradable")),
                })
            return items
        except Exception as e:
            print(f"inventory attempt {attempt+1} failed: {e}")
            time.sleep(5)
    return []


def main():
    playtime_min = get_playtime(STEAM_ID)
    inventory = get_inventory(STEAM_ID)

    data = {
        "steam_id": STEAM_ID,
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "playtime_minutes": playtime_min,
        "playtime_hours": round(playtime_min / 60, 1),
        "inventory": inventory,
        "inventory_count": len(inventory),
    }

    with open("data.json", "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"Saved: {playtime_min} min, {len(inventory)} items")


if __name__ == "__main__":
    main()
