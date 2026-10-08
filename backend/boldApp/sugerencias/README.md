# Módulo de sugerencias

Canal interno para registrar ideas, problemas y mejoras sin depender de correo.

## Permisos

- `suggestions.feedback.create`: enviar sugerencias desde la unidad activa.
- `suggestions.feedback.read`: consultar sugerencias dentro del alcance autorizado.
- `suggestions.feedback.manage`: cambiar estado, prioridad y nota interna dentro del alcance autorizado.

Los autores siempre pueden consultar y editar el contenido de sus propios envíos. También
pueden retirarlos mediante eliminación lógica; el registro y su auditoría se conservan en
la base de datos. La gestión administrativa permite cambiar el estado, prioridad y nota
interna, y no autoriza editar o eliminar sugerencias ajenas. Cada creación, edición,
revisión o eliminación genera un `SuggestionEvent` inmutable.

## API

- `GET /api/v2/suggestions/`
- `POST /api/v2/suggestions/`
- `GET /api/v2/suggestions/{id}/`
- `PATCH /api/v2/suggestions/{id}/`
- `DELETE /api/v2/suggestions/{id}/` (solo el autor; eliminación lógica)
- `GET /api/v2/suggestions/{id}/screenshots/?image={capture_id}` (acceso autenticado al reporte)

Los reportes incluyen título (180 caracteres), descripción (10–2000 caracteres), tipo,
módulo, prioridad (`low`, `medium`, `high`) y navegador/dispositivo opcional (160 caracteres).
Los reportes anteriores siguen funcionando; la interfaz usa la primera línea como título.

La lista tiene páginas de 25 registros. Filtros combinables: `search` (título, descripción,
persona, unidad o referencia), `status`, `category`, `priority`, `source_module`, `unit`,
`author_assignment`, `from` y `to` (fechas inclusivas). `order`: `newest`, `oldest` o
`priority`. El alcance de permisos se aplica antes de todos los filtros.

Cada reporte admite hasta tres capturas WebP de 300 KB. El navegador convierte PNG/JPG/WebP,
mantiene la proporción y reduce el lado mayor a 1600 píxeles. Listas y auditoría contienen
solo metadatos; las imágenes se sirven por el endpoint privado sin caché. Editar permite
conservar capturas por su ID o retirarlas. Las notas internas solo se devuelven a gestores.

Aplicar la migración `boldApp_sugerencias.0003` antes de publicar el frontend actualizado.

Crear sugerencias está limitado a ocho solicitudes por hora y por identidad de throttle.
