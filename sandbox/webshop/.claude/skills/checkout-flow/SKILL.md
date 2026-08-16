---
name: checkout-flow
description: Modifier le tunnel de commande sans casser la conversion.
license: MIT
---

# checkout-flow

Étapes du tunnel : panier → livraison → paiement → confirmation.

1. Lire `src/web/checkout.tsx` avant toute modification.
2. Les étapes sont pilotées par la machine à états dans `src/api/orders.ts`.
3. Tester le cas "panier vide" et le cas "paiement refusé".
