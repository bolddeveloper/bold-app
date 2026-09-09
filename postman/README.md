# Prueba local V2: REST, WebSocket y webhooks

## 1. Arrancar los dos procesos

Desde la raíz del repositorio abre dos terminales PowerShell.

API REST + WebSocket:

```powershell
.\.venv\Scripts\python.exe .\backend\manage.py migrate
.\.venv\Scripts\python.exe .\backend\manage.py seed_demo_data
.\.venv\Scripts\python.exe .\backend\manage.py runserver 127.0.0.1:8000
```

Receptor local de webhooks:

```powershell
.\.venv\Scripts\python.exe .\backend\scripts\webhook_receiver.py
```

## 2. Ejecutar la colección

Importa `Bold App - V2 local.postman_collection.json` y ejecuta la carpeta `01 - Preparación` en orden. La colección inicia sesión como `ana@bold.gt`, descubre las unidades/asignaciones sembradas y configura dos endpoints firmados: Marketing y Operaciones.

Antes de ejecutar `02 - Flujo entre unidades`, abre dos solicitudes WebSocket en Postman:

```text
ws://127.0.0.1:8000/ws/unit/{{unit_marketing_id}}/?token={{token}}&assignment={{assignment_ana_id}}
ws://127.0.0.1:8000/ws/unit/{{unit_operations_id}}/?token={{token}}&assignment={{assignment_ana_id}}
```

Si Postman no sustituye variables en su cliente WebSocket, copia sus valores desde la pestaña de variables de la colección. La siembra demo concede lectura global a Ana, por eso su asignación puede observar ambas unidades.

Ejecuta luego `02 - Flujo entre unidades`: crea una tarea cuya unidad responsable es Marketing pero la enlaza al proyecto de Operaciones, la traspasa a Operaciones/David, comenta y la elimina lógicamente.

Finalmente ejecuta `03 - Verificación`. Deben verse:

- WebSocket Marketing: `task.created`, `task.status_changed`, `task.updated`.
- WebSocket Operaciones: `task.status_changed`, `task.updated`, `comment.created`, `task.deleted`.
- Receptor: 9 entregas en total contando los dos `webhook.test`; todas con `signature_valid: true`.
- Django: 4 entregas para el endpoint Marketing y 5 para Operaciones, todas exitosas.

La carpeta `99 - Limpieza opcional` elimina ambos endpoints y sus entregas por cascada.

En desarrollo, sin `REDIS_URL`, Django usa un canal en memoria y Celery entrega de forma inmediata. Esto valida la lógica en un proceso. La prueba real con varios clientes/instancias debe hacerse en Render, con Redis compartido por el servidor ASGI y el worker Celery.

El contrato completo para el frontend está en `backend/docs/tasks_v2_api.md`.
