# Informes y etapas de ejecución

Implementación local en `feature/informes-etapas`, basada en Develop `53e1a598`. Este documento no acredita un despliegue. Las migraciones se han comprobado únicamente en bases aisladas.

## Qué probar

1. Abra **Informes → Crear informe**. Elija métrica, agrupación, gráfico, zona horaria y fechas. Los filtros permiten seleccionar tareas, proyectos, estados, etiquetas, departamentos, responsables y etapas; las reuniones usan calendarios accesibles.
2. Pulse **Aplicar y calcular**. Compruebe la fórmula, el número de casos conocidos, los datos insuficientes y los registros de origen. Una barra o un grupo permite consultar sus fuentes. La descarga CSV vuelve a verificar el acceso.
3. Guarde el informe, ábralo desde otro dispositivo y comparta su definición con otra persona. La otra persona debe recibir únicamente resultados autorizados por sus propios permisos. Compartir no publica los datos originales.
4. En el detalle completo de una tarea, abra **Etapas → Añadir etapas**. Defina un responsable principal, otros responsables, departamento, criterio, fecha y dependencias. Dos pasos sin dependencia entre sí pueden avanzar en paralelo; un paso con varios prerrequisitos espera a todos.
5. Con una segunda cuenta responsable de un paso, compruebe la lectura de la tarea y las acciones de su etapa. Esa responsabilidad por sí sola no concede edición general ni eliminación de la tarea.
6. Comience, bloquee con un motivo, reanude y complete pasos. Intente finalizar la tarea antes de resolver sus pasos obligatorios; el servidor debe rechazarlo también desde los estados y pipelines existentes.
7. Reabra un paso anterior. Los sucesores pendientes vuelven a esperar; el trabajo posterior ya completado se conserva, pero requiere revisión. Compruebe el historial y las fechas antes y después de una modificación.
8. Guarde y comparta una plantilla desde la preparación de etapas. Reutilizarla crea identificadores nuevos y no modifica los procesos existentes. Solo su propietario puede actualizar o archivar la plantilla original.
9. Abra la misma tarea o informe en dos sesiones. Una versión antigua no debe sustituir la edición más reciente. Un reintento del mismo comando de etapa debe producir una sola operación.

## Interpretación de los resultados

- **Fecha de creación u objetivo:** selecciona el conjunto de trabajo. No recorta artificialmente un ciclo que terminó después de ese período.
- **Finalización real:** utiliza entregas registradas y su responsabilidad en ese momento. Reasignar la tarea o cambiar su fecha objetivo después no reescribe la entrega anterior.
- **Actividad en el período:** recorta los intervalos de etapa al rango seleccionado.
- El tiempo En curso, disponible, dependiente o bloqueado es tiempo transcurrido en ese estado; no acredita dedicación, asistencia ni esfuerzo individual. No se genera una clasificación automática de productividad.
- Una etapa compartida puede figurar en los grupos de varias personas; el total conserva etapas únicas. El trabajo vinculado a varios proyectos tampoco se duplica en el total. Los porcentajes de avance por departamento deduplican las tareas compartidas entre proyectos del mismo grupo.
- Los tiempos desconocidos y las entregas sin una fecha objetivo conocida no se convierten en cero. Se muestran promedio, mediana y tamaño de muestra cuando corresponde. No se reconstruye un historial anterior que la aplicación no registró.
- Los intervalos de reuniones que cruzan días, semanas o meses se distribuyen según la zona horaria elegida. Las reuniones simultáneas pueden superponerse: la duración programada no acredita asistencia.
- Las fechas guardadas son absolutas. Para otro período, edite sus límites y vuelva a aplicar el informe.

## Permisos y límites

La consulta de métricas individuales requiere supervisión mediante el organigrama o una autorización explícita de `reports.team.read`. Esa autorización no concede acceso a las tareas o proyectos subyacentes. Dirección conserva las reglas organizativas existentes; no se infieren derechos por el texto del cargo.

Los permisos nuevos son `tasks.execution.manage`, `tasks.execution.advance`, `tasks.execution.override`, `reports.analytics.run`, `reports.report.manage` y `reports.team.read`. Las denegaciones explícitas y los requisitos MFA conservan prioridad. Las excepciones de etapa exigen autorización específica y un motivo. Una vez iniciado un proceso, no se pueden retirar sus pasos obligatorios pendientes para eludir la finalización.

Los pasos todavía sin trabajo pueden prepararse o retirarse antes de comenzar. La responsabilidad general de la tarea permanece en su coordinador; no cambia automáticamente al avanzar entre departamentos. El detalle de etapas no se publica mediante las vistas parciales de Mi equipo.

Las reuniones proceden de **calendarios BOLD accesibles**. Esta entrega no importa calendarios personales de Google ni concede al supervisor acceso a la agenda privada de otro empleado. Los vínculos de reunión con tareas o proyectos se crean explícitamente.

Cada informe admite hasta 366 días y 10 000 registros de origen, con límites adicionales de eventos e intervalos. Los filtros admiten 50 selecciones; las búsquedas de tareas indican si hay más resultados; los directorios tienen límites de 1 000 personas y 500 proyectos. Se conservan hasta 100 informes y 100 plantillas propios, y hasta 60 etapas por tarea. Al superar un límite se solicita reducir el conjunto; no se publican totales parciales como si estuvieran completos.

## Sincronización y recuperación

Informes reutiliza el socket autenticado de Core. Solo se suscribe mientras hay una vista interesada. Los avisos no contienen nombres, estados, cantidades ni identificadores de tareas o calendarios: invalidan la consulta y la lectura HTTP vuelve a autorizar sus fuentes.

Etapas reutiliza los eventos de tareas del departamento, filtrados por la tarea abierta; no se suscribe a cambios de trabajo de toda la organización. Reconcilia al reconectar o volver a su pestaña.

Las ráfagas se agrupan con una espera de 500 ms y un máximo de 2 segundos. No existe un sondeo periódico nuevo de Informes. Una pestaña oculta reconcilia al volver; los filtros sin aplicar no cambian por recibir un evento.

Las preparaciones se conservan temporalmente en memoria al cambiar de vista, con aislamiento por cuenta/asignación, caducidad de una hora y un máximo de veinte entradas. No son borradores persistentes entre dispositivos o recargas. La recarga avisa y la actualización automática de la PWA se protege mientras hay cambios pendientes; los cambios de seguridad purgan estas preparaciones.

No se comparte una caché de resultados entre usuarios. La autorización se reutiliza solo dentro de cada petición. Cambiar de contexto cancela las consultas antiguas. La paginación comprueba la identidad del conjunto: si cambia mientras se consulta, se reinicia el detalle en vez de mezclar páginas incompatibles.

## Migraciones y validación técnica

Las migraciones de `boldApp_tareas` son:

- `0018`: ejecución, etapas, comandos idempotentes, plantillas, eventos y cobertura histórica inicial.
- `0019`: informes guardados, vínculos de reunión y catálogo de permisos de informes.
- `0020`: índices para fechas de creación/finalización y consultas de eventos por período.

No migrar una base habitual o de producción sin confirmar antes su destino y realizar su respaldo. No borrar historial para revertir una entrega; preferir una corrección hacia adelante.

Desde el repositorio y con el entorno Python existente:

```text
python backend/manage.py test boldApp.tareas boldApp.core boldApp.notificaciones boldApp.permisos boldApp.calendario boldApp.mensajeria.test_automations boldApp.mcp.test_mcp --settings=config.settings_test --noinput
python backend/manage.py makemigrations --check --dry-run --settings=config.settings_test --noinput
```

`config.settings_test` utiliza SQLite en memoria, correo local y canales aislados. Las pruebas de bloqueo real se omiten allí y se ejecutan aparte con PostgreSQL local mediante `config.settings_reports_acceptance`. Este último exige una configuración privada fuera del repositorio, host `127.0.0.1`, puerto `55483`, usuario y base exclusivos de validación; rechaza otros destinos. No necesita Docker ni Oracle.

Desde `frontend/modulos/core`:

```text
npm test
npm run test:reports
npm run build
```

La prueba de navegador usa Playwright del runtime privado de validación ya existente en este equipo. Prueba componentes reales con APIs sintéticas y bloquea conexiones externas; no sustituye las pruebas de permisos del backend. Si se reproduce en otro equipo, preparar ese runtime de pruebas primero. Evitar ejecutarla a la vez que `prebuild` reinstala las dependencias de una rama.

Las verificaciones locales no son un benchmark de producción, una prueba distribuida entre servidores ni una garantía de consumo dentro de planes gratuitos. Ninguna de estas pruebas envía correos, accede a Drive o crea recursos de pago.

Resultado de la entrega local: la regresión de backend ejecutó 349 pruebas, con seis omisiones; frontend ejecutó 448, con 447 aprobadas y una omitida. Se comprobaron aparte los bloqueos reales en PostgreSQL: 40 pruebas de aceptación y, después de los ajustes de integración, 42 de ejecución/pipelines/concurrencia y dos de protección de etapas y supervisión. La última prueba funcional de navegador aprobó el refresco acotado, la conservación de preparaciones, el relevo de etapas y los conflictos de edición. La compilación final del código actual terminó correctamente y la comprobación de migraciones no detectó cambios pendientes de generar. Permanece el aviso preexistente sobre paquetes grandes de JavaScript.

La evidencia por requisito y las rutas de los registros están en `docs/informes_implementation.json`. La revisión visual independiente aprobó Etapas; en Informes aprobó la resolución de los dos ajustes señalados. Las capturas cubren escritorio/móvil y claro/oscuro, sin constituir una auditoría exhaustiva de accesibilidad. La instancia PostgreSQL aislada ya no está activa. No se migró la base habitual ni se hizo commit, push o despliegue.

## Notas de parche

Las dos tarjetas del 11 de noviembre están en `reportsReleaseNotes`, al principio de `releaseNotes`, para la publicación autorizada en Oracle y Cloudflare. Conservan sus identificadores y las notas históricas. El estado operativo del despliegue se registra por separado tras verificarlo.
