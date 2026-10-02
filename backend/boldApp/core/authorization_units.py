"""Request-local hierarchy materialization; never a shared authorization cache."""
from .models import OrganizationalUnit


def load_authorization_units(assignment):
    units = {unit.id: unit for unit in OrganizationalUnit.objects.all()}
    for unit in units.values():
        # Keep the ordinary FK lookup if an ancestor disappeared concurrently.
        # The authorization engine still validates cycles and maximum depth.
        if unit.parent_unit_id is None or unit.parent_unit_id in units:
            unit._state.fields_cache["parent_unit"] = units.get(unit.parent_unit_id)
    own = units.get(assignment.position.unit_id)
    if own is not None:
        assignment.position._state.fields_cache["unit"] = own
    return units
