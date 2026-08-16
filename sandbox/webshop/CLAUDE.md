# webshop — instructions Claude

Boutique en ligne fictive (React + Express + Stripe).

## Règles
- Le code métier vit dans `src/api`, l'UI dans `src/web`.
- Toute modification du checkout passe par la skill `checkout-flow`.
- Jamais de montant en float : les prix sont en centimes (`number` entier).
- Les tests sont obligatoires pour `packages/payments`.
