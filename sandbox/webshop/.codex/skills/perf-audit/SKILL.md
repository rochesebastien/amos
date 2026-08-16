---
name: perf-audit
description: Auditer les performances du storefront (LCP, bundle, requêtes N+1).
---

# perf-audit

1. `npm run build` puis inspecter la taille des chunks.
2. Chercher les requêtes N+1 dans `src/api`.
3. Rendre un rapport court : 3 problèmes max, classés par impact.
