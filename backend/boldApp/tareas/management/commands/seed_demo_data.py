from django.conf import settings
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
    {"name": "Ana Martinez", "email": "ana@bold.gt", "unit": "Marketing", "role": "Colaborador"},
    {"name": "David Urbina", "email": "david@bold.gt", "unit": "Operaciones", "role": "Colaborador"},
    {"name": "Carla Ruiz", "email": "carla@bold.gt", "unit": "Marketing", "role": "Colaborador"},
    {"name": "Samuel", "email": "samuel@bold.gt", "unit": "Marketing", "role": "Colaborador"},
    {"name": "Josue", "email": "josue@bold.gt", "unit": "Operaciones", "role": "Colaborador"},
    {
        "name": "Luis",
        "email": "luis@bold.gt",
        "password": "LuisBold2026!",
        "unit": "Dirección",
        "role": "Propietario",
        "is_staff": True,
        "is_superuser": True,
        "privileged_demo": True,
    },
    {
        "name": "Paulus",
        "email": "paulus@bold.gt",
        "password": "PaulusBold2026!",
        "unit": "Dirección",
        "role": "Alta Gerencia",
        "is_staff": True,
        "privileged_demo": True,
    },
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
    help = "Siembra el núcleo, cuentas de demostración y el módulo de tareas V2."

    def handle(self, *args, **options):
        people = [person for person in DEMO_PEOPLE if not person.get("privileged_demo") or settings.DEBUG or settings.SEED_PRIVILEGED_DEMO_ACCOUNTS]
        units = self.seed_units(people)
        roles = self.seed_roles_and_permissions(people)
        assignments = self.seed_people(units, roles, people)
        projects = self.seed_projects(units, assignments)
        self.seed_project_members(projects, assignments)
        self.seed_statuses(units)

        self.stdout.write(self.style.SUCCESS(
            f"V2 lista: {len(units)} unidades, {len(assignments)} cuentas, "
            f"{len(assignments)} asignaciones, {len(projects)} proyectos. "
            "Cuentas demo: ana@bold.gt y samuel@bold.gt"
        ))
        if "luis@bold.gt" in assignments:
            self.stdout.write(self.style.WARNING(
                "Dueño demo: luis@bold.gt / LuisBold2026! | "
                "Alta gerencia: paulus@bold.gt / PaulusBold2026!"
            ))

    def seed_units(self, people):
        root, _ = OrganizationalUnit.objects.get_or_create(
            name="Bold",
            defaults={"unit_type": "company", "sensitivity_level": "medium"},
        )
        units = {}
        for name in sorted({person["unit"] for person in people}):
            units[name], _ = OrganizationalUnit.objects.get_or_create(
                name=name,
                defaults={
                    "unit_type": "team",
                    "parent_unit": root,
                    "sensitivity_level": "medium",
                },
            )
        return units

    def seed_roles_and_permissions(self, people):
        role_levels = {"Colaborador": "member", "Alta Gerencia": "executive", "Propietario": "owner"}
        roles = {}
        for title in sorted({person["role"] for person in people}):
            role, _ = JobRole.objects.get_or_create(title=title, defaults={"level": role_levels.get(title, "member")})
            roles[title] = role
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
        return roles

    def seed_people(self, units, roles, people):
        assignments = {}
        for display_order, person in enumerate(people):
            employee, _ = Employee.objects.get_or_create(full_name=person["name"])
            account, created = UserAccount.objects.get_or_create(
                email=person["email"],
                defaults={
                    "employee": employee,
                    "is_staff": person.get("is_staff", False),
                    "is_superuser": person.get("is_superuser", False),
                },
            )
            if created:
                account.set_password(person.get("password", "bolddemo123"))
                account.save(update_fields=["password"])
            else:
                privilege_updates = []
                for field in ("is_staff", "is_superuser"):
                    if person.get(field) and not getattr(account, field):
                        setattr(account, field, True)
                        privilege_updates.append(field)
                if privilege_updates:
                    privilege_updates.append("updated_at")
                    account.save(update_fields=privilege_updates)

            position, _ = Position.objects.get_or_create(
                unit=units[person["unit"]],
                job_role=roles[person["role"]],
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
