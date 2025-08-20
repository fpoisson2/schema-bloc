Construis ton système — Schéma‑bloc (Flask)

Lancer en local
- Prérequis: Python 3.9+.
- Installer dépendances: `python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt`
- Démarrer: `FLASK_APP=app.py flask run` (ou `python app.py`)
- Ouvrir: http://localhost:5000

Fonctionnalités
- Accueil: Solo, créer/rejoindre une salle (code).
- Pioche: bouton « Piger » sort 4 éléments + 1 aléa.
- Tableau: blocs déplaçables, liens Énergie (rouge, épais) et Signal (bleu, fin).
- Édition: double-clic sur un bloc ou un lien pour ajouter un texte.
- Grille: magnétique (20 px), activable/désactivable.
- Export: PNG direct; PDF via fenêtre d’impression (client).
- Sauvegarde: locale (localStorage) ou serveur (`/save` avec `roomId`).

API minimale
- `GET /` page d’accueil
- `GET /deck` deck JSON inclus dans le repo
- `POST /create` -> `{ roomId }`
- `POST /join` -> `{ roomId }` si existe
- `POST /save` payload `{ roomId, team, state:{blocks,links}, meta:{alea,notes} }`
- `GET /load/<roomId>` -> sauvegarde JSON

Notes
- Les exports PDF se font côté client via la fenêtre d’impression (choisir « Enregistrer en PDF »).
- Le dossier `saves/` est créé automatiquement pour stocker les JSON de salles.

