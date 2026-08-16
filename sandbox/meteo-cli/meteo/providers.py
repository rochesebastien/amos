"""Weather providers. All network calls live here and only here."""


class Provider:
    def forecast(self, city: str) -> str:
        raise NotImplementedError


class OpenMeteo(Provider):
    def forecast(self, city: str) -> str:
        return f"{city}: 21°C, ciel dégagé (données fictives)"


PROVIDERS: dict[str, Provider] = {"openmeteo": OpenMeteo()}
