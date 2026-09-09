from django.core.management.base import BaseCommand
from boldApp.core.models import (
    Employee,
    JobRole,
    JobRolePermission,
    OrganizationalUnit,
    Permission,
    Position,
    PositionAssignment,
    UserAccount,
)
from boldApp.tareas.models import Project, ProjectMember, Section, TaskStatus


DEMO_PEOPLE = [
    {"name": "Ana Martinez", "email": "ana@bold.gt", "unit": "Marketing"},
    {"name": "David Urbina", "email": "david@bold.gt", "unit": "Operaciones"},
    {"name": "Carla Ruiz", "email": "carla@bold.gt", "unit": "Marketing"},
]

DEMO_PROJECTS = [
    {"name": "Lanzamiento Q4", "color": "#ef3c3c", "unit": "Marketing"},
    {"name": "Contenido mensual", "color": "#f3a43b", "unit": "Marketing"},
    {"name": "Rediseno web", "color": "#66b885", "unit": "Operaciones"},
    {"name": "Campanas activas", "color": "#7d6bd6", "unit": "Marketing"},
]

DEMO_COLUMNS = [
    {"key": "todo", "label": "Pend.", "position": 1, "is_final": False},
    {"key": "in_progress", "label": "Activa", "position": 2, "is_final": False},
    {"key": "completed", "label": "Lista", "position": 3, "is_final": True},
]

TASK_PERMISSIONS = [
    ("tasks.task.read", "task", "read"),
    ("tasks.task.create", "task", "create"),
    ("tasks.task.update", "task", "update"),
    ("tasks.task.delete", "task", "delete"),
    ("tasks.task.assign", "task", "assign"),
    ("tasks.comment.create", "comment", "create"),
    ("tasks.project.manage", "project", "manage"),
    ("tasks.webhook.manage", "webhook", "manage"),
]


class Command(BaseCommand):
    help = "Siembra el nucleo y el modulo de tareas V2 con dos unidades colaborativas."

    def handle(self, *args, **options):
        units = self.seed_units()
        role = self.seed_role_and_permissions()
        assignments = self.seed_people(units, role)
        projects = self.seed_projects(units, assignments)
        self.seed_project_members(projects, assignments)
        self.seed_statuses(units)

        self.stdout.write(self.style.SUCCESS(
            "V2 lista: 2 unidades, 3 cuentas, 3 asignaciones, "
            f"{len(projects)} proyectos. Cuenta demo: ana@bold.gt"
        ))

    def seed_units(self):
        root, _ = OrganizationalUnit.objects.get_or_create(
            name="Bold",
            defaults={"unit_type": "company", "sensitivity_level": "medium"},
        )
        units = {}
        for name in ("Marketing", "Operaciones"):
            units[name], _ = OrganizationalUnit.objects.get_or_create(
                name=name,
                defaults={
                    "unit_type": "team",
                    "parent_unit": root,
                    "sensitivity_level": "medium",
                },
            )
        return units

    def seed_role_and_permissions(self):
        role, _ = JobRole.objects.get_or_create(title="Colaborador", defaults={"level": "member"})
        for code, resource, action in TASK_PERMISSIONS:
            permission, _ = Permission.objects.get_or_create(
                code=code,
                defaults={"resource": resource, "action": action},
            )
            JobRolePermission.objects.get_or_create(
                job_role=role,
                permission=permission,
                defaults={
                    "scope_type": JobRolePermission.SCOPE_GLOBAL,
                    "effect": JobRolePermission.EFFECT_ALLOW,
                },
            )
        return role

    def seed_people(self, units, role):
        assignments = {}
        for display_order, person in enumerate(DEMO_PEOPLE):
            employee, _ = Employee.objects.get_or_create(full_name=person["name"])
            account, created = UserAccount.objects.get_or_create(
                email=person["email"],
                defaults={"employee": employee},
            )
            if created:
                account.set_password("bolddemo123")
                account.save(update_fields=["password"])

            position, _ = Position.objects.get_or_create(
                unit=units[person["unit"]],
                job_role=role,
                display_order=display_order,
            )
            assignment = PositionAssignment.objects.filter(
                employee=employee,
                position=position,
                is_active=True,
                released_at__isnull=True,
            ).first()
            if assignment is None:
                assignment = PositionAssignment.objects.create(employee=employee, position=position)
            assignments[person["email"]] = assignment
        return assignments

    def seed_projects(self, units, assignments):
        projects = []
        owner_by_unit = {
            "Marketing": assignments["ana@bold.gt"],
            "Operaciones": assignments["david@bold.gt"],
        }
        for project_data in DEMO_PROJECTS:
            owner = owner_by_unit[project_data["unit"]]
            project, _ = Project.objects.get_or_create(
                unit=units[project_data["unit"]],
                name=project_data["name"],
                defaults={
                    "owner_assignment": owner,
                    "created_by_assignment": owner,
                    "color_hex": project_data["color"],
                    "status": "active",
                    "sensitivity_level": "medium",
                },
            )
            projects.append(project)
            for column in DEMO_COLUMNS:
                Section.objects.get_or_create(
                    project=project,
                    name=column["key"],
                    defaults={"position": column["position"]},
                )
        return projects

    def seed_project_members(self, projects, assignments):
        for project in projects:
            for assignment in assignments.values():
                ProjectMember.objects.get_or_create(
                    project=project,
                    assignment=assignment,
                    defaults={
                        "member_role": "collaborator",
                        "status": "active",
                        "added_by_assignment": project.owner_assignment,
                    },
                )

    def seed_statuses(self, units):
        for unit in units.values():
            for column in DEMO_COLUMNS:
                TaskStatus.objects.get_or_create(
                    unit=unit,
                    category=column["key"],
                    defaults={
                        "name": column["label"],
                        "position": column["position"],
                        "is_final": column["is_final"],
                    },
                )
