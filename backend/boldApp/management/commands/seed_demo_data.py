from django.core.management.base import BaseCommand

from boldApp.models import Project, Section, TaskStatus, User, Workspace


# Nombre del workspace de demo, calcado del valor por defecto de
# VITE_DEMO_WORKSPACE_NAME en el frontend.
DEMO_WORKSPACE_NAME = "Bold Demo"


# Usuarios de demo, calcados de team_members en
# frontend/modulos/tareas/src/data/task_data.js.
DEMO_USERS = [
    {"name": "Ana Martinez", "email": "ana@bold.gt"},
    {"name": "David Urbina", "email": "david@bold.gt"},
    {"name": "Carla Ruiz", "email": "carla@bold.gt"},
]


# Proyectos de demo, calcados de project_items en task_data.js.
DEMO_PROJECTS = [
    {"name": "Lanzamiento Q4", "color": "#ef3c3c"},
    {"name": "Contenido mensual", "color": "#f3a43b"},
    {"name": "Rediseno web", "color": "#66b885"},
    {"name": "Campanas activas", "color": "#7d6bd6"},
]


# Vocabulario compartido entre Section.name y TaskStatus.category/name: los
# mismos literales que ya usa el frontend como "section" ("todo",
# "in_progress", "completed") y como "status" en espanol ("Pend.", "Activa",
# "Lista"), para que el adaptador de api_client.js no necesite una tabla de
# traduccion aparte.
DEMO_COLUMNS = [
    {"key": "todo", "label": "Pend.", "position": 1, "is_final": False},
    {"key": "in_progress", "label": "Activa", "position": 2, "is_final": False},
    {"key": "completed", "label": "Lista", "position": 3, "is_final": True},
]


class Command(BaseCommand):
    help = "Siembra un workspace, usuarios y proyectos de demo para probar la conexion del cliente React."

    def handle(self, *args, **options):
        demo_users = self.seed_users()
        workspace = self.seed_workspace(demo_users[0])
        projects = self.seed_projects(workspace, demo_users[0])

        for project in projects:
            self.seed_columns(project)

        self.stdout.write(self.style.SUCCESS(
            f"Listo: workspace '{workspace.name}' ({workspace.id}), "
            f"{len(demo_users)} usuarios, {len(projects)} proyectos."
        ))

    # Crea (o recupera) los usuarios de demo, de forma idempotente por email.
    def seed_users(self):
        created_users = []

        for user_data in DEMO_USERS:
            user, was_created = User.objects.get_or_create(
                email=user_data["email"],
                defaults={"name": user_data["name"]},
            )
            if was_created:
                user.set_password("bolddemo123")
                user.save()
            created_users.append(user)

        return created_users

    # Crea (o recupera) el workspace de demo, de forma idempotente por nombre.
    def seed_workspace(self, owner):
        workspace, _ = Workspace.objects.get_or_create(
            name=DEMO_WORKSPACE_NAME,
            defaults={"owner": owner},
        )
        return workspace

    # Crea (o recupera) los proyectos de demo dentro del workspace.
    def seed_projects(self, workspace, owner):
        created_projects = []

        for project_data in DEMO_PROJECTS:
            project, _ = Project.objects.get_or_create(
                workspace=workspace,
                name=project_data["name"],
                defaults={"owner": owner, "color": project_data["color"]},
            )
            created_projects.append(project)

        return created_projects

    # Crea (o recupera) las secciones del tablero y los estados de tarea de
    # un proyecto, usando el vocabulario compartido con el frontend.
    def seed_columns(self, project):
        for column in DEMO_COLUMNS:
            Section.objects.get_or_create(
                project=project,
                name=column["key"],
                defaults={"position": column["position"]},
            )
            TaskStatus.objects.get_or_create(
                project=project,
                category=column["key"],
                defaults={
                    "name": column["label"],
                    "position": column["position"],
                    "is_final": column["is_final"],
                },
            )
