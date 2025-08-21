import os
import json
import random
import string
from datetime import datetime

from flask import Flask, send_from_directory, request, jsonify, Response, stream_with_context
import threading
import queue
import time


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SAVES_DIR = os.path.join(BASE_DIR, "saves")
DECK_PATH = os.path.join(BASE_DIR, "deck.json")

os.makedirs(SAVES_DIR, exist_ok=True)


def gen_room_code(length: int = 6) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(length))


app = Flask(__name__, static_folder="static", static_url_path="")

# --- Simple in-memory pub/sub per room for SSE ---
_room_lock = threading.Lock()
_room_subs: dict[str, list[queue.Queue]] = {}


def _publish(room_id: str, event: dict):
    with _room_lock:
        subs = list(_room_subs.get(room_id, []))
    for q in subs:
        try:
            q.put_nowait(event)
        except Exception:
            pass


def _sse_format(event: dict) -> str:
    etype = event.get("type", "message")
    data = json.dumps(event.get("data", {}), ensure_ascii=False)
    return f"event: {etype}\n" + "data: " + data + "\n\n"


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


def _alea_preferences(deck: dict) -> dict[str, set[str]]:
    """Map each alea/problématique to a set of preferred card ids."""
    # Helper to build card id quickly
    def cid(cat_label: str, item_label: str) -> str:
        mapping = {
            "Sources": "src",
            "Traitement": "trt",
            "Communication": "com",
            "CapteursActionneurs": "cap",
            "Usages": "use",
        }
        pref = mapping.get(cat_label)
        return f"{pref}:{_slugify(item_label)}"

    prefs: dict[str, set[str]] = {}

    def add(alea_label: str, pairs: list[tuple[str, str]]):
        s = prefs.setdefault(alea_label, set())
        for cat, item in pairs:
            s.add(cid(cat, item))

    # Define simple heuristic preferences per problématique
    add("Ombre", [
        ("Sources", "Batterie 12 V"), ("Sources", "Prise murale"), ("Sources", "Dynamo (vélo)"),
        ("Traitement", "Régulateur (stabilise)"), ("Traitement", "Convertisseur DC/DC"), ("Traitement", "Onduleur (DC→AC)"),
    ])
    add("Panne de batterie", [
        ("Sources", "Prise murale"), ("Sources", "Soleil (panneau)"), ("Sources", "Vent (éolienne)"), ("Sources", "Dynamo (vélo)"),
        ("Traitement", "Régulateur (stabilise)"), ("Traitement", "Disjoncteur/Fusible"),
    ])
    add("Câble trop long (perte)", [
        ("Communication", "Routeur Wi-Fi"), ("Communication", "Point d’accès"), ("Communication", "Antenne tour"), ("Communication", "Satellite"),
        ("Traitement", "Convertisseur DC/DC"), ("Usages", "Répéteur d’urgence"),
    ])
    add("Polarité inversée", [
        ("Traitement", "Régulateur (stabilise)"), ("Traitement", "Disjoncteur/Fusible"),
    ])
    add("Surcharge", [
        ("Traitement", "Disjoncteur/Fusible"), ("Traitement", "Régulateur (stabilise)"),
    ])
    add("Température élevée", [
        ("CapteursActionneurs", "Capteur température"), ("CapteursActionneurs", "Ventilateur"),
    ])

    # Ensure only items that exist in the deck are kept (robustness)
    valid_ids = set()
    for cat, items in deck.get("categories", {}).items():
        for label in items:
            valid_ids.add(_card_id({
                "Sources": "src", "Traitement": "trt", "Communication": "com",
                "CapteursActionneurs": "cap", "Usages": "use",
            }[cat], label))
    for k, s in list(prefs.items()):
        prefs[k] = {i for i in s if i in valid_ids}
    return prefs


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
        # Broadcast to room subscribers if any
        _publish(code, {"type": "state_sync", "data": envelope})
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
        pref_map = _alea_preferences(deck)
        data = request.get_json(silent=True) or {}
        room_id = (data.get("roomId") or "").upper()

        # Parameters for realism and options
        count = int(data.get("count") or 4)
        sequences = int(data.get("sequences") or 1)

        # Helper: build a single realistic hand biased by alea preferences
        def draw_hand(rng: random.Random, n_cards: int, alea_label: str | None) -> list:
            # Ensure diversity: try to include core categories, then fill from pools
            picks = []
            seen_ids = set()
            prefer = pref_map.get(alea_label or "", set())
            def pick_from(pool: list):
                if not pool:
                    return None
                # Prefer items that help address the problématique
                preferred = [c for c in pool if c["id"] in prefer and c["id"] not in seen_ids]
                if preferred:
                    choices = preferred
                else:
                    choices = [c for c in pool if c["id"] not in seen_ids]
                if not choices:
                    choices = pool
                c = rng.choice(choices)
                seen_ids.add(c["id"])
                return c

            # Core categories (if available)
            if n_cards >= 1:
                p = pick_from(cards_by_cat.get("Sources", []))
                if p: picks.append(p)
            if n_cards >= 2:
                p = pick_from(cards_by_cat.get("Traitement", []))
                if p: picks.append(p)
            if n_cards >= 3:
                p = pick_from(cards_by_cat.get("Usages", []))
                if p: picks.append(p)
            if n_cards >= 4:
                pool_comcap = (cards_by_cat.get("Communication", []) +
                               cards_by_cat.get("CapteursActionneurs", []))
                p = pick_from(pool_comcap)
                if p: picks.append(p)
            # Fill remaining with a balanced pool (favoring Communication/Capteurs/Usages)
            pool_balanced = (cards_by_cat.get("Communication", []) +
                             cards_by_cat.get("CapteursActionneurs", []) +
                             cards_by_cat.get("Usages", []))
            while len(picks) < n_cards and pool_balanced:
                p = pick_from(pool_balanced)
                if p:
                    picks.append(p)
                else:
                    break
            return picks

        # Build one or multiple sequences
        rng = random.Random()
        proposals = []
        last_sig = None
        # Optional avoid-repeat: compare to last draw in save
        if room_id:
            save_path = os.path.join(SAVES_DIR, f"{room_id}.json")
            if os.path.exists(save_path):
                try:
                    with open(save_path, "r", encoding="utf-8") as f:
                        prev = json.load(f)
                    last_sig = prev.get("lastDrawSig")
                except Exception:
                    last_sig = None

        def sig(vals, alea_obj):
            return "+".join(sorted(v["id"] for v in vals) + ([alea_obj["id"]] if alea_obj else []))

        # Generate sequences, ensuring uniqueness and biasing picks to solve the problématique
        safety = max(200, sequences * 5)
        tries = 0
        while len(proposals) < max(1, sequences) and tries < safety:
            tries += 1
            alea_label = rng.choice(aleas) if aleas else None
            elems = draw_hand(rng, count, alea_label)
            alea_obj = {"id": _card_id("alea", alea_label), "label": alea_label} if alea_label else None
            s = sig(elems, alea_obj)
            if last_sig and s == last_sig:
                continue
            if any(sig([*p.get("elements", [])], p.get("alea")) == s for p in proposals):
                continue
            proposals.append({
                "elements": [{**c, "name": c.get("label"), "cat": c.get("category")} for c in elems],
                "alea": alea_obj,
            })

        # Save last signature of first proposal for repeat-avoidance
        if room_id and proposals:
            try:
                save_path = os.path.join(SAVES_DIR, f"{room_id}.json")
                env = {"lastDrawSig": sig([*proposals[0]["elements"]], proposals[0]["alea"]) }
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

        # Backward-compatible single sequence
        if sequences <= 1:
            p0 = proposals[0] if proposals else {"elements": [], "alea": None}
            return jsonify({"elements": p0.get("elements", []), "alea": p0.get("alea")})
        else:
            return jsonify({"proposals": proposals})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# --- SSE endpoints for room sync ---
@app.get("/api/room/<room_id>/events")
def room_events(room_id: str):
    room_id = (room_id or "").upper()
    q: queue.Queue = queue.Queue()
    with _room_lock:
        _room_subs.setdefault(room_id, []).append(q)

    def gen():
        # Send initial snapshot if available
        path = os.path.join(SAVES_DIR, f"{room_id}.json")
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    snapshot = json.load(f)
                yield _sse_format({"type": "state_sync", "data": snapshot})
            except Exception:
                pass
        last_heartbeat = time.time()
        try:
            while True:
                try:
                    evt = q.get(timeout=15)
                    yield _sse_format(evt)
                except queue.Empty:
                    # heartbeat comment to keep connection alive
                    yield ": ping\n\n"
                # rate limit heartbeats
                if time.time() - last_heartbeat > 30:
                    last_heartbeat = time.time()
        except GeneratorExit:
            pass
        finally:
            with _room_lock:
                subs = _room_subs.get(room_id, [])
                if q in subs:
                    subs.remove(q)

    return Response(stream_with_context(gen()), mimetype="text/event-stream")


@app.post("/api/room/<room_id>/sync")
def room_sync(room_id: str):
    room_id = (room_id or "").upper()
    data = request.get_json(silent=True) or {}
    path = os.path.join(SAVES_DIR, f"{room_id}.json")
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                old = json.load(f)
        else:
            old = {"roomId": room_id, "team": data.get("team"), "state": {"blocks": [], "links": [], "draws": []}, "meta": {}}
        # Merge
        if "team" in data:
            old["team"] = data["team"]
        if "state" in data:
            old["state"] = data["state"]
        if "meta" in data:
            m = old.get("meta", {})
            m.update(data["meta"])
            old["meta"] = m
        old["savedAt"] = datetime.utcnow().isoformat() + "Z"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(old, f, ensure_ascii=False, indent=2)
        _publish(room_id, {"type": "state_sync", "data": old})
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.post("/api/room/<room_id>/draw")
def room_draw(room_id: str):
    room_id = (room_id or "").upper()
    try:
        deck = _load_deck()
        cards_by_cat = _build_cards(deck)
        aleas = deck.get("aleas", [])
        pref_map = _alea_preferences(deck)
        data = request.get_json(silent=True) or {}
        count = int(data.get("count") or 4)
        sequences = int(data.get("sequences") or 1)
        rng = random.Random()

        def draw_hand(n_cards: int, alea_label: str | None) -> list:
            picks = []
            seen_ids = set()
            prefer = pref_map.get(alea_label or "", set())
            def pick_from(pool: list):
                if not pool:
                    return None
                preferred = [c for c in pool if c["id"] in prefer and c["id"] not in seen_ids]
                if preferred:
                    choices = preferred
                else:
                    choices = [c for c in pool if c["id"] not in seen_ids]
                if not choices:
                    choices = pool
                c = rng.choice(choices)
                seen_ids.add(c["id"])
                return c
            if n_cards >= 1:
                p = pick_from(cards_by_cat.get("Sources", []))
                if p: picks.append(p)
            if n_cards >= 2:
                p = pick_from(cards_by_cat.get("Traitement", []))
                if p: picks.append(p)
            if n_cards >= 3:
                p = pick_from(cards_by_cat.get("Usages", []))
                if p: picks.append(p)
            if n_cards >= 4:
                pool_comcap = (cards_by_cat.get("Communication", []) +
                               cards_by_cat.get("CapteursActionneurs", []))
                p = pick_from(pool_comcap)
                if p: picks.append(p)
            pool_balanced = (cards_by_cat.get("Communication", []) +
                             cards_by_cat.get("CapteursActionneurs", []) +
                             cards_by_cat.get("Usages", []))
            while len(picks) < n_cards and pool_balanced:
                p = pick_from(pool_balanced)
                if p:
                    picks.append(p)
                else:
                    break
            return picks

        def sig(vals, alea_obj):
            return "+".join(sorted(v["id"] for v in vals) + ([alea_obj["id"]] if alea_obj else []))

        proposals = []
        safety = max(200, sequences * 5)
        attempts = 0
        while len(proposals) < max(1, sequences) and attempts < safety:
            attempts += 1
            alea_label = rng.choice(aleas) if aleas else None
            elems = draw_hand(count, alea_label)
            alea_obj = {"id": _card_id("alea", alea_label), "label": alea_label} if alea_label else None
            s = sig(elems, alea_obj)
            if any(sig(p.get("elements", []), p.get("alea")) == s for p in proposals):
                continue
            proposals.append({
                "elements": [{**c, "name": c.get("label"), "cat": c.get("category")} for c in elems],
                "alea": alea_obj,
            })

        # Persist in room save
        path = os.path.join(SAVES_DIR, f"{room_id}.json")
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                old = json.load(f)
        else:
            old = {"roomId": room_id, "team": data.get("team"), "state": {"blocks": [], "links": [], "draws": []}, "meta": {}}
        old.setdefault("state", {})
        old["state"]["draws"] = {"proposals": proposals, "chosenIndex": None}
        old["savedAt"] = datetime.utcnow().isoformat() + "Z"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(old, f, ensure_ascii=False, indent=2)

        payload = {"proposals": proposals}
        _publish(room_id, {"type": "draws_updated", "data": payload})
        return jsonify({"ok": True, **payload})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.post("/api/room/<room_id>/choose_draw")
def room_choose_draw(room_id: str):
    room_id = (room_id or "").upper()
    data = request.get_json(silent=True) or {}
    try:
        idx = int(data.get("index"))
        path = os.path.join(SAVES_DIR, f"{room_id}.json")
        if not os.path.exists(path):
            return jsonify({"error": "Salle introuvable"}), 404
        with open(path, "r", encoding="utf-8") as f:
            old = json.load(f)
        draws = (old.get("state") or {}).get("draws") or {}
        proposals = draws.get("proposals") or []
        if not (0 <= idx < len(proposals)):
            return jsonify({"error": "Index invalide"}), 400
        draws["chosenIndex"] = idx
        old.setdefault("state", {})["draws"] = draws
        old.setdefault("meta", {})["alea"] = proposals[idx].get("alea", {}).get("label")
        old["savedAt"] = datetime.utcnow().isoformat() + "Z"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(old, f, ensure_ascii=False, indent=2)
        _publish(room_id, {"type": "draw_chosen", "data": {"index": idx, "proposal": proposals[idx]}})
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    # For local dev convenience
    app.run(host="0.0.0.0", port=5000, debug=True)
