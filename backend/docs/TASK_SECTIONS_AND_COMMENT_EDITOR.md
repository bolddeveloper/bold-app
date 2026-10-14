# Secciones opcionales y comentarios

## Comportamiento

- `Sin sección` sigue siendo el grupo inicial de un proyecto o tablero personal.
- Al renombrarlo se conserva como una sección normal, con sus tareas, y el grupo virtual deja de aparecer.
- Se puede eliminar si existe otra sección. Las tareas se trasladan a una sección existente, conservando estado, fecha y responsabilidad.
- No se permite eliminar la última sección disponible.
- La creación de tareas recuerda la última sección usada correctamente, por cargo activo y proyecto (o tablero personal), en el navegador. Si ya no existe, se selecciona la primera sección visible. Un borrador válido conserva su selección explícita.
- Escribir o pegar URLs HTTP/HTTPS o `www.` crea enlaces. El botón Enlace permite un alias opcional.
- El editor compartido admite imágenes pegadas desde el portapapeles o arrastradas como archivos: PNG, JPEG, GIF y WebP. Usa el mismo flujo del botón, con previsualización y bloqueo durante la carga. No descarga imágenes remotas desde HTML del portapapeles.
- Se limita el ancho de las tarjetas del tablero y se ajustan textos largos para evitar desbordamientos.

## Persistencia y API

La migración `0016_optional_unsectioned` agrega `unsectioned_hidden` (booleano, inicialmente falso) a `Project` y `PersonalTaskBoard`.

El valor predeterminado se conserva también en PostgreSQL, para que la versión anterior pueda seguir creando registros entre la migración y el reemplazo de los contenedores, o durante una reversión del código.

- `POST /api/v2/sections/materialize-unsectioned/` renombra el grupo inicial y desactiva su regeneración.
- `POST /api/v2/sections/hide-unsectioned/`, con `{ "project": "UUID" }`, elimina el grupo virtual y mueve sus tareas a la primera sección real, en una transacción. Requiere `tasks.project.manage`.
- Las respuestas de proyectos y tableros personales incluyen `unsectioned_hidden`.
- La bandera de proyecto es de solo lectura en el serializador general. Las operaciones de secciones mantienen las comprobaciones de autorización existentes.
- Los vínculos nuevos o modificados sin sección toman la primera sección existente si el grupo virtual está desactivado, incluso si proceden de un cliente antiguo.
- No se borra ni modifica automáticamente contenido existente durante la migración.

## Publicación

1. Respaldar la base de datos antes de actualizar el backend.
2. Aplicar `python manage.py migrate` con el backend actualizado, antes de publicar el frontend.
3. Publicar el frontend y aceptar su actualización en la PWA cuando no haya trabajo sin guardar.
4. Verificar renombrado, eliminación y recarga en un proyecto de pruebas; comprobar también Mis tareas.

No es necesario reinstalar la PWA ni ejecutar la seed.

## Pruebas

Backend: `python manage.py test boldApp.tareas --noinput` en una base de pruebas separada.

Frontend, desde `frontend/modulos/core`: `npm test` y `npm run test:comment-editor-ui`.

Prueba manual: renombrar Sin sección, recargar y comprobar que no reaparece; crear en otra sección y volver a abrir Nueva tarea; eliminar una sección y comprobar que sus tareas siguen visibles; escribir y pegar una URL; insertar un enlace con alias; pegar una captura o arrastrar una imagen; revisar el tablero con un enlace largo en modos claro y oscuro.
