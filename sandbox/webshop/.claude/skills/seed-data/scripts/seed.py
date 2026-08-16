"""Seed the local webshop database with plausible demo data."""
import random

PRODUCTS = ["Mug", "T-shirt", "Poster", "Sticker pack", "Hoodie"]

def seed(count: int = 50) -> list[dict]:
    return [
        {"name": random.choice(PRODUCTS), "price_cents": random.randint(500, 5000)}
        for _ in range(count)
    ]

if __name__ == "__main__":
    print(f"seeded {len(seed())} products")
