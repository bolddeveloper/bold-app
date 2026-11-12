# Novedades y notas de parche de BOLD

- Al entregar una actualización importante o un conjunto considerable de correcciones, añadir o preparar su nota en `frontend/modulos/perfil/release_notes.js` como parte de esa misma entrega. No crear una publicación por cada ajuste mínimo.
- Mantener el modelo actual de tarjetas y lector: `id`, `date`, `category`, `icon`, `title`, `summary` y `sections` con `title` e `items`. Incorporar las entradas al principio, ordenadas por fecha descendente.
- Escribir en español para usuarios de la aplicación: explicar qué cambió, dónde encontrarlo y las restricciones relevantes, no copiar mensajes técnicos de commits.
- Verificar los cambios contra el código y las pruebas. No anunciar funcionalidades futuras, permisos que no se conceden, integraciones pendientes ni resultados de producción no comprobados.
- Los identificadores publicados son estables y únicos porque se utilizan para marcar novedades leídas. Conservar las entradas históricas; explicar los cambios posteriores en una nota nueva.
- Usar la fecha real de la entrega al reconstruir el historial. Una nota preparada localmente no implica que su contenido o la propia nota ya se haya desplegado; distinguirlo al comunicar el resultado.
- No incluir credenciales, claves, datos personales de prueba, rutas privadas de infraestructura ni detalles internos sensibles en notas visibles para usuarios.
- Conservar estética, componentes y estilos existentes salvo que el usuario solicite un cambio visual. La futura visibilidad por equipos requiere una implementación separada: no asumir que está disponible.
- Añadir notas no autoriza por sí mismo a crear commits, hacer push o desplegar: respetar la autorización vigente de la entrega.
- Ejecutar las pruebas de notas de versión y la compilación frontend antes de publicar cambios en este apartado.

# Revisiones de interfaz

- Utilizar la skill `ui-ux-pro-max` en módulos futuros y revisiones visuales o de interacción, preservando la identidad y los componentes de BOLD. Aplicar recomendaciones verificadas y pertinentes, no rediseños automáticos.
- La creación del mapa de Graphify queda pospuesta hasta una solicitud expresa del usuario. No generar mapas ni activar hooks durante otras tareas.

# Almacenamiento de imágenes y archivos

- Las imágenes, iconos y adjuntos se almacenan en Drive. El backend conserva referencias, metadatos y permisos; nunca archivos ni Base64 como almacenamiento temporal o permanente, ni en base de datos ni en disco.
- Durante una petición se permite procesar el archivo en memoria, con límites de tamaño. Los borradores y los archivos para reintentar permanecen en el dispositivo; no introducir colas del servidor que conserven sus bytes.
- Si Drive no confirma la subida, conservar el archivo en el dispositivo y permitir un reintento explícito con el mismo identificador. No usar almacenamiento local del backend como alternativa.
- Antes de migrar contenido antiguo, hacer respaldo. Sustituir sus bytes por una referencia solo después de comprobar que Drive conserva el archivo; no borrar datos de Oracle.

# Pilotos vigentes

- El asistente operativo y el módulo Informes permanecen limitados al departamento de IT hasta aprobación expresa para ampliarlos. Mantener las listas de unidades configuradas en `BOLD_ASSISTANT_PILOT_UNIT_IDS` y `REPORTS_PILOT_UNIT_IDS`, con ambos pilotos habilitados en el entorno desplegado.
- Comprobar el límite en las APIs y los sockets, además de la navegación y las notas de parche. Ser propietario o administrador fuera de IT no concede acceso al piloto.
- Chat, Slack y las etapas existentes de tareas conservan su disponibilidad habitual; no restringirlos al activar estos dos pilotos.
