"""Search only user-authored text and safe file metadata, never task projections."""
import re
import unicodedata
from .page_formatting import mention_text


def normalized_text(value):
    value = unicodedata.normalize("NFKD", value.casefold())
    return " ".join(re.findall(r"[^\W_]+", "".join(c for c in value if not unicodedata.combining(c))))


def page_text(page,*,include_code=True):
    return "\n".join([page.title, *((row.get('text','') if include_code else mention_text(row)) for row in page.blocks if row.get("type") != "task" and (include_code or row.get('type')!='code'))])


def message_text(message):
    media = getattr(message, "media", None)
    values = [message.body]
    if media:
        values.extend([media.filename, media.mime_type, {"image":"imagen", "audio":"nota de voz audio", "document":"documento archivo"}.get(media.kind, "archivo")])
    return "\n".join(values)


def snippet(value, query, limit=240):
    # Positions are mapped back to original characters, so accents/casefold do
    # not corrupt the displayed text. Return text, never HTML from the database.
    folded, positions = [], []
    for index, char in enumerate(value):
        for unit in unicodedata.normalize("NFKD", char.casefold()):
            if not unicodedata.combining(unit):
                folded.append(unit)
                positions.append(index)
    terms = query.split()
    text = "".join(folded)
    matches = [text.find(term) for term in terms if term in text]
    center = positions[min(matches)] if matches else 0
    start = max(0, center - 70)
    end = min(len(value), start + limit)
    return ("…" if start else "") + value[start:end] + ("…" if end < len(value) else "")
