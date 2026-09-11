# Rework tablet de BoldApp

## Estructura aplicada

La franja tablet usa `761–1023px`, entre la representación móvil y el shell de escritorio. Conserva los mismos estados, handlers y contratos del Backend V2.

- **Shell:** navegación mediante drawer de 320px, cabecera compacta, buscador amplio y notificaciones como panel lateral.
- **Tareas:** la tabla se sustituye visualmente por las cards existentes en una cuadrícula de dos columnas. Los títulos envuelven y las acciones táctiles permanecen visibles.
- **Kanban:** presenta dos columnas legibles y permite desplazamiento horizontal local. El selector «Mover a sección» complementa drag & drop en dispositivos táctiles.
- **Detalle de tarea:** drawer derecho de hasta 620px con backdrop, cierre exterior, Escape y foco contenido.
- **Formularios:** diálogos centrados con tamaño máximo tablet; los campos tienen scroll interno y el footer permanece accesible con poca altura.
- **Bandeja:** hasta 899px abre el detalle como drawer; entre 900 y 1023px usa una vista maestro/detalle en dos paneles.
- **Inicio:** métricas en tres columnas y contenido secundario en una cuadrícula de dos columnas.
- **Informes:** cuatro métricas compactas; gráficas y bloques mantienen el ancho disponible.
- **Modo oscuro:** cards, drawers, Bandeja, notificaciones, formularios y controles responsive reutilizan la paleta oscura del escritorio.

## Archivos

- `src/tasks_tablet.css`: reglas específicas del dominio Tareas para tablet.
- `src/task_app.jsx`: portales y manejo de diálogo para detalle de tarea y Bandeja en tablet.
- `src/main.jsx`: carga del stylesheet tablet.
- `../../core/app_shell.css`: ajustes tablet del shell y notificaciones.
- `tests/responsive.mjs`: cobertura de 768, 820, 900 y 1023px, además del límite de escritorio en 1024px.

## Validación

- Sin overflow horizontal global.
- Drawer, Escape y cierre exterior comprobados.
- Lista, detalle, creación, Kanban, cronograma, calendario, Bandeja, Inicio, Informes, proyecto y modo oscuro recorridos en navegador.
- `npm test` y `npm run build` correctos.
- Auditoría oscura automatizada y visual en 320, 768, 900 y 1024px.
