# Módulo de sugerencias

Canal interno para registrar ideas, problemas y mejoras sin depender de correo.

## Permisos

- `suggestions.feedback.create`: enviar sugerencias desde la unidad activa.
- `suggestions.feedback.read`: consultar sugerencias dentro del alcance autorizado.
- `suggestions.feedback.manage`: cambiar estado y nota interna dentro del alcance autorizado.

Los autores siempre pueden consultar sus propios envíos. La gestión no permite borrar
registros y cada creación o revisión genera un `SuggestionEvent` inmutable.

## API

- `GET /api/v2/suggestions/`
- `POST /api/v2/suggestions/`
- `GET /api/v2/suggestions/{id}/`
- `PATCH /api/v2/suggestions/{id}/`

Crear sugerencias está limitado a ocho solicitudes por hora y por identidad de throttle.
