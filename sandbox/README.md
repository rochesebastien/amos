# Sandbox — projets fictifs pour tester AMOS à la main

Quatre faux projets de code, chacun conçu pour exercer un angle différent de
l'application. Pour les utiliser : dans AMOS, ajouter un projet et pointer vers
le dossier voulu (`sandbox/webshop`, etc.).

## Les projets

| Projet | Écosystème | Ce qu'il permet de tester |
| --- | --- | --- |
| `webshop` | Claude **et** Codex | Le cas riche : 3 agents (dont un dans un sous-dossier), 2 skills Claude + 1 skill Codex, 3 serveurs MCP en `.mcp.json` + 2 en `config.toml`, `CLAUDE.md` + `AGENTS.md` à la racine et un `AGENTS.md` imbriqué dans `packages/payments`. |
| `meteo-cli` | Claude uniquement | Un projet mono-écosystème : la sidebar et la vue projet ne doivent montrer que du Claude, aucun résidu Codex. |
| `pixel-runner` | Codex uniquement | L'inverse : `AGENTS.md` (racine + `levels/`), `config.toml` avec 2 serveurs MCP, une skill Codex, zéro fichier Claude. |
| `legacy-intranet` | Cassé exprès | Les erreurs de scan : frontmatter YAML invalide, types absurdes, skill sans `name`, `.mcp.json` et `config.toml` malformés. AMOS doit les **afficher** (badge Invalid, erreurs), pas les avaler ni planter. |

## Scénarios de test rapides

1. **Scan & arborescence** — ajouter `webshop`, vérifier que la sidebar liste
   agents / skills / MCP / instructions avec les bons badges d'écosystème.
2. **Recherche (⌘K)** — chercher `deploy`, `checkout`, `postgres`, `CLAUDE.md` :
   les résultats doivent arriver groupés (projets, agents, skills, MCP,
   instructions) et rester plafonnés par groupe.
3. **Éditeurs** — ouvrir `code-reviewer` (agent), `checkout-flow` (skill), un
   serveur MCP ; modifier, sauver, vérifier que le fichier sur disque suit.
4. **Watch** — modifier `sandbox/webshop/CLAUDE.md` depuis un autre éditeur :
   AMOS doit rafraîchir tout seul.
5. **Erreurs** — ajouter `legacy-intranet` et vérifier que chaque fichier cassé
   est signalé proprement, sans faire tomber le scan des autres projets.
6. **Multi-projets** — tout ajouter d'un coup et vérifier que la recherche
   globale mélange bien les quatre projets.

Tout est fictif : URLs en `.example.com`, aucun secret, aucun vrai service.
