# Marcas y workspaces — 12 octubre 2026

## Alcance

Marcas es un módulo hermano de Tareas, con ficha persistente, logo WebP, descripción, contacto y cargo del cliente, correo/teléfono de trabajo, preferencias de comunicación, pauta/presupuesto con moneda, audiovisual, diseñador, trafficker, notas de relevo y hasta 20 características adicionales. Los datos se muestran como texto, no como HTML ejecutable. Se pueden asociar proyectos y tareas existentes, consultar los autorizados y abrirlos en Tareas.

Las marcas y sus listas de colaboradores viven en base de datos. El creador o propietario puede compartirlas con asignaciones activas de cualquier departamento y archivarlas, sin eliminar los proyectos/tareas originales. Los colaboradores pueden editar si su cargo lo permite. Compartir **contexto** no agrega automáticamente participantes a los proyectos ni permite leer/escribir tareas sin sus permisos originales.

## Permisos

La migración registra `brands.brand.read`, `brands.brand.create`, `brands.brand.manage` y `brands.brand.share`. El propietario utiliza la regla universal existente. Los demás cargos empiezan sin permisos nuevos: habilitarlos explícitamente desde Políticas. `share` queda fuera de preselecciones masivas. Se exige una asignación activa, capacidad de marcas en la unidad activa y pertenencia explícita a la marca; tener una política amplia no muestra automáticamente todas las marcas. El propietario sí puede consultar todas.

Esta primera versión evalúa las capacidades de marcas en la unidad **activa del colaborador**, no en la unidad original de la marca. La invitación explícita es el límite del contexto interdepartamental. Esto no cambia el alcance por unidad de los permisos de proyectos/tareas. Las altas, ediciones, archivo y cambios de colaboradores quedan auditados, sin registrar secretos.

## Tablas

| Tabla | Información |
| --- | --- |
| `boldApp_marcas_brand` | Propietario, unidad de origen, nombre, descripción, logo, contexto, asociaciones, versión, fechas y archivo |
| `boldApp_marcas_brand_members` | Asignaciones invitadas explícitamente |
| `boldApp_tareas_workspacelibrary` | Biblioteca privada por cuenta/unidad, árbol de carpetas, versión y fecha de edición |
| `boldApp_tareas_sharedworkspacefolder` (actualizada) | Mantiene carpetas/miembros existentes y añade versión para evitar sobrescrituras |

Las asociaciones de marcas son referencias UUID validadas al agregarlas, no permisos. Las referencias que dejan de estar disponibles no se borran silenciosamente. Nuevas asociaciones deben pasar las comprobaciones REST originales. Archivar una marca conserva su registro en base de datos.

## Workspaces

Se guarda toda la biblioteca personal en servidor, no únicamente carpetas ya compartidas. La migración conserva los snapshots compartidos existentes; las carpetas solo locales no se borran. El botón **Importar carpetas de este dispositivo** pide confirmar que pertenecen a la cuenta actual; no atribuye automáticamente cachés antiguos sin identidad. Conserva el respaldo local y agrega únicamente identificadores ausentes.

Compartir permite elegir empleados activos de otros departamentos. Un colaborador puede editar el nombre, descripción y asociaciones desde el encabezado de la carpeta compartida. Solo el creador administra participantes o elimina una carpeta propia. Las tareas/proyectos y archivos de Drive mantienen sus permisos. Las carpetas privadas de otra cuenta nunca son devueltas por la biblioteca.

Guardar espera la respuesta del servidor antes de anunciar éxito. Una versión desactualizada recibe HTTP 409; no sobreescribe a otro editor. El formulario permanece abierto para revisar/reintentar. El refresco se suspende mientras hay un formulario abierto para que no cambie la versión de base de edición. Reconciliación al retomar foco/conexión y cada tres minutos solo visible y en línea: **no es coedición de texto carácter por carácter**. Los cambios de tareas/proyectos conservan su mecanismo WebSocket existente.

## Otros retoques

- La semana actual del calendario muestra hoy y los días restantes. Meses y semanas históricas/futuras siguen navegables; columnas ajustadas a la cantidad visible.
- La animación de entrada saluda con el primer nombre autenticado; sin identidad mantiene el mensaje genérico.
- Campana con un breve movimiento y unos diez segundos de reposo; respeta movimiento reducido.

## Pruebas y activación

Aplicar migraciones `boldApp_tareas.0015_workspace_library` y `boldApp_marcas.0001_initial` después de respaldar la base correcta. Desplegar primero el backend y después el frontend: el frontend nuevo necesita las rutas nuevas. No ejecutar migraciones contra una base desconocida.

En este equipo se verificó que la base era `backend/db.sqlite3` del repositorio original; se creó un respaldo consistente fuera de Git y se aplicaron las migraciones locales pendientes. Las comprobaciones de Django y de migraciones terminaron sin errores. Para Oracle se exige un respaldo PostgreSQL y una imagen de recuperación antes de activar la versión.

Pruebas aisladas: suite Django con `--settings=config.settings_test` y PostgreSQL aislado con `config.settings_test_postgres`; pruebas frontend y PWA/Worker; `npm run test:brands-ui` para flujo de guardado; compilación Vite. Validación manual recomendada: propietario crea una marca, delega permisos de marcas a un cargo, invita a otra unidad, compara con una cuenta no invitada, edita desde dos dispositivos y confirma el conflicto. Crear/importar una biblioteca y comprobar que otro dispositivo de la misma cuenta la recupera y otra cuenta no.

## Resultado de verificación

Los diez casos iniciales se investigaron y corrigieron sin retirar controles. Se reparó además la acumulación de avisos de presencia y las consultas incompatibles con PostgreSQL detectadas durante la validación. La suite completa pasó en PostgreSQL aislado: **322 pruebas sin fallos**, incluida la escritura simultánea con bloqueo real. SQLite pasó con una omisión explícita para ese caso. Frontend: 259 pruebas aprobadas y una omitida; PWA: 7; Worker: 5; comprobación de componentes de Marcas y compilación Vite aprobadas. Véase [causas y reproducción de las correcciones](VALIDACION_Y_CORRECCIONES_20261012.md). Estos resultados no sustituyen una revisión visual ni un benchmark público de capacidad.

## Postmark (estado verificado)

Revisión del panel autenticado: cuenta rechazada, envíos/recepción pausados. No se cambiaron tokens, DNS ni configuración de correo de la aplicación. Se necesita reconsideración del proveedor o elegir otro canal; no es un bloqueo solucionable cambiando el SMTP local.
