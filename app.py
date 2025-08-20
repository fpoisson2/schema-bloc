import os
import json
import random
import string
from datetime import datetime

from flask import Flask, send_from_directory, request, jsonify


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SAVES_DIR = os.path.join(BASE_DIR, "saves")
DECK_PATH = os.path.join(BASE_DIR, "deck.json")

os.makedirs(SAVES_DIR, exist_ok=True)


def gen_room_code(length: int = 6) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(length))


app = Flask(__name__, static_folder="static", static_url_path="")


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


def _load_deck():
    with open(DECK_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _slugify(label: str) -> str:
    s = label.lower()
    repl = {
        "é": "e", "è": "e", "ê": "e", "à": "a", "â": "a", "ô": "o", "ù": "u", "û": "u",
        "ï": "i", "î": "i", "ç": "c",
    }
    for k, v in repl.items():
        s = s.replace(k, v)
    allowed = string.ascii_lowercase + string.digits + "- "
    s = "".join(ch if ch in allowed else "-" for ch in s)
    s = s.replace(" ", "-").replace("--", "-").strip("-")
    return s


def _card_id(prefix: str, label: str) -> str:
    return f"{prefix}:{_slugify(label)}"


def _build_cards(deck: dict) -> dict:
    # Returns mapping category -> list of cards {id,label,category}
    mapping = {
        "Sources": "src",
        "Traitement": "trt",
        "Communication": "com",
        "CapteursActionneurs": "cap",
        "Usages": "use",
    }
    cards = {}
    for cat, items in deck.get("categories", {}).items():
        if cat not in mapping:
            continue
        pref = mapping[cat]
        cards[cat] = [{
            "id": _card_id(pref, label),
            "label": label,
            "category": cat,
        } for label in items]
    return cards


@app.get("/deck")
def get_deck():
    try:
        deck = _load_deck()
        return jsonify(deck)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.get("/api/deck")
def api_deck():
    try:
        deck = _load_deck()
        return jsonify(deck)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.post("/create")
def create_room():
    data = request.get_json(silent=True) or {}
    team = data.get("team", "")
    code = gen_room_code()
    save_path = os.path.join(SAVES_DIR, f"{code}.json")
    payload = {
        "roomId": code,
        "team": team,
        "createdAt": datetime.utcnow().isoformat() + "Z",
        "state": {
            "blocks": [],
            "links": [],
            "draws": [],
        },
        "meta": {},
    }
    with open(save_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    return jsonify({"roomId": code})


@app.post("/join")
def join_room():
    data = request.get_json(silent=True) or {}
    code = (data.get("roomId") or "").upper()
    path = os.path.join(SAVES_DIR, f"{code}.json")
    if not code:
        return jsonify({"error": "roomId requis"}), 400
    if not os.path.exists(path):
        return jsonify({"error": "Salle introuvable"}), 404
    return jsonify({"roomId": code})


@app.post("/save")
def save_state():
    data = request.get_json(silent=True) or {}
    code = (data.get("roomId") or "").upper()
    if not code:
        return jsonify({"error": "roomId requis"}), 400
    path = os.path.join(SAVES_DIR, f"{code}.json")
    envelope = {
        "roomId": code,
        "team": data.get("team"),
        "savedAt": datetime.utcnow().isoformat() + "Z",
        "state": data.get("state", {}),
        "meta": data.get("meta", {}),
    }
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(envelope, f, ensure_ascii=False, indent=2)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.get("/load/<room_id>")
def load_state(room_id: str):
    code = (room_id or "").upper()
    path = os.path.join(SAVES_DIR, f"{code}.json")
    if not os.path.exists(path):
        return jsonify({"error": "Salle introuvable"}), 404
    with open(path, "r", encoding="utf-8") as f:
        payload = json.load(f)
    return jsonify(payload)


@app.post("/api/draw")
def api_draw():
    try:
        deck = _load_deck()
        cards_by_cat = _build_cards(deck)
        aleas = deck.get("aleas", [])
        data = request.get_json(silent=True) or {}
        room_id = (data.get("roomId") or "").upper()

        # Balanced picks
        rng = random.Random()
        pick_src = rng.choice(cards_by_cat.get("Sources", []))
        pick_trt = rng.choice(cards_by_cat.get("Traitement", []))
        pool3 = (cards_by_cat.get("Communication", []) +
                 cards_by_cat.get("CapteursActionneurs", []))
        pick_3 = rng.choice(pool3) if pool3 else None
        pick_use = rng.choice(cards_by_cat.get("Usages", []))
        pick_alea_label = rng.choice(aleas) if aleas else None
        pick_alea = {"id": _card_id("alea", pick_alea_label), "label": pick_alea_label}

        # Ensure uniqueness within the hand
        elements = [c for c in [pick_src, pick_trt, pick_3, pick_use] if c]
        seen = set()
        unique = []
        for c in elements:
            if c["id"] in seen:
                # redraw from that category/pool
                cat = c["category"]
                pool = cards_by_cat.get(cat, []) if cat != "Communication/Capteurs" else pool3
                alt = [x for x in pool if x["id"] not in seen]
                c = rng.choice(alt) if alt else c
            unique.append(c)
            seen.add(c["id"])

        # Optional avoid-repeat: compare to last draw in save
        if room_id:
            save_path = os.path.join(SAVES_DIR, f"{room_id}.json")
            last_sig = None
            if os.path.exists(save_path):
                try:
                    with open(save_path, "r", encoding="utf-8") as f:
                        prev = json.load(f)
                    last_sig = prev.get("lastDrawSig")
                except Exception:
                    last_sig = None
            attempts = 0
            def sig(vals):
                return "+".join(sorted(v["id"] for v in vals) + [pick_alea["id"]])
            while last_sig and sig(unique) == last_sig and attempts < 5:
                # redraw pool3 element and alea
                if pool3:
                    pick_3 = rng.choice(pool3)
                    unique[2] = pick_3
                if aleas:
                    pick_alea_label = rng.choice(aleas)
                    pick_alea = {"id": _card_id("alea", pick_alea_label), "label": pick_alea_label}
                attempts += 1
            # Save signature back for next time
            try:
                env = {"lastDrawSig": sig(unique)}
                if os.path.exists(save_path):
                    with open(save_path, "r", encoding="utf-8") as f:
                        old = json.load(f)
                    old.update(env)
                    with open(save_path, "w", encoding="utf-8") as f:
                        json.dump(old, f, ensure_ascii=False, indent=2)
                else:
                    with open(save_path, "w", encoding="utf-8") as f:
                        json.dump(env, f, ensure_ascii=False, indent=2)
            except Exception:
                pass

        elements_out = [
            {**c, "name": c.get("label"), "cat": c.get("category")}
            for c in unique
        ]
        return jsonify({
            "elements": elements_out,
            "alea": pick_alea,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    # For local dev convenience
    app.run(host="0.0.0.0", port=5000, debug=True)
