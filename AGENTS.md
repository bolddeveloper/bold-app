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
