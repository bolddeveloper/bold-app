DEFAULT_TASK_STATUSES = (
    {"category": "todo", "name": "Pend.", "position": 1, "is_final": False},
    {"category": "in_progress", "name": "Activa", "position": 2, "is_final": False},
    {"category": "completed", "name": "Lista", "position": 3, "is_final": True},
)


def ensure_default_task_statuses(unit):
    from .models import TaskStatus

    for status in DEFAULT_TASK_STATUSES:
        TaskStatus.objects.get_or_create(
            unit=unit,
            category=status["category"],
            defaults={
                "name": status["name"],
                "position": status["position"],
                "is_final": status["is_final"],
            },
        )
