# Revisión del plan de BOLD 3

Fecha: 30 de octubre de 2026. Estado local; no implica publicación ni despliegue.

## Referencias y ejecución

| Parte del plan | Estado comprobable | Revisión que falta |
| --- | --- | --- |
| Sidebar bencho | Barra de 216 px expandida y 72 px plegada, con marca BOLD, control inferior, iconos anclados, etiquetas que se desvanecen y submenús compactos. Preferencia local, foco visible y movimiento reducido. Revisada en escritorio y menú móvil de 375 px y 844 × 390 px, con cierre mediante Escape. | Recorrido autenticado de todos los accesos según equipo. |
| Login Wafer adaptado | Tarjeta compacta recta y círculo sin recuadro. Fondo SVG nativo con aros y puntos animados por CSS, claro/oscuro y geometría móvil. Aro inferior anclado, sin descarga de vídeo ni imágenes del fondo. Pausa al ocultar pestaña y respeta movimiento reducido. Hyperframes permanece como referencia de movimiento. | Comprobar teléfono físico. |
| Widgets Board UI | Tipografía, superficies y encabezados compactos. Widgets en una columna móvil. Se mantiene el tablero configurable. | Contrastar todas las variantes de widget, tamaños y menús en ambos temas. |
| Conexión Google | Línea de espera y confirmación ligadas al estado real. No se amplían permisos. | Recorrer autorización, cancelación, fallo y reconexión con una cuenta de prueba. |
| Estética general Midday | Paleta compartida, bordes rectos y estilos comunes. | El rediseño completo por módulo sigue parcial: calendario, Sheets, administración, permisos, informes y formularios necesitan revisión visual específica. No basta con cambiar los estilos comunes. |
| Primer uso | Tema y conexión opcional para cuentas nuevas; migración exime las existentes. Corregido error de referencia al sincronizar tema. Pruebas de interfaz y servidor. | Comprobar el recorrido con una cuenta nueva en navegador y el retorno de Google. |
| Entrada Hyperframes | Composición de entrada de 1,2 s renderizada en vídeo para ambos temas e integrada. | Recorrido real después de iniciar sesión; movimiento reducido y respaldo presentes. |
| Progreso por días | Retirado de Mis tareas por petición del usuario. No se aplica el filtro por día guardado mientras el bloque está retirado. | Su reactivación queda pendiente de una solicitud del usuario. |
| Tablero por secciones | Tarjetas compactas con fecha, prioridad, responsable, proyecto, progreso real y subtareas independientes. Secciones con recuento y creación rápida mediante +; se conservan acciones y permisos. | Revisión de columnas numerosas, textos largos, arrastre y detalles en móvil y escritorio. |
| Lista por secciones | Filas compactas por sección con descripción, etiquetas, comentarios y adjuntos existentes, campos configurables y creación rápida en la sección elegida. Controles adaptados a iconos en teléfono. Menús de tres puntos para tareas y secciones. Revisión con datos locales y pruebas de componentes, metadatos y teclado. | Revisión de todas las combinaciones de columnas visibles y personas con nombres largos. |
| Cronograma | Cuadrícula por responsable con avatares, barras de duración real, carriles sin solapamientos, fines de semana y día actual. Navegación semanal y quincenal con columnas limitadas al período visible. Mes muestra una cuadrícula con alineación real de días, espacios vacíos fuera del mes, barras que atraviesan días y acceso al excedente de tareas. Filtro local de pendientes/completadas. Fechas inválidas y tareas sin fecha se separan sin modificar sus datos. Barras redondeadas con colores estables por tarea. Se retiró el bloque de comentarios del cronograma, conservando los detalles y comentarios de cada tarea. | Revisión con calendarios de larga duración y teléfono físico. |
| Selectores de fechas | Calendario compartido con rango de inicio/fin en proyectos, eventos internos y Google y edición de tareas; selección simple donde corresponde. Accesos rápidos, limpieza de campos opcionales y navegación con teclado. Conserva horas existentes y permite inicio o fin opcionales en tareas y proyectos. La duración indica días entre fechas; los eventos de todo el día siguen incluyendo su último día. | Revisión en teléfonos físicos y dispositivos de asistencia. |
| Chat | Compositor compacto, indicador temporal de escritura, visor y audio conservados. | Conversación entre dos sesiones y revisión completa de voz, imágenes y teclado del teléfono. |

## Validación y límites

- La compilación y los tests no sustituyen los recorridos autenticados de calendario, Sheets, Google ni los de cada perfil.
- No se ha hecho deploy ni se ha modificado Oracle en esta entrega.
- No se cambian restricciones de IT ni reglas de acceso por aplicar el nuevo estilo.
- Las comprobaciones anteriores de 360–1440 px corresponden al login y a vistas parciales de Inicio/Tareas, no a toda la aplicación ni a teléfonos físicos.
- Orden restante: terminar revisión visual de cada módulo; recorrer los flujos autenticados; corregir hallazgos; repetir las comprobaciones afectadas; preparar revisión antes de publicar.
