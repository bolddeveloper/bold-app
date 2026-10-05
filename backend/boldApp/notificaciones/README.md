# Módulo de notificaciones

Este módulo concentra las notificaciones internas de la aplicación. La entrega inicial cubre eventos de tareas, comentarios y proyectos sin acoplar el buzón al módulo de tareas.

## Eventos iniciales

- Asignación y cambios relevantes de tareas.
- Incorporación y reactivación de colaboradores de tareas (`task.collaborator_added`).
- Comentarios y menciones mediante correos `@nombre@bold.gt`.
- Creación y cambios relevantes de proyectos.
- Incorporación de una persona a un proyecto.
- Cambio de responsable de un proyecto (`project.assigned`).

Las notificaciones se generan al confirmar la transacción de origen, se deduplican por destinatario y evento, y solo se entregan si el destinatario conserva permiso de lectura sobre el recurso.

Guardar una participación sin cambios no vuelve a notificar. Reactivarla sí genera
un nuevo aviso. Una persona que actúa sobre su propia asignación no recibe un aviso
de su propia acción; un colaborador con nivel de notificaciones `none` tampoco.
El nuevo responsable recibe el aviso de asignación aunque también se cambien
fechas, prioridad o estado en esa misma operación.

## Participación en proyectos

Pertenecer al departamento no concede participación automática: además de los
permisos habituales, se exige ser creador, responsable o miembro activo del
proyecto. El propietario de la empresa conserva su acceso universal. La condición
se valida en el servidor, no solamente ocultando tarjetas en la interfaz.

El formulario comienza sin colaboradores preseleccionados y conserva la selección
ante refrescos en vivo. Crear, editar y compartir usan `member_ids` en el POST/PATCH
del proyecto: proyecto y participantes se guardan juntos en una transacción.
Omitir `member_ids` al editar conserva los participantes; enviar `[]` retira a los
miembros, sin quitar el acceso del creador, responsable o propietario. Los retiros
conservan el historial con `status=inactive` y `removed_at`.

No se depuran automáticamente los proyectos antiguos afectados por una selección
incorrecta: no existe información suficiente para distinguir miembros legítimos
de los agregados por el fallo. Deben revisarse desde la edición de participantes.

### Comprobación manual después del despliegue

1. Crear un proyecto con un responsable y un colaborador elegido; dejar a otro
   compañero del mismo departamento fuera de la selección.
2. Confirmar con las tres cuentas que solamente los participantes ven el proyecto
   y que el responsable y el colaborador reciben sus avisos navegables.
3. Agregar un segundo colaborador, guardar y comprobar su aviso; guardar nuevamente
   sin modificar participantes no debe generar otro aviso.
4. Retirar a ese colaborador: ya no debe poder abrir el proyecto ni consultar sus
   notificaciones relacionadas. Reactivarlo debe generar un nuevo aviso.
5. Crear una tarea para otra persona, agregar un colaborador distinto y luego cambiar
   el responsable junto con la fecha: comprobar el aviso correspondiente en cada cuenta.
6. Repetir con un participante sin permiso de lectura: la participación por sí sola
   no debe abrir el recurso ni entregar sus avisos.

## API

La API se publica bajo `/api/v2/notifications/` y exige una sesión válida junto con `X-Assignment-ID` perteneciente a la cuenta autenticada.

- `GET /api/v2/notifications/`
- `GET /api/v2/notifications/unread-count/`
- `POST /api/v2/notifications/{id}/mark-read/`
- `POST /api/v2/notifications/{id}/mark-unread/`
- `POST /api/v2/notifications/mark-all-read/`

El listado vuelve a validar los permisos actuales. Una notificación histórica no permite recuperar ni abrir un recurso cuyo acceso haya sido revocado.

## Tiempo real

El canal `/ws/notifications/` usa un ticket de un solo uso emitido para el canal `notifications`. Cada conexión queda aislada por asignación y se cierra si la sesión o la asignación dejan de ser válidas.

Antes de enviar un aviso encolado se verifica que existe, corresponde a esa
asignación y todavía es legible. Retirar participación impide entregar avisos
pendientes del proyecto, incluso con la conexión previamente abierta.

### Control de seguridad (sin acceso administrativo)

El mismo canal entrega sobres v2 `control.ready`, `permissions.revision` y
`assignment.changed`. Contienen solo la asignación propia, revisión decimal como
cadena, huellas opacas de estado/contexto, secuencia del canal, capacidad
`permissions_revision`, vigencia de control de 45 segundos y tiempo restante
para el próximo límite de seguridad. No contienen políticas, auditoría ni datos
de otros empleados. No se suscribe al grupo de eventos administrativos de Core.

Se comprueba el estado cada 30 segundos o antes al vencer sesión, inactividad,
concesión, autoridad ancestral o MFA reciente. El cierre 4401 invalida la sesión;
4403 indica plaza/ticket inválido. Las tareas asíncronas se cancelan al desconectar.
Los avisos posteriores al commit consultan el estado vigente; señales repetidas
sin cambio efectivo no fuerzan nuevas cargas del frontend. Las huellas permiten
recuperar cambios temporales y cambios de modelos sin revisión global incluso
si se perdió una señal. La autorización HTTP por operación no se modifica.

El cliente verifica la capacidad antes de pasar al respaldo HTTP de 60 segundos
en pestañas visibles. Si el servidor es antiguo, la conexión falla o la vigencia
vence, mantiene/vuelve a verificaciones cada cinco segundos. Ante incertidumbre
oculta datos del alcance anterior y pausa capacidades hasta verificarlas.

## Extensión a otros módulos

Los próximos módulos pueden llamar `create_notification` con su propio `module`, `resource_type`, `route` y metadatos. Antes de hacerlo deben definir la regla que determina los destinatarios y validar el permiso de lectura del recurso tanto al crear como al listar la notificación.
