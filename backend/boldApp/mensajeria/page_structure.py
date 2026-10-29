"""Channel-local hierarchy; structure never participates in the shared document.

All writers hold the channel row lock, including child creation. A bounded
recursive query keeps descendant IDs in the database rather than loading an
entire knowledge tree in Python. Supported by PostgreSQL and SQLite test DBs.
"""
from django.db import connection
from django.db.models import Exists, OuterRef
from django.db.models.expressions import RawSQL
from rest_framework.exceptions import ValidationError
from .page_models import ChannelPage

MAX_DEPTH = 20


def subtree(page):
    table = connection.ops.quote_name(ChannelPage._meta.db_table)
    value = ChannelPage._meta.pk.get_db_prep_value(page.pk, connection)
    sql = f"""WITH RECURSIVE branch(id, depth) AS (
        SELECT id, 0 FROM {table} WHERE id = %s
        UNION ALL SELECT child.id, branch.depth + 1 FROM {table} child
        JOIN branch ON child.parent_id = branch.id WHERE branch.depth < %s
    )"""
    return sql, [value, MAX_DEPTH]


def exclude_branch(rows, page):
    sql, params = subtree(page)
    return rows.exclude(pk__in=RawSQL(sql + " SELECT id FROM branch", params))


def ancestors(page):
    result, seen, parent_id = [], {page.pk}, page.parent_id
    while parent_id:
        if parent_id in seen or len(result) >= MAX_DEPTH:
            raise ValidationError("La jerarquía de páginas no es válida.")
        seen.add(parent_id)
        parent = ChannelPage.objects.only("id", "title", "icon", "archived_at", "parent_id").filter(
            pk=parent_id, channel_id=page.channel_id).first()
        if parent is None:
            raise ValidationError("La jerarquía de páginas no es válida.")
        result.append(parent)
        parent_id = parent.parent_id
    return list(reversed(result))


def placement(channel, parent_id, page=None):
    parent = None
    if parent_id:
        parent = ChannelPage.objects.filter(pk=parent_id, channel=channel, archived_at__isnull=True).first()
        if parent is None:
            raise ValidationError({"parent_id":"Elige una página activa de este mismo canal."})
        branch = ancestors(parent)
        if page and (parent.pk == page.pk or any(row.pk == page.pk for row in branch)):
            raise ValidationError({"parent_id":"Una página no puede colocarse dentro de sí misma ni de sus subpáginas."})
        depth = len(branch) + 2
    else:
        depth = 1
    height = 0
    if page:
        sql, params = subtree(page)
        with connection.cursor() as cursor:
            cursor.execute(sql + " SELECT COALESCE(MAX(depth), 0) FROM branch", params)
            height = cursor.fetchone()[0]
    if depth + height > MAX_DEPTH:
        raise ValidationError({"parent_id":f"La jerarquía admite como máximo {MAX_DEPTH} niveles."})
    return parent


def with_children(rows, include_archived=False):
    children = ChannelPage.objects.filter(parent_id=OuterRef("pk"))
    if not include_archived:
        children = children.filter(archived_at__isnull=True)
    return rows.annotate(has_children=Exists(children))


def structure_data(page):
    return {"parent_id":str(page.parent_id) if page.parent_id else None,
            "structure_version":page.structure_version,
            "ancestors":[{"id":str(row.pk), "title":row.title, "icon":row.icon,
                          "archived":bool(row.archived_at)} for row in ancestors(page)]}
