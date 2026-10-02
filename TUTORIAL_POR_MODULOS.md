# Tutorial contextual de Bold

## Alcance

Guías independientes para Inicio, Tareas, Proyectos (también proyectos del
departamento), Workspaces, Bandeja, Calendario, Sugerencias e Informes.
Recorridos adicionales al abrir por primera vez una tarea nueva, su edición,
su detalle o el formulario de proyecto. Administración y Permisos quedan
excluidos: sus botones de ayuda están deshabilitados a la espera de un video.

La guía aparece en la primera visita de cada **cargo activo y navegador**.
Completar u omitir un recorrido no omite los demás. La versión 2 no reutiliza
el estado del antiguo tutorial global. Limpiar los datos del navegador hará que
los recorridos aparezcan de nuevo; no hay una preferencia sincronizada al servidor.
El botón de ayuda repite la guía de la vista actual, sin cambiar de módulo.

## Seguridad y comportamiento

- El recorrido explica; no navega automáticamente, envía formularios ni concede
  acceso. No realiza peticiones HTTP o conexiones WebSocket adicionales.
- Solo se destacan elementos presentes y visibles. Los controles ocultos por
  permisos o por el tamaño de pantalla se omiten.
- Cambio de contexto, navegación o desmontaje cancelan la guía sin marcarla
  como completada. Escape/cierre/omitir registran la omisión de esa guía.
- Formularios conservan su contenido al cerrar la guía; Escape no cierra ambos.
- Resaltado con borde rojo, halo blanco y contorno oscuro; sombreado más claro
  en su intención, sin destellos ni animación continua. Movimiento reducido
  respeta la preferencia del sistema.
- El foco se recalcula ante cambios de tamaño, desplazamiento o paso, no en un
  bucle permanente. Observadores, eventos y temporizadores se liberan al salir.
- Calendario explica la conexión pendiente cuando corresponda. Informes se
  presenta como preliminar y los archivos reales siguen pendientes.

## Verificación

`npm test` desde `frontend/modulos/core` incluye ahora los tests del tutorial:
aislamiento por cargo/módulo, versión antigua, almacenamiento bloqueado,
exclusión administrativa y selección de formularios. Suite: 168 pruebas aprobadas.
`npm run test:worker` verifica el proxy y las rutas.

Revisión de navegador local: Inicio y Tareas independientes; guía de creación
sin enviar registros; Escape preserva el formulario; Bandeja completa y repetible
desde ayuda; persistencia después de recargar; modo claro de escritorio y oscuro
de móvil a 390 × 844. El encabezado móvil mantiene ayuda y campana en una fila.
Esto no equivale a una prueba de carga con usuarios concurrentes ni a una
comprobación física de todos los teléfonos/PWA.

Para probar: entra a una vista todavía no visitada, recorre Siguiente/Anterior,
finaliza y vuelve a ella. No debe aparecer de nuevo; usa ayuda para repetirla.
Abre Agregar tarea, omite su guía y comprueba que el formulario sigue abierto.
Comprueba Administración y Permisos con una cuenta autorizada: sin tutorial.

## GitHub

Summary: `feat: tutorial contextual por módulos sobre Develop optimizado`

Descripción:

- Integra la optimización de tráfico en Develop y devuelve Oracle a esa rama.
- Publica el frontend desde Develop conservando los indicadores de optimización.
- Sustituye el tutorial global por guías de módulos y formularios independientes.
- Excluye Administración y Permisos y mantiene las reglas de acceso existentes.
- Refuerza el foco y mejora el comportamiento de móvil, teclado y cierre.
- Añade cobertura automatizada y documentación de despliegue/verificación.
