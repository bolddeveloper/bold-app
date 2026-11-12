from django.db import migrations


def initialize(apps,schema_editor):
    permission=apps.get_model('boldApp_core','Permission')
    for resource,action,description,risk in [
        ('request','use','Preparar solicitudes privadas del asistente.','low'),
        ('request','execute','Aprobar acciones del asistente con mis permisos.','medium'),
        ('usage','read','Consultar métricas del asistente del equipo autorizado.','high'),
    ]:
        permission.objects.using(schema_editor.connection.alias).get_or_create(code=f'assistant.{resource}.{action}',defaults={
            'module_code':'assistant','resource':resource,'action':action,'description':description,
            'risk_level':risk,'is_active':True,'is_delegable':True,'is_bulk_assignable':resource!='usage'})
    apps.get_model('bold_assistant','InferenceGate').objects.using(schema_editor.connection.alias).get_or_create(pk=1)


class Migration(migrations.Migration):
    dependencies=[('bold_assistant','0001_initial')]
    operations=[migrations.RunPython(initialize,migrations.RunPython.noop)]
