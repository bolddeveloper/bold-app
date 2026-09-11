# Rework móvil de BoldApp

## Resultado

Se reorganizó la interfaz móvil sobre los componentes existentes. Se conserva el estado único de tareas, filtros, selección y sesión, y los contratos Backend V2. No se añadieron dependencias de producción ni se modificó el backend.

## Archivos modificados

| Archivo | Motivo |
| --- | --- |
| `src/core/app_shell.jsx` | Drawer accesible, controles de sesión dentro del drawer compacto, header móvil con campana, búsqueda disponible, notificaciones fuera del contenedor animado y destino para portales. Se retiró la barra de estado ficticia. |
| `src/core/core_provider.jsx` | Clase específica para adaptar el formulario de login; sin cambios en autenticación. |
| `src/main.jsx` | Importación explícita y ordenada de estilos globales, compartidos, Core y Tareas. |
| `src/styles.css` | Extracción de reglas del shell y consolidación de media queries móviles; wrap de herramientas/cabecera para evitar overflow en escritorio estrecho. |
| `src/task_app.jsx` | Cards, acciones táctiles, movimiento explícito de sección, filtros reales, detalle, Bandeja, fecha móvil nativa y estructura desplazable de formularios. Corrección del mapa de iconos faltante en Bandeja. |
| `tests/core_dom.mjs` | Esperar al formulario habilitado antes de enviar login, como un usuario real; evita una carrera con los efectos de StrictMode. |

## Archivos nuevos y componentes compartidos

| Archivo | Responsabilidad |
| --- | --- |
| `src/core/app_shell.css` | Estilos del shell extraídos, navegación compacta, notificaciones y login. |
| `src/tasks_mobile.css` | Reglas móviles de Tareas, formularios, Kanban, Bandeja y ajustes de Inicio/Informes. Media queries móviles agrupadas. |
| `src/shared/use_media_query.js` | Suscripción al breakpoint para interacciones y portales; el layout principal se resuelve con CSS. |
| `src/shared/use_dialog.js` | Escape, ciclo de foco, devolución del foco y bloqueo de scroll para paneles superpuestos, incluidos diálogos anidados. |
| `src/shared/responsive_overlay.jsx` | `ResponsiveOverlay`: portal móvil para escapar de transformaciones y contenedores con overflow; conserva el renderizado normal en escritorio. |
| `src/shared/responsive.css` | Backdrop compartido de los paneles. |
| `tests/responsive.mjs` | Prueba automatizada en Edge real sin interfaz, capturas, consola, anchos y recorridos responsive. |
| `REWORK_MOVIL_RESULTADO.md` | Este reporte. |

`TaskMobileActions`, dentro de Tareas, se reutiliza en cards y Kanban. Ofrece edición, eliminación y selector de sección; no introduce otra operación de guardado ni otro estado de tareas.

## Cambios por pantalla

- **Navegación:** sidebar permanente desde 1024px; drawer por debajo, sin espacio reservado. Cierre exterior y Escape, navegación con foco, selector de cargo y logout accesibles.
- **Cabecera:** navegación, sección y campana; búsqueda en otra fila con control de tema. Se mantienen las acciones de proyecto. La creación móvil usa el botón flotante existente.
- **Lista:** cards con títulos que pueden envolver, estado, fecha, prioridad, persona/proyecto y acciones visibles. Se retiró el texto erróneo que atribuía vencimiento de hoy a toda prioridad alta.
- **Kanban:** columnas horizontales de ancho legible con scroll local. Selector «Mover a sección» usa el mismo handler que desktop y conserva `TaskProject` en modo real. Drag & drop de escritorio permanece.
- **Detalle:** panel móvil de pantalla completa mediante portal, con cierre, scroll y acceso a edición, borrado, comentarios y subtareas. La flecha de regreso limpia la selección.
- **Formularios:** campos desplazables y footer separado con acciones visibles; una columna en móvil. Los selectores de colaboradores se despliegan dentro del flujo. La fecha usa el control nativo en móvil y conserva el calendario custom en escritorio.
- **Filtros:** panel inferior con los filtros reales, contador de selección, cierre exterior y Escape. Ordenar, personalizar y cambiar vista siguen disponibles. Se eliminó el cambio artificial de búsqueda a `zzz`.
- **Notificaciones:** campana móvil y panel amplio con scroll y marcado de lectura existente.
- **Bandeja:** listado a ancho disponible; detalle móvil separado y regreso explícito. Búsqueda y herramientas se reorganizan en filas. Los filtros se abren fuera de contenedores con overflow.
- **Inicio/Informes:** cards y métricas en una columna en pantallas estrechas; se conserva el modo oscuro.

## Breakpoints

- Hasta **600px**: ajustes de cards y métricas estrechas.
- Hasta **760px**: representación móvil del dominio, formularios, detalle y paneles.
- Hasta **1023px**: navegación compacta de Core.
- Desde **1024px**: sidebar permanente de escritorio.

Se conservaron los cortes específicos preexistentes de escritorio/tablet en 1020, 1050, 1100 y 1180px donde regulan tablas, paneles o métricas. No se añadió un sistema Tailwind ni otra escala responsive paralela. Las reglas anteriores de 560/720px se integraron en los grupos móviles correspondientes.

## Pruebas

### Renderizado e interacción en Edge sin interfaz

Modo plantilla: **320, 360, 375, 390, 414, 480, 768, 1024, 1280, 1440 y 1920px**.

Modo backend real: **320, 390, 768 y 1440px**, con login y datos V2. El servidor de pruebas usa un proxy local para API/WebSocket; no cambia la configuración de despliegue.

Se comprobaron lista, drawer/Escape, notificaciones, filtros, detalle, creación (apertura/cancelación), selector de fecha, colaboradores/seguidores, Kanban, movimiento por selector en plantilla, cronograma, calendario, Bandeja, Inicio, Informes, formulario de proyecto y modo oscuro. Se midió que no aparezca overflow horizontal del documento en los recorridos probados. Los formularios móviles también se probaron con altura reducida a 430px para comprobar la posición de sus botones.

### Regresiones funcionales

- `npm test`: **25 comprobaciones**.
- `npm run build`: correcto.
- `node tests/v2_dom.mjs mock`: recorrido funcional de plantilla.
- `node tests/v2_dom.mjs`: creación real, edición, traspaso, subtarea, comentario, restauración y borrado.
- `node tests/core_dom.mjs`: cambios de cargo, respuesta tardía, sockets, 401/403 y logout.
- `node tests/v2_live.mjs`: contratos V2, movimiento de sección y sincronización de dos clientes WebSocket.

Las capturas se guardan en `$env:TEMP\bold-responsive`. El test responsive usa Playwright instalado fuera del proyecto, junto a la instalación temporal de jsdom utilizada por las pruebas DOM:

```powershell
npm install --prefix "$env:TEMP\bold-v2-dom" playwright jsdom
node tests/responsive.mjs
# Con backend local sembrado:
$env:BOLD_REAL = 'true'
$env:BOLD_WIDTHS = '320,390,768,1440'
node tests/responsive.mjs
```

Se puede indicar otro ejecutable Chromium compatible mediante `BOLD_TEST_BROWSER`.

## Regresiones encontradas y resueltas

- Overflow de 36px a 1024px: cabecera y herramientas ahora hacen wrap sin perder controles.
- Los paneles fijos quedaban limitados por una animación con transform: ahora utilizan portales fuera del módulo animado.
- El footer podía comprimir/superponerse a los campos: se separó el área desplazable.
- Escape dejaba de funcionar si desaparecía el elemento enfocado de un selector: el manejo de teclado contempla esa pérdida de foco y respeta el panel superior.
- Bandeja fallaba por `notification_type_icons` inexistente: se restauró en el dominio de Tareas y se reutiliza para notificaciones.

## Límites y pendientes

- Falta prueba física en iOS/Safari y Android; la reducción de altura simula espacio disponible, no el teclado real del sistema.
- Calendario y cronograma conservan scroll horizontal **interno**, deliberadamente; no se intentan comprimir todas sus columnas.
- No se garantiza drag & drop táctil nativo: la alternativa soportada es el selector explícito de sección.
- Las capturas y verificaciones cubren los escenarios enumerados, no todas las combinaciones posibles de permisos y datos de producción.
