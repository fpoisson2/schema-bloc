Construis ton système — Schéma‑bloc (Flask)

Lancer en local
- Prérequis: Python 3.9+.
- Installer dépendances: `python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt`
- Démarrer: `FLASK_APP=app.py flask run` (ou `python app.py`)
- Ouvrir: http://localhost:5000

Déploiement (Gunicorn / Docker)
- Gunicorn local: `pip install -r requirements.txt && gunicorn -w 3 -b 0.0.0.0:5000 wsgi:app`
- Docker: `docker compose up --build` puis ouvrir http://localhost:5000
- Le volume `./saves` est monté dans le conteneur pour persister les salles.

Fonctionnalités
- Accueil: Solo, créer/rejoindre une salle (code).
- Pioche: « Piger » propose 1 à 100 séquences réalistes et orientées « problématique », avec nombre de cartes configurable + 1 problématique.
- Tableau: blocs déplaçables d’un simple clic (glisser), liens Énergie (rouge, épais) et Signal (bleu, fin). Astuce: avec l’outil flèche, clique sur un bloc pour démarrer un lien puis relâche sur la cible.
- Édition: double-clic sur un bloc ou un lien pour ajouter un texte.
- Suppression: sélectionne un bloc ou un lien puis appuie sur « Suppr » (Delete) ou « Retour arrière » (Backspace).
- Grille: magnétique (20 px), activable/désactivable.
- Export: PNG direct (cadrage automatique sur tout le schéma); PDF via fenêtre d’impression (client).
- Sauvegarde: locale (localStorage) ou serveur (`/save` avec `roomId`).
- Synchronisation: en salle, l’état est partagé en direct (SSE) — tout le monde voit la même chose et peut intervenir.

Jeu de casse‑têtes (puzzles)
- Un fichier statique `static/puzzles.json` contient ~100 casse‑têtes. Chaque entrée décrit une problématique plus spécifique, un objet à concevoir, une liste de blocs suggérés, et un intervalle de cartes recommandé (`min_cards`/`max_cards`).
- Schéma d’une entrée:
  - `id`: identifiant
  - `title`: formulation courte du défi
  - `target`: objet/système à imaginer
  - `problem`: contexte détaillé
  - `suggested_blocks`: libellés de cartes (issus de `deck.json`)
  - `min_cards`/`max_cards`: adapter le nombre de cartes à tirer
  - `tags`, `difficulty`: métadonnées
- Intégré dans l’UI: un sélecteur « Casse‑tête » charge `/puzzles.json`, affiche les détails, et propose deux actions:
  - « Adapter la pioche »: règle le nombre de cartes sur `min_cards` et fixe la « Problématique » au titre du casse‑tête.
  - « Pré‑remplir cartes »: prépare les « cartes suggérées » comme pioche (cliquables pour déposer sur le tableau).
  - Astuce: vous pouvez ensuite cliquer « Piger » pour générer d’autres propositions si besoin.

API minimale
- `GET /` page d’accueil
- `GET /deck` deck JSON inclus dans le repo
- `POST /create` -> `{ roomId }`
- `POST /join` -> `{ roomId }` si existe
- `POST /save` payload `{ roomId, team, state:{blocks,links}, meta:{alea,notes} }`
- `GET /load/<roomId>` -> sauvegarde JSON
- `GET /api/room/<roomId>/events` flux SSE d’événements de salle
- `POST /api/room/<roomId>/sync` synchronise et diffuse `{team?, state?, meta?}`
- `POST /api/room/<roomId>/draw` lance une pioche avec options `{count, sequences}` et diffuse les propositions
- `POST /api/room/<roomId>/choose_draw` choisit une séquence (index) et diffuse le choix

- Notes
- Les exports PDF se font côté client via la fenêtre d’impression (choisir « Enregistrer en PDF »).
- Le dossier `saves/` est créé automatiquement pour stocker les JSON de salles.
