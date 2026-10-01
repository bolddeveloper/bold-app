# Módulo de sugerencias

Canal interno para registrar ideas, problemas y mejoras sin depender de correo.

## Permisos

- `suggestions.feedback.create`: enviar sugerencias desde la unidad activa.
- `suggestions.feedback.read`: consultar sugerencias dentro del alcance autorizado.
- `suggestions.feedback.manage`: cambiar estado y nota interna dentro del alcance autorizado.

Los autores siempre pueden consultar y editar el contenido de sus propios envíos. También
pueden retirarlos mediante eliminación lógica; el registro y su auditoría se conservan en
la base de datos. La gestión administrativa solo permite cambiar el estado y la nota
interna, y no autoriza editar o eliminar sugerencias ajenas. Cada creación, edición,
revisión o eliminación genera un `SuggestionEvent` inmutable.

## API

- `GET /api/v2/suggestions/`
- `POST /api/v2/suggestions/`
- `GET /api/v2/suggestions/{id}/`
- `PATCH /api/v2/suggestions/{id}/`
- `DELETE /api/v2/suggestions/{id}/` (solo el autor; eliminación lógica)

Crear sugerencias está limitado a ocho solicitudes por hora y por identidad de throttle.
