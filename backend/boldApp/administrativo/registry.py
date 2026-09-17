from collections import OrderedDict


class AdministrativeModuleRegistry:
    def __init__(self):
        self._providers = OrderedDict()

    def register(self, provider):
        if not provider.code or provider.code in self._providers:
            raise ValueError(f"Proveedor administrativo duplicado o inválido: {provider.code}")
        self._providers[provider.code] = provider
        return provider

    def providers(self):
        return tuple(self._providers.values())


administrative_modules = AdministrativeModuleRegistry()

