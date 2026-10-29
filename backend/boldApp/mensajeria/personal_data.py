"""Batch personal indicators only after the caller has authorized the sources."""
from django.db.models import Exists, OuterRef
from .models import SavedItem, SearchDocument


def prime_saved(sources, field, employee_id):
    sources = list(sources)
    documents = SearchDocument.objects.filter(**{field + "__in": [row.pk for row in sources]}).annotate(
        saved=Exists(SavedItem.objects.filter(employee_id=employee_id, document_id=OuterRef("pk"))))
    state = {getattr(row, field + "_id"): {"saved": row.saved, "saved_document_id": str(row.pk)} for row in documents}
    for source in sources:
        source._personal_saved = (str(employee_id), state.get(source.pk, {"saved": False, "saved_document_id": None}))
    return sources


def saved_data(source, field, employee_id):
    cached = getattr(source, "_personal_saved", None)
    if not cached or cached[0] != str(employee_id):
        prime_saved([source], field, employee_id)
    return source._personal_saved[1]
