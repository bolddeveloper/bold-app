"""Reporting authority uses real organizational relationships, never job titles."""
from collections import defaultdict
from boldApp.core.models import Position


def structural_team_units(assignment):
    if assignment.position.unit.is_control_plane:
        from boldApp.core.models import OrganizationalUnit
        return set(OrganizationalUnit.objects.values_list('pk',flat=True))
    rows=list(Position.objects.values('id','reports_to_position_id','unit_id')[:10001])
    if len(rows)>10000:
        return set()  # An administrator can grant an explicit bounded scope.
    children=defaultdict(list)
    for row in rows:children[row['reports_to_position_id']].append(row)
    pending=[assignment.position_id];seen={assignment.position_id};units=set()
    for _ in range(100):
        following=[]
        for key in pending:
            for row in children.get(key,[]):
                if row['id'] in seen:return set()
                seen.add(row['id']);units.add(row['unit_id']);following.append(row['id'])
        if not following:return units
        pending=following
    return set()
