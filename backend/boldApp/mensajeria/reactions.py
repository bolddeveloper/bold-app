"""Bounded aggregated projections, after the caller authorizes the real source."""
from django.db.models import Count, Exists, OuterRef
from .models import SearchDocument, MessageReaction, ReactionActorState

CATALOG = (
    ("smile", "😀", "Sonrisa"), ("thumbs_up", "👍", "De acuerdo"),
    ("heart", "❤️", "Corazón"), ("celebrate", "🎉", "Celebración"),
    ("eyes", "👀", "Visto"), ("done", "✅", "Listo"),
    ("thanks", "🙏", "Gracias"), ("rocket", "🚀", "Adelante"),
    ("laugh", "😂", "Risa"), ("thinking", "🤔", "Pensando"),
    ("clap", "👏", "Aplausos"), ("fire", "🔥", "Excelente"),
    ("surprised", "😮", "Sorpresa"), ("sad", "😢", "Tristeza"),
    ("question", "❓", "Pregunta"), ("warning", "⚠️", "Atención"),
)
CHOICES = [{"key":key, "emoji":emoji, "label":label} for key, emoji, label in CATALOG]
MAX_OWN_REACTIONS = 8


def snapshots(documents, employee_id):
    documents = list(documents)
    state = {row.pk:{"version":row.reaction_version, "own_version":0, "items":[]} for row in documents}
    if not state:
        return state
    for actor in ReactionActorState.objects.filter(document_id__in=state, employee_id=employee_id):
        state[actor.document_id]["own_version"] = actor.version
    mine = MessageReaction.objects.filter(document_id=OuterRef("document_id"), key=OuterRef("key"), employee_id=employee_id)
    rows = MessageReaction.objects.filter(document_id__in=state).values("document_id", "key").annotate(count=Count("pk"), mine=Exists(mine))
    choices = {row["key"]:row for row in CHOICES}
    for row in rows:
        if row["key"] in choices:
            state[row["document_id"]]["items"].append({**choices[row["key"]], "count":row["count"], "mine":row["mine"]})
    order = {key:index for index, (key, *_) in enumerate(CATALOG)}
    for value in state.values():
        value["items"].sort(key=lambda row:order[row["key"]])
    return state


def prime_reactions(sources, field, employee_id):
    sources = list(sources)
    documents = list(SearchDocument.objects.filter(**{field + "__in":[row.pk for row in sources]}).only("id", field, "reaction_version"))
    state = snapshots(documents, employee_id)
    by_source = {getattr(row, field + "_id"):state[row.pk] for row in documents}
    for source in sources:
        source._reactions = (str(employee_id), by_source.get(source.pk, {"version":0, "own_version":0, "items":[]}))


def reaction_data(source, field, employee_id):
    cached = getattr(source, "_reactions", None)
    if not cached or cached[0] != str(employee_id):
        prime_reactions([source], field, employee_id)
    return source._reactions[1]
