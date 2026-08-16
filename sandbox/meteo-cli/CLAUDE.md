# meteo-cli — instructions Claude

Petit CLI météo en Python. Écosystème Claude uniquement :
ce projet n'a ni AGENTS.md ni .codex/.

## Règles
- Python 3.11+, typé, formaté avec ruff.
- Les appels réseau vivent dans `meteo/providers.py`, nulle part ailleurs.
- La sortie utilisateur passe par `rich`, jamais par `print` nu.
