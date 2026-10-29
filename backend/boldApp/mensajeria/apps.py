from django.apps import AppConfig


class MensajeriaConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "boldApp.mensajeria"
    label = "boldApp_mensajeria"
    verbose_name = "Bold - Mensajería"

    def ready(self):
        from .search_index import connect
        connect()
        from .reading_reminders import connect as connect_reading
        connect_reading()
        from .page_links import connect as connect_page_links
        connect_page_links()
        from .automations import connect as connect_automations
        connect_automations()
