"""Explicit @email tokens are person references, not channel invitations."""
import re
from django.db.models import Prefetch
from django.db.models.functions import Lower
from rest_framework.exceptions import ValidationError

from boldApp.core.models import Employee, PositionAssignment
from .channel_access import ChannelPolicy
from .models import ChannelAccessRule, ResourceMention, SearchDocument

MAX_MENTIONS = 20
TOKEN = re.compile(r"(?<![A-Za-z0-9._%+@-])(@[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,189}\.[A-Za-z]{2,24})(?![A-Za-z0-9_%+@-]|\.[A-Za-z0-9])", re.IGNORECASE)
# Only try a URI scheme at its first possible character. Without this boundary,
# a long word with no :// retries the greedy scheme from every character (O(n²)).
LITERAL = re.compile(r"```[\s\S]*?```|`[^`\n]*`|(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]*://\S+|mailto:\S+", re.IGNORECASE)


def mention_tokens(body):
    if '@' not in body:
        return set()
    # Mask literals in one pass, preserving boundaries even in 100 KB pages.
    plain = LITERAL.sub(lambda match: ' ' * len(match.group()), body)
    return {match.group(1).lower() for match in TOKEN.finditer(plain)}


def with_mention_assignments(people):
    return people.select_related("user_account").prefetch_related(Prefetch("position_assignments",
        queryset=PositionAssignment.objects.filter(is_active=True, released_at__isnull=True)
        .select_related("employee__user_account", "position__unit", "position__job_role"), to_attr="mention_assignments"))


def authorized_people(people, channel, permissions, codes=("slack.channel.read",)):
    people = list(people)
    rules = dict(ChannelAccessRule.objects.filter(channel=channel, employee_id__in=[person.pk for person in people])
        .values_list("employee_id", "access"))
    result = []
    for person in people:
        access = rules.get(person.pk)
        if access == "blocked" or channel.visibility == "private" and access not in ("read", "write"):
            continue
        for assignment in person.mention_assignments:
            if channel.visibility == "department" and access not in ("read", "write") and assignment.position.unit_id != channel.unit_id:
                continue
            policy = ChannelPolicy(assignment, permissions=permissions)
            policy.resources[("slack_channel", str(channel.pk))] = {"id": channel.pk, "unit_id": channel.unit_id,
                "creator_id": channel.creator_id, "creator__employee_id": channel.creator.employee_id,
                "visibility": channel.visibility, "access": access}
            # Another person's session/MFA cannot be asserted during selection.
            # Receiving content and push projections still enforce that session.
            if all(policy.allows(code, channel.unit, channel.pk, require_assurance=False) for code in codes):
                result.append(person)
                break
    return result


def sync_channel_mentions(message, policy):
    return _sync_message_mentions(message, "channel_message", lambda tokens: authorized_people(
        with_mention_assignments(_people_for_tokens(tokens)), message.channel, policy.permissions))


def _people_for_tokens(tokens):
    return Employee.objects.filter(is_active=True, user_account__is_active=True).annotate(
        mention_email=Lower("user_account__email")).filter(mention_email__in=[token[1:] for token in tokens])


def direct_mention_people(conversation):
    from .presenters import people, available
    return [person for person in people().filter(pk__in=[conversation.first_employee_id, conversation.second_employee_id])
        if available(person)]


def sync_direct_mentions(message):
    # A typed reference cannot add a third participant, even when forwarded.
    return _sync_message_mentions(message, "direct", lambda tokens: [person for person in direct_mention_people(message.conversation)
        if "@" + person.user_account.email.lower() in tokens])


def _sync_message_mentions(message, field, resolve):
    return sync_resource_mentions(message, field, message.body, resolve)[0]


def mention_data(row):
    return {"employee_id": str(row.employee_id), "token": row.token, "name": row.name}


def sync_resource_mentions(source, field, text, resolve, *, maximum=MAX_MENTIONS):
    """Return active/new people and cache only the verified current projection."""
    tokens = mention_tokens(text)
    source._mentions = []
    source._mention_bindings_changed = False
    if not tokens:
        return set(), set()
    label, error_field = ("página", "blocks") if field == "page" else ("mensaje", "body")
    another = 'otra página' if field == 'page' else 'otro mensaje'
    if len(tokens) > maximum:
        raise ValidationError({error_field: f"Puedes usar hasta {maximum} referencias de personas por {label}."})
    document = SearchDocument.objects.get(**{field: source})
    previous = list(ResourceMention.objects.filter(document=document))
    known_people = {row.employee_id for row in previous}
    unknown = tokens - {row.token for row in previous}
    if unknown:
        people = resolve(unknown)
        by_token = {}
        for person in people:
            by_token.setdefault("@" + person.user_account.email.lower(), []).append(person)
        # Ambiguous case-folded identities never select an arbitrary employee.
        additions = [ResourceMention(document=document, employee=items[0], token=token, name=items[0].full_name[:200])
            for token, items in by_token.items() if len(items) == 1]
        if len(known_people | {row.employee_id for row in additions}) > maximum:
            raise ValidationError({error_field: f"Este contenido ya referencia a {maximum} personas distintas. Crea {another} para mencionar a más."})
        if len(previous) + len(additions) > maximum * 2:
            raise ValidationError({error_field: f"Este contenido alcanzó el límite de referencias históricas. Crea {another}."})
        ResourceMention.objects.bulk_create(additions)
        source._mention_bindings_changed = bool(additions)
        previous.extend(additions)
    current = [row for row in previous if row.token in tokens]
    source._mentions = [mention_data(row) for row in current]
    active_people = {row.employee_id for row in current}
    return active_people, active_people - known_people


def prime_message_mentions(messages, field):
    messages = list(messages)
    tokens = {row.pk: mention_tokens(row.body) for row in messages}
    by_id = {row.pk: [] for row in messages}
    source_field = "document__" + field + "_id"
    for row in ResourceMention.objects.filter(**{source_field + "__in": [pk for pk, items in tokens.items() if items]}).values(
            source_field, "employee_id", "token", "name"):
        source = row[source_field]
        if row["token"] in tokens[source]:
            by_id[source].append({"employee_id": str(row["employee_id"]), "token": row["token"], "name": row["name"]})
    for message in messages:
        message._mentions = by_id[message.pk]


def prime_channel_mentions(messages):
    prime_message_mentions(messages, "channel_message")


def prime_direct_mentions(messages):
    prime_message_mentions(messages, "direct")


def message_mentions(message, field):
    if not hasattr(message, "_mentions"):
        prime_message_mentions([message], field)
    return message._mentions


def channel_mentions(message):
    return message_mentions(message, "channel_message")


def active_channel_mention(channel_id, message_id, employee_id):
    rows = ResourceMention.objects.filter(document__channel_message_id=message_id,
        document__channel_message__channel_id=channel_id, employee_id=employee_id).values_list("token", "document__channel_message__body")
    return any(token in mention_tokens(body) for token, body in rows)
