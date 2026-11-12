# BOLD

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

En el alcance de Informes y etapas de ejecución: empleados que consultan y coordinan su trabajo, y supervisores que consultan el equipo permitido por la autorización vigente. Este registro no pretende describir todas las audiencias de BOLD.

## Product Purpose

BOLD organiza trabajo mediante tareas y proyectos. La extensión local permite construir y guardar informes, consultar los registros que explican sus resultados y coordinar etapas con responsables y dependencias dentro de una tarea.

## Operating Context

La aplicación existente es una PWA web. Informes reutiliza la sesión, asignación activa, controles y autorización de BOLD. La implementación documentada está en el árbol local; este documento no acredita publicación, commit ni despliegue.

## Capabilities and Constraints

- Informes permite configurar métricas, filtros, fechas, agrupaciones y representación; conserva por separado la preparación y el resultado aplicado.
- Compartir una definición no concede acceso a tareas, calendarios ni métricas restringidas. Las fuentes continúan sujetas a permisos.
- Las etapas pertenecen al detalle de una tarea. Incluyen responsables, dependencias, acciones de avance, plantillas e historial. La interfaz presenta los cambios concurrentes para revisión.
- La ausencia de datos no equivale a cero. Los resultados muestran fórmula, casos conocidos, cobertura insuficiente y registros de origen cuando están disponibles.
- Las reuniones consultadas por esta extensión proceden de calendarios BOLD accesibles. No se declara integración nueva con calendarios Google.
- Los tiempos de estado son tiempo transcurrido; no acreditan esfuerzo ni asistencia. No se debe inferir una clasificación de productividad individual.

## Brand Commitments

Conservar la identidad BOLD 3 y sus controles existentes. Esta entrega es una extensión funcional; no autoriza sustituir la identidad ni redefinir el sistema visual global.

## Evidence on Hand

Fuentes verificables: `frontend/modulos/tareas/src/reports_workspace.jsx`, `report_charts.jsx`, `task_execution.jsx`, `execution_templates.jsx`, `execution_timeline.jsx` y `report_meeting_links.jsx`. El contrato local está en `.impeccable/surfaces/frontend-modulos-tareas-src-reports-workspace-jsx.md`; el funcionamiento y la validación técnica se describen en `docs/INFORMES_ETAPAS.md`.

No se han establecido aquí posicionamiento comercial, promesas de rendimiento ni una descripción exhaustiva de otros módulos. No deben deducirse de esta documentación acotada.
