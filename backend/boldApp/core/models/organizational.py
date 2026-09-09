from django.db import models

from .mixins import UUIDPrimaryKeyModel


# Define la tabla ORGANIZATIONAL_UNITS: el arbol de unidades de la
# organizacion (areas, departamentos, equipos...). parent_unit_id arma la
# jerarquia; sensitivity_level alimenta la regla de autorizacion (ver
# boldApp/core/authorization.py) para decidir que tan sensible es cada rama.
class OrganizationalUnit(UUIDPrimaryKeyModel):
    name = models.CharField(max_length=120)
    unit_type = models.CharField(max_length=30)
    parent_unit = models.ForeignKey(
        "self",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="child_units",
    )
    sensitivity_level = models.CharField(max_length=20)
    color_hex = models.CharField(max_length=7, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "organizational_units"
        ordering = ["name"]
        constraints = [
            models.CheckConstraint(
                check=~models.Q(id=models.F("parent_unit")),
                name="organizational_unit_cannot_be_its_own_parent",
            ),
        ]

    def __str__(self):
        return self.name


# Define la tabla JOB_ROLES: el cargo (catalogo), independiente de la unidad
# en la que se ejerce. Una plaza (Position) combina un cargo con una unidad.
class JobRole(UUIDPrimaryKeyModel):
    title = models.CharField(max_length=120)
    level = models.CharField(max_length=30, null=True, blank=True)
    description = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "job_roles"
        ordering = ["title"]

    def __str__(self):
        return self.title


# Define la tabla POSITIONS: la plaza (unidad + cargo) desde la que actua un
# empleado. reports_to_position_id arma el organigrama de reporte, separado
# del arbol de unidades.
class Position(UUIDPrimaryKeyModel):
    unit = models.ForeignKey(OrganizationalUnit, on_delete=models.PROTECT, related_name="positions")
    job_role = models.ForeignKey(JobRole, on_delete=models.PROTECT, related_name="positions")
    reports_to_position = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="direct_reports",
    )
    display_order = models.IntegerField(default=0)
    is_open = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "positions"
        ordering = ["unit", "display_order"]
        constraints = [
            models.CheckConstraint(
                check=~models.Q(id=models.F("reports_to_position")),
                name="position_cannot_report_to_itself",
            ),
        ]

    def __str__(self):
        return f"{self.job_role_id} @ {self.unit_id}"


# Define la tabla EMPLOYEES: el registro de persona, sin credenciales de
# acceso (no es el modelo de autenticacion). El futuro rework del modulo de
# tareas es justamente el que decidira como enlazar esto con AUTH_USER_MODEL.
class Employee(UUIDPrimaryKeyModel):
    full_name = models.CharField(max_length=140)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "employees"
        ordering = ["full_name"]

    def __str__(self):
        return self.full_name


# Define la tabla POSITION_ASSIGNMENTS: el hecho de que un empleado ocupa una
# plaza durante un periodo. Es la pieza central de la regla de autorizacion:
# toda decision de permisos se resuelve sobre UNA asignacion activa concreta,
# nunca mezclando las distintas plazas que pueda tener el mismo empleado.
class PositionAssignment(UUIDPrimaryKeyModel):
    position = models.ForeignKey(Position, on_delete=models.PROTECT, related_name="assignments")
    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name="position_assignments")
    assigned_at = models.DateTimeField(auto_now_add=True)
    released_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "position_assignments"
        ordering = ["-assigned_at"]
        indexes = [
            models.Index(fields=["employee", "is_active"], name="idx_posasg_employee_active"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["position"],
                condition=models.Q(is_active=True, released_at__isnull=True),
                name="unique_active_assignment_per_position",
            ),
            models.CheckConstraint(
                condition=models.Q(is_active=False) | models.Q(released_at__isnull=True),
                name="active_assignment_has_no_release_date",
            ),
        ]

    def __str__(self):
        return f"{self.employee_id} -> {self.position_id}"
