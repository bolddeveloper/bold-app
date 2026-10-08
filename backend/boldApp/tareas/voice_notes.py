"""Short recordings stored with their task; audio is read through task permissions."""
import base64
import binascii
import re
import uuid

from django.http import HttpResponse
from rest_framework import serializers
from rest_framework.exceptions import NotFound, ValidationError

MAX_AUDIO_BYTES = 1024 * 1024
MAX_TOTAL_BYTES = 1536 * 1024


def validate_notes(value, previous=()):
    if not isinstance(value, list) or len(value) > 3:
        raise ValidationError("Puedes agregar hasta tres notas de voz de dos minutos.")
    saved = {note["id"]: note for note in previous}
    notes, total, seen = [], 0, set()
    for item in value:
        if not isinstance(item, dict):
            raise ValidationError("Nota de voz inválida.")
        if "data_url" not in item:
            if not isinstance(item.get("id"), str) or item["id"] not in saved or item["id"] in seen:
                raise ValidationError("La nota de voz no pertenece a este registro.")
            note = saved[item["id"]]
        else:
            data = item["data_url"]
            match = re.fullmatch(r"data:(audio/(?:webm|ogg|mp4|mpeg|wav));base64,([A-Za-z0-9+/=]+)", data) if isinstance(data, str) and len(data) <= MAX_AUDIO_BYTES * 4 // 3 + 100 else None
            if not match:
                raise ValidationError("Usa audio WebM, OGG, MP4, MP3 o WAV de hasta 1 MB.")
            try:
                raw = base64.b64decode(match[2], validate=True)
            except binascii.Error as error:
                raise ValidationError("Audio inválido.") from error
            valid = {"audio/webm": raw.startswith(b"\x1aE\xdf\xa3"), "audio/ogg": raw.startswith(b"OggS"),
                     "audio/mp4": raw[4:8] == b"ftyp", "audio/mpeg": raw.startswith(b"ID3") or (len(raw) > 1 and raw[0] == 255 and raw[1] & 224 == 224),
                     "audio/wav": raw.startswith(b"RIFF") and raw[8:12] == b"WAVE"}
            duration = item.get("duration", 0)
            if not raw or len(raw) > MAX_AUDIO_BYTES or not valid[match[1]] or isinstance(duration, bool) or not isinstance(duration, (int, float)) or not 0 < duration <= 120:
                raise ValidationError("Audio inválido: máximo 1 MB y dos minutos.")
            name = item.get("name", "Nota de voz")
            if not isinstance(name, str) or not 1 <= len(name) <= 120:
                raise ValidationError("Nombre de audio inválido.")
            note = {"id": str(uuid.uuid4()), "name": name, "duration": duration, "mime_type": match[1], "size_bytes": len(raw), "data_url": data}
        total += note["size_bytes"]
        seen.add(note["id"])
        notes.append(note)
    if total > MAX_TOTAL_BYTES:
        raise ValidationError("Las notas de voz juntas no pueden superar 1,5 MB.")
    return notes


class VoiceNotesField(serializers.JSONField):
    def to_internal_value(self, data):
        previous = getattr(self.parent.instance, "voice_notes", [])
        return validate_notes(data, previous)

    def to_representation(self, value):
        # Keep recordings out of list responses, notifications and realtime events.
        return [{key: note[key] for key in ("id", "name", "duration", "mime_type", "size_bytes")} for note in value]


def audio_response(notes, note_id):
    note = next((item for item in notes if item["id"] == note_id), None)
    if not note:
        raise NotFound("La nota de voz ya no está disponible.")
    response = HttpResponse(base64.b64decode(note["data_url"].split(",", 1)[1]), content_type=note["mime_type"])
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response
