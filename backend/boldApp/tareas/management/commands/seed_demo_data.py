from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

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
        "privileged_demo": True,
    },
    {
        "name": "Desarrollador local",
        "email": "developer@bold.gt",
        "password": "DeveloperBold2026!",
        "unit": "Tecnología",
        "role": "Desarrollador",
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
    ("tasks.task.read", "task", "read", "low", False),
    ("tasks.task.create", "task", "create", "medium", False),
    ("tasks.task.update", "task", "update", "medium", False),
    ("tasks.task.delete", "task", "delete", "high", False),
    ("tasks.task.assign", "task", "assign", "high", False),
    ("tasks.comment.create", "comment", "create", "low", False),
    ("tasks.project.read", "project", "read", "low", False),
    ("tasks.project.manage", "project", "manage", "high", False),
    ("tasks.catalog.read", "catalog", "read", "low", False),
    ("tasks.webhook.manage", "webhook", "manage", "critical", True),
]

ROLE_POLICIES = {
    "Colaborador": {
        "scope": JobRolePermission.SCOPE_OWN_UNIT,
        "permissions": {
            "tasks.task.read",
            "tasks.task.create",
            "tasks.task.update",
            "tasks.comment.create",
            "tasks.project.read",
            "tasks.catalog.read",
        },
    },
    "Alta Gerencia": {
        "scope": JobRolePermission.SCOPE_GLOBAL,
        "permissions": {"tasks.task.read", "tasks.project.read", "tasks.catalog.read"},
    },
    "Propietario": {"scope": JobRolePermission.SCOPE_OWN_UNIT, "permissions": set()},
    "Desarrollador": {
        "scope": JobRolePermission.SCOPE_GLOBAL,
        "permissions": {row[0] for row in TASK_PERMISSIONS},
    },
}


class Command(BaseCommand):
    help = "Siembra datos exclusivamente para desarrollo y demostración aislada."

    def handle(self, *args, **options):
        if not settings.SEED_DEMO_ACCOUNTS:
            raise CommandError(
                "La seed demo está deshabilitada. Usa SEED_DEMO_ACCOUNTS=true únicamente en un entorno aislado."
            )
        privileged_enabled = settings.DEBUG or settings.SEED_PRIVILEGED_DEMO_ACCOUNTS
        people = [
            person for person in DEMO_PEOPLE
            if not person.get("privileged_demo") or privileged_enabled
        ]
        if not privileged_enabled:
            privileged_demo_emails = [
                person["email"] for person in DEMO_PEOPLE if person.get("privileged_demo")
            ]
            for account in UserAccount.objects.filter(email__in=privileged_demo_emails):
                # Si estas cuentas conocidas se sembraron antes, no basta con
                # omitirlas: neutraliza credenciales y cualquier privilegio.
                account.set_unusable_password()
                account.is_active = False
                account.is_staff = False
                account.is_superuser = False
                account.credentials_version += 1
                account.save(
                    update_fields=[
                        "password",
                        "is_active",
                        "is_staff",
                        "is_superuser",
                        "credentials_version",
                        "updated_at",
                    ]
                )

        units = self.seed_units(people)
        roles = self.seed_roles_and_permissions(people)
        assignments = self.seed_people(units, roles, people)
        projects = self.seed_projects(units, assignments)
        self.seed_project_members(projects, assignments)
        self.seed_statuses(units)

        self.stdout.write(self.style.SUCCESS(
            f"Demo lista: {len(units)} unidades, {len(assignments)} cuentas, "
            f"{len(assignments)} asignaciones, {len(projects)} proyectos."
        ))
        if "luis@bold.gt" in assignments:
            self.stdout.write(self.style.WARNING(
                "Dueño demo: luis@bold.gt / LuisBold2026! | "
                "Alta gerencia: paulus@bold.gt / PaulusBold2026! | "
                "Desarrollador: developer@bold.gt / DeveloperBold2026!"
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
                    "sensitivity_level": "critical" if name == "Dirección" else "medium",
                },
            )
        return units

    def seed_roles_and_permissions(self, people):
        role_levels = {
            "Colaborador": "member",
            "Alta Gerencia": "executive",
            "Propietario": "owner",
            "Desarrollador": "developer",
        }
        permissions = {}
        for code, resource, action, risk, step_up in TASK_PERMISSIONS:
            permission, _ = Permission.objects.update_or_create(
                code=code,
                defaults={
                    "module_code": "tasks",
                    "resource": resource,
                    "action": action,
                    "risk_level": risk,
                    "is_delegable": True,
                    "requires_step_up_mfa": step_up,
                    "is_active": True,
                    "system_managed": True,
                },
            )
            permissions[code] = permission

        roles = {}
        for title in sorted({person["role"] for person in people}):
            role, _ = JobRole.objects.get_or_create(
                title=title,
                defaults={"level": role_levels.get(title, "member")},
            )
            roles[title] = role
            JobRolePermission.objects.filter(job_role=role, permission__module_code="tasks").delete()
            profile = ROLE_POLICIES[title]
            for code in sorted(profile["permissions"]):
                JobRolePermission.objects.create(
                    job_role=role,
                    permission=permissions[code],
                    scope_type=profile["scope"],
                    effect=JobRolePermission.EFFECT_ALLOW,
                    reason="Perfil seguro de demostración.",
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
                    "is_staff": bool(person.get("is_staff", False)),
                    "is_superuser": bool(person.get("is_superuser", False)),
                },
            )
            if created:
                account.set_password(person.get("password", "bolddemo123"))
                account.save(update_fields=["password"])
            else:
                privilege_updates = []
                for field in ("is_staff", "is_superuser"):
                    desired = bool(person.get(field, False))
                    if getattr(account, field) != desired:
                        setattr(account, field, desired)
                        privilege_updates.append(field)
                if not account.is_active:
                    account.is_active = True
                    privilege_updates.append("is_active")
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
                if assignment.position.unit_id != project.unit_id:
                    continue
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
