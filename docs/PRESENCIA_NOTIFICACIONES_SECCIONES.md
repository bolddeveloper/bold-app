# Secciones, comentarios, notificaciones y disponibilidad

## Cambios de uso

- Renombrar **Sin sección** en un proyecto crea una sección real y mueve allí sus tareas. Queda una nueva **Sin sección** para tareas futuras. No cambia responsables, estados ni otras pertenencias a proyectos.
- Las secciones nuevas se agregan al final. Los puntos del encabezado permiten arrastrarlas en lista, tablero y lista móvil. **Alt + flechas** también las ordena. **Escape** cancela un arrastre. El orden de las secciones reales se guarda en una operación atómica, sin una petición por sección.
- El historial de comentarios tiene desplazamiento propio y la caja para escribir queda fuera de ese desplazamiento, sin superponerse.
- La campana incluye **Configurar notificaciones**. En Perfil → Notificaciones se pueden seleccionar asignaciones, colaboraciones, proyectos nuevos, ediciones, estados, fechas, comentarios y menciones por separado. Desactivar un evento impide crear y enviar avisos nuevos de ese tipo; no elimina los anteriores ni afecta permisos.
- El menú rápido ofrece En línea, Ausente, Ocupado y Más configuraciones del perfil. Perfil → **Mi disponibilidad** permite además Vacaciones y Personalizado (título de 60 caracteres y descripción de 160). En reunión y Desconectado son automáticos, no seleccionables.
- Inicio → Galería de widgets → **Equipo conectado** muestra personas y estados, con búsqueda y filtro por departamento. Se incluye en el tablero inicial; los tableros personalizados existentes se conservan y pueden añadirlo desde la galería.

## Presencia y privacidad

Tener una sesión válida no significa estar conectado. La presencia usa los controles del WebSocket autenticado existente, normalmente cada 30 segundos, sin un nuevo socket ni consultas HTTP periódicas. Se deduplican varias sesiones de un empleado; se excluyen cuentas inactivas, asignaciones liberadas y sesiones vencidas, revocadas o con credenciales antiguas.

Tras cerrar la última ventana o perder la conexión puede tardar hasta unos **2 minutos** en desaparecer de otras pantallas: 90 segundos de margen del registro más la siguiente actualización. Desconectado depende de la conexión real; las personas desconectadas no se incluyen en este widget. Un fallo del canal muestra disponibilidad desconocida, no una lista falsamente vigente.

Solo se comparte nombre, departamentos, estado y el texto de estado personalizado. No se comparten correos, tokens, títulos del calendario, invitados, enlaces ni horarios de las reuniones.

## Estado automático del calendario

Requiere una conexión **personal** de Google Calendar autorizada y la opción automática activada. Una reunión es un evento con horas de inicio/fin y con participantes o videollamada; no se consideran citas sin esos elementos, eventos de día completo, cancelados, rechazados por la persona, eventos marcados como libres, borradores o tareas reflejadas en calendario.

El inicio se incluye y el fin se excluye: una reunión de 14:00 a 15:00 cambia el estado durante ese intervalo respetando la zona horaria. Vacaciones tiene prioridad. Cambiar de cuenta Google o desconectarla no reutiliza el calendario anterior.

Una tarea de fondo consulta como máximo cada 2 minutos los calendarios de personas conectadas; guarda únicamente intervalos de tiempo durante 5 minutos. Los cambios externos de Google pueden tardar aproximadamente **2 minutos y la siguiente actualización** en reflejarse. Abrir una vista del calendario que incluya el presente también actualiza estos intervalos.

## Requisitos antes de publicar

1. Aplicar las migraciones `boldApp_core.0016_user_presence_settings` y `boldApp_tareas.0009_project_unsectioned_index` con el procedimiento habitual. Esta última conserva también la posición de Sin sección al recargar y entre usuarios del proyecto.
2. Reiniciar backend y trabajador Celery. Oracle ya tiene trabajador con programador (`worker -B`); debe utilizar el código nuevo y Redis compartido. La nueva tarea se llama `boldApp.calendario.tasks.refresh_calendar_presence`.
3. Publicar el frontend correspondiente; no basta con actualizar solo uno de los servicios.

En desarrollo sin Redis la presencia usa memoria del proceso. Para múltiples procesos se requiere Redis. Para actualizar el estado de Google **sin abrir el calendario** se necesita el trabajador y programador Celery; el modo local síncrono no ejecuta tareas periódicas por sí solo.

## Prueba recomendada

1. En un proyecto con tareas sin sección, cambiar el nombre, recargar y verificar que conserva sus tareas y queda Sin sección vacía.
2. Crear Zeta y luego Alfa: deben conservar ese orden. Arrastrar los puntos, recargar y verificar el orden nuevo. Probar Escape, Alt + flechas y modo móvil.
3. Abrir una tarea con muchos comentarios: desplazar el historial hasta el último y comprobar que la caja de texto no lo tapa.
4. En una segunda cuenta desactivar Ediciones de tareas y conservar Tareas asignadas. Desde la primera asignarle una tarea y editar otra: debe recibir el aviso de asignación, no el de edición.
5. Añadir Equipo conectado en ambas cuentas. Cambiar disponibilidad, buscar a la persona, filtrar departamento y cerrar todas las conexiones de una cuenta para comprobar que desaparece automáticamente.
6. Conectar el calendario personal y crear una reunión próxima con invitado o Meet. Comprobar inicio/fin y Vacaciones. Confirmar que el compañero solo ve En reunión, sin datos de Google.
7. Cerrar todas las ventanas de la segunda cuenta y esperar el margen indicado. Revocar una sesión y comprobar que no mantiene presencia si no hay otra conexión válida.

Los cambios están preparados para verificación local. La validación con Google real y la revisión visual manual en navegadores deben realizarse antes del despliegue de la demo.
## Retoques de disponibilidad y comentarios

- El menú rápido del perfil muestra estados sin abrir Configuración. Ausente y Ocupado tienen submenús por hover, clic o flecha derecha; Escape vuelve un nivel. En móvil se selecciona por pulsación.
- Duraciones: 15 y 30 minutos; 1 y 2 horas; o hasta cambiarlo manualmente. La API calcula `expires_at`; el cliente no puede enviarlo. Al vencer se resuelve En línea, o En reunión si Calendar lo detecta. El siguiente control WebSocket refleja el cambio, sin polling HTTP ni temporizadores adicionales de servidor. Estados manuales antiguos de Desconectado/En reunión se interpretan como En línea; duraciones antiguas dejan de ofrecerse, aunque su vencimiento existente se respeta.
- Los comentarios se pueden plegar/desplegar y, abiertos, utilizan hasta 70% de la altura de pantalla (máximo 640px). El panel completo sigue desplazándose y el compositor queda en flujo normal, sin taparlos.
- El widget de empleados tiene avatar con indicador, columnas que no desbordan y distribución adaptada al ancho del propio widget, no solo de la ventana.

Prueba manual recomendada: recorrer un historial largo hasta el compositor, plegarlo con mouse y teclado; abrir disponibilidad en ambas entradas del perfil, guardar Ausente 15 minutos y comprobar el vencimiento; probar menú en pantalla estrecha y redimensionar el widget con nombres/departamentos largos. Estos cambios no requieren migración de base de datos.
