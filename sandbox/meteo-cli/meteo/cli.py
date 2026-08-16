"""Entry point of the fictional weather CLI."""
from meteo.providers import PROVIDERS


def main() -> None:
    provider = PROVIDERS["openmeteo"]
    print(provider.forecast("Paris"))


if __name__ == "__main__":
    main()
