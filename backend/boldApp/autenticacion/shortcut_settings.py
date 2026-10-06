import re
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

DEFAULTS = {
    "home": "Ctrl+Shift+1", "tasks": "Ctrl+Shift+2", "projects": "Ctrl+Shift+3",
    "workspaces": "Ctrl+Shift+4", "calendar": "Ctrl+Shift+5", "drive": "Ctrl+Shift+6",
    "docs": "Ctrl+Shift+7", "inbox": "Ctrl+Shift+8", "profile": "Ctrl+Shift+9",
    "suggestions": "Ctrl+Shift+0", "reports": "Ctrl+Alt+I", "permissions": "Ctrl+Alt+P",
    "administration": "Ctrl+Alt+A", "search": "Ctrl+K", "notifications": "Ctrl+Alt+N",
    "theme": "Ctrl+Alt+T",
}

class ShortcutSettingsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({**DEFAULTS, **request.user.shortcut_settings})

    def put(self, request):
        data = request.data
        if not isinstance(data, dict) or set(data) - set(DEFAULTS):
            raise serializers.ValidationError("Atajo desconocido.")
        values = {**DEFAULTS, **data}
        used = set()
        for value in values.values():
            if not isinstance(value, str) or (value and not re.fullmatch(r"(?:Ctrl\+|Meta\+)(?:Alt\+)?(?:Shift\+)?[A-Z0-9]", value)):
                raise serializers.ValidationError("Usa Ctrl o Meta y una letra o número; Alt y Shift son opcionales.")
            if value and not ("Alt+" in value or re.search(r"[0-9]$", value)) and value[-1] != "K":
                raise serializers.ValidationError("Esa combinación está reservada. Añade Alt o elige un número.")
            if value and value in used:
                raise serializers.ValidationError("Dos acciones no pueden usar el mismo atajo.")
            if value:
                used.add(value)
        request.user.shortcut_settings = values
        request.user.save(update_fields=["shortcut_settings", "updated_at"])
        return Response(values)
