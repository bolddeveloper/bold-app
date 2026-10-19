"""Recover times from production notes, preserving ambiguous source text."""
import re
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

CLOCK = r"\d{1,2}(?:[:.]\d{2})?\s*(?:[ap]\s*\.?\s*m\.?)?"
RANGE = re.compile(rf"(?<!\d)(?P<start>{CLOCK})\s*(?:a(?![a-z])|hasta\b|[-–—])\s*(?P<end>{CLOCK})(?![\d:])", re.I)
EXPLICIT_PAIR = re.compile(r"(?<!\d)(?P<start>\d{1,2}(?::\d{2})?\s*[ap]\.?\s*m\.?)\s+(?P<end>\d{1,2}(?::\d{2})?\s*[ap]\.?\s*m\.?)(?!\d)", re.I)
TOKEN = re.compile(rf"(?<!\d){CLOCK}(?!\d)", re.I)


def clock_minutes(value, daytime):
    value = re.sub(r"\s|\.", "", value.lower().replace(".", ":", 1) if re.search(r"\d\.\d", value) else value.lower())
    match = re.fullmatch(r"(\d{1,2})(?::(\d{2}))?([ap]m)?", value)
    if not match:
        raise ValueError("Hora no reconocida")
    hour, minute, period = int(match[1]), int(match[2] or 0), match[3]
    if minute > 59 or hour > 23 or period and not 1 <= hour <= 12:
        raise ValueError("Hora fuera de rango")
    if period:
        hour = hour % 12 + (12 if period == "pm" else 0)
    elif not daytime:
        raise ValueError("Falta AM/PM")
    elif 1 <= hour <= 5:
        hour += 12
    return hour * 60 + minute, period is None


def production_schedule(text, day, *, daytime=False, default_minutes=60, zone="America/Guatemala"):
    blocks, warnings = [], []
    for piece in re.split(r"\n+|\s*\|\s*|\s*/\s*(?=[a-záéíóúñ])", text, flags=re.I):
        piece = piece.strip()
        if not piece:
            continue
        normalized = re.sub(r"(\d{1,2}):\s*([ap]m)", r"\1\2", piece, flags=re.I)
        consumed = []
        ranges = sorted([*RANGE.finditer(normalized), *EXPLICIT_PAIR.finditer(normalized)], key=lambda match: match.start())
        candidates = []
        for match in ranges:
            if any(start <= match.start() < end for start, end in consumed):
                continue
            consumed.append(match.span())
            # Street numbers such as "15 calle 8-13" are not appointments.
            if re.search(r"(?:calle|avenida|zona|km|kilómetro|k)\s*$", normalized[:match.start()], re.I):
                continue
            candidates.append((match.start(), match["start"], match["end"]))
        for match in TOKEN.finditer(normalized):
            if any(start <= match.start() < end for start, end in consumed):
                continue
            value = match.group().strip()
            explicit = re.search(r"[:.]\d{2}|[ap]\s*\.?\s*m", value, re.I)
            bare_start = re.search(r"desde\s+(?:las\s+)?$", normalized[:match.start()], re.I)
            if explicit or bare_start:
                candidates.append((match.start(), value, None))
        for _, start_text, end_text in sorted(candidates):
            try:
                start, inferred_start = clock_minutes(start_text, daytime)
                end, inferred_end = clock_minutes(end_text, daytime) if end_text else (start + default_minutes, False)
                if inferred_start and end_text and re.search(r"p\s*\.?\s*m", end_text, re.I) and 6 * 60 <= start < 12 * 60 and end - start > 12 * 60:
                    start += 12 * 60
                if end <= start:
                    end += 1440
                if not 0 < end - start <= 12 * 60:
                    raise ValueError("Intervalo superior a 12 horas; revisar AM/PM")
            except ValueError as error:
                warnings.append(f"{piece}: {error}")
                continue
            midnight = datetime.combine(day, time(), ZoneInfo(zone))
            note = "AM/PM interpretado según el intervalo y la jornada acordada. " if inferred_start or inferred_end else ""
            if not end_text:
                note += f"Sin hora final en el original: duración provisional de {default_minutes} minutos."
            blocks.append({"summary": piece[:200], "start": {"dateTime": (midnight + timedelta(minutes=start)).isoformat()},
                "end": {"dateTime": (midnight + timedelta(minutes=end)).isoformat()}, "note": note.strip()})
    return blocks, warnings
