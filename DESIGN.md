---
name: BOLD 3
description: Sistema existente de BOLD; extracción acotada para extender Informes y etapas.
colors:
  bold_red: "#e73535"
  bold_red_dark: "#bd2828"
  bold_canvas: "#e9ecf0"
  bold_surface: "#fff"
  bold_surface_soft: "#f2f4f7"
  bold_text: "#1b1f25"
  bold_muted: "#535b65"
  bold_line: "#c0c5ce"
  bold_hover: "#e5e8ed"
typography:
  body:
    fontFamily: '"Inter", Arial, sans-serif'
    fontSize: "14px"
    lineHeight: 1.5
rounded:
  workspace: "0px"
spacing:
  gap-small: "8px"
  gap-pair: "12px"
  gap-standard: "16px"
  inset-panel: "20px"
  inset-workspace: "24px"
components:
  button:
    backgroundColor: "{colors.bold_surface}"
    textColor: "{colors.bold_text}"
    rounded: "{rounded.workspace}"
    padding: "8px 12px"
  button-primary:
    backgroundColor: "{colors.bold_red_dark}"
    textColor: "#fff"
    rounded: "{rounded.workspace}"
    padding: "8px 12px"
  input:
    backgroundColor: "{colors.bold_surface}"
    textColor: "{colors.bold_text}"
    rounded: "{rounded.workspace}"
    padding: "10px 12px"
  result-container:
    backgroundColor: "{colors.bold_surface}"
    textColor: "{colors.bold_text}"
    rounded: "{rounded.workspace}"
    padding: "24px"
---

# Design System: BOLD 3

## Overview

Registro descriptivo del sistema existente, cotejado con el código local de Informes y etapas. No introduce un mundo visual nuevo ni convierte la composición de Informes en una regla para otros módulos. La autoridad de paleta y geometría sigue siendo `frontend/modulos/core/design_v3.css`; los valores extraídos del frontmatter describen su tema claro y los patrones reutilizados por esta extensión. Ante cambios posteriores del código, reconciliar este registro con esa fuente.

No hay una metáfora creativa aprobada que registrar. La orientación confirmada es conservar BOLD 3: superficies delimitadas, geometría general recta y acento corporativo para acciones y estados; los controles compartidos conservan su geometría propia según la cascada existente. El tema oscuro depende de los mismos tokens semánticos redefinidos en `html.theme_dark`; no se deben fijar los valores claros dentro de componentes nuevos.

**Key Characteristics:**
- Paleta semántica compartida entre temas.
- Geometría recta en las superficies de trabajo.
- Controles compartidos de selección y fechas.
- Resultados acompañados por explicación y acceso a fuentes.

## Colors

### Primary

`bold_red` aporta el acento de selección, gráficos y foco; `bold_red_dark` se usa en las acciones primarias de Informes y etapas. Los enlaces de consulta usan una variable local derivada de estos tokens y adaptada al tema oscuro.

### Neutral

`bold_canvas` separa el espacio de trabajo; `bold_surface` y `bold_surface_soft` distinguen contenido y configuración. `bold_text` y `bold_muted` establecen jerarquía textual; `bold_line` delimita bloques, filas y campos; `bold_hover` muestra interacción. El calendario y los gráficos conservan las mezclas de color ya implementadas; no se extrae una escala tonal nueva.

## Typography

La familia procede de `:root` en `frontend/modulos/tareas/src/styles.css`; la extensión la hereda. El rol `body` del frontmatter corresponde al texto de Informes y etapas. No se establece una nueva fuente de títulos.

La jerarquía observada en `reports.css` usa título de módulo (28px, peso 700, interlínea 1.2), título de informe (20px, interlínea 1.3), secciones (16px, interlínea 1.4) y etiquetas (13px). El título del módulo baja a 24px en su vista estrecha. Son medidas de esta superficie, no una escala global nueva. Los valores e historial usan cifras tabulares; la explicación de resultados limita sus párrafos a 75ch.

## Layout

La carcasa BOLD 3 mantiene su columna lateral (244px) y una zona principal flexible. Los patrones compartidos usan separación y rellenos del frontmatter; no existe una nueva escala CSS de espaciado creada por esta documentación.

En Informes, el contenedor llega a 1680px. El constructor abierto ocupa una columna de 320px junto al resultado; a 1100px baja a 280px. A 800px se presenta antes del resultado, en una columna, con acción explícita para ocultarlo. Las tablas conservan desplazamiento horizontal propio. En etapas, los pares de campos pasan a una columna a 600px. Estos puntos de corte pertenecen a las superficies indicadas, no sustituyen las reglas adaptables de otros módulos.

## Elevation & Depth

Las superficies de trabajo BOLD 3 se separan principalmente por fondos y bordes, sin sombra en sus tarjetas comunes. Esto no prohíbe la elevación en controles flotantes: el calendario compartido tiene una sombra difusa y animación de entrada propias, registradas en el sidecar. Reutilizar el control conserva también su alternativa de movimiento reducido.

## Shapes

Los contenedores y botones propios de estas superficies siguen la geometría recta de BOLD 3, registrada en `rounded.workspace`. Los controles compartidos conservan la geometría que determina su cascada actual. En particular, el disparador de `BoldSelect` usa esquinas redondeadas (9px): `.admin_select_trigger` en `frontend/modulos/administrativo/admin.css` declara `border-radius: 9px !important`, que prevalece sobre la regla general `.bold_v3 :is(...)` de `design_v3.css`. Esta excepción observada no se convierte en un nuevo token global ni se repara en esta extensión. Los avatares y marcadores de fechas conservan sus círculos existentes; no se debe convertir la geometría recta de los paneles en una prohibición de esas formas funcionales.

## Components

- **Botones y campos:** heredan tipografía y tokens; borde fino, estados de hover y deshabilitado, foco visible rojo. Las acciones primarias de Informes y etapas usan el mismo tratamiento. La altura mínima observada es 40px; sube a 44px en sus reglas móviles.
- **Selección y fechas:** reutilizar `BoldSelect` de `frontend/modulos/core/shared/bold_select.jsx`, `CalendarDateRangeField` y el calendario de `date_picker.jsx`. Mantener su geometría propia descrita en Shapes, etiquetas, estados abiertos, búsqueda cuando corresponda y retorno del foco que esos controles implementan.
- **Colecciones:** selección indicada por borde inferior de acento y estado `aria-current`; conservan desplazamiento horizontal cuando falta espacio.
- **Resultados:** fórmula, valor, casos conocidos, insuficiencia histórica y tabla de registros. Las barras son acciones seleccionables; líneas y distribución ofrecen una tabla con valores y acceso al grupo. No usar el color como único identificador del dato.
- **Consulta y recuperación:** Informes presenta comprobación de permisos, necesidad de conexión real, cálculo, reintento, vacío y preparación sin aplicar. Etapas distingue carga, error y revisión de cambios concurrentes. La documentación describe estos estados implementados; no certifica una auditoría completa de accesibilidad o permisos.

## Do's and Don'ts

### Do:

- Reutilizar los tokens de BOLD 3 y sus controles compartidos al extender estas superficies.
- Conservar explicación, cobertura y fuentes junto al resultado de un informe.
- Mantener las preparaciones y los resultados aplicados como estados distintos.

### Don't:

- No fijar la paleta clara en componentes que deben responder al tema oscuro.
- No sustituir la identidad BOLD 3 como consecuencia de añadir una función.
- No convertir la composición o los tamaños particulares de Informes en reglas globales.
