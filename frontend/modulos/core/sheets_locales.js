import {LocaleType, mergeLocales} from '@univerjs/core';
import design from '@univerjs/design/locale/es-ES';
import ui from '@univerjs/ui/locale/es-ES';
import docs from '@univerjs/docs-ui/locale/es-ES';
import sheets from '@univerjs/sheets-ui/locale/es-ES';
import formula from '@univerjs/sheets-formula-ui/locale/es-ES';
import numberFormat from '@univerjs/sheets-numfmt-ui/locale/es-ES';
import validation from '@univerjs/sheets-data-validation-ui/locale/es-ES';
import table from '@univerjs/sheets-table/locale/es-ES';
import tableUi from '@univerjs/sheets-table-ui/locale/es-ES';
import filter from '@univerjs/sheets-filter-ui/locale/es-ES';
import sort from '@univerjs/sheets-sort-ui/locale/es-ES';
import conditionalFormat from '@univerjs/sheets-conditional-formatting-ui/locale/es-ES';
import links from '@univerjs/sheets-hyper-link-ui/locale/es-ES';
import notes from '@univerjs/sheets-note-ui/locale/es-ES';
import drawings from '@univerjs/sheets-drawing-ui/locale/es-ES';
import drawingUi from '@univerjs/drawing-ui/locale/es-ES';
import comments from '@univerjs/sheets-thread-comment-ui/locale/es-ES';
import commentUi from '@univerjs/thread-comment-ui/locale/es-ES';
import find from '@univerjs/find-replace/locale/es-ES';

export const sheetLocales = {[LocaleType.ES_ES]: mergeLocales(design, ui, docs, sheets, formula, numberFormat,
  validation, table, tableUi, filter, sort, conditionalFormat, links, notes, drawings, drawingUi, comments, commentUi, find, {
    'sheets-table-ui': {
      ...tableUi['sheets-table-ui'],
      selectRange:'Elegir celdas de la tabla', rename:'Cambiar nombre', renamePlaceholder:'Ej.: Ventas_2026',
      updateRange:'Cambiar celdas', setTheme:'Cambiar colores', removeTable:'Quitar tabla',
      tableStyle:'Colores de tabla', defaultStyle:'Elige un diseño', customStyle:'Tus diseños',
      addStyle:'Crear diseño', applyStyle:'Aplicar diseño', styleHelp:'Elige un color. La tabla cambia al instante.',
      tableNameError:'Usa un nombre único, sin espacios y que empiece con una letra. Ej.: Ventas_2026.',
      customTooMore:'Puedes guardar hasta 11 diseños. Quita uno para crear otro.',
      header:'Encabezados', firstLine:'Filas impares', secondLine:'Filas pares', footer:'Última fila',
      columnMenu:{...tableUi['sheets-table-ui'].columnMenu, 'insert-left':'Añadir columna a la izquierda', 'insert-right':'Añadir columna a la derecha', delete:'Quitar columna'},
      sort:{...tableUi['sheets-table-ui'].sort, 'sort-asc':'Ordenar de menor a mayor', 'sort-desc':'Ordenar de mayor a menor'},
      filter:{...tableUi['sheets-table-ui'].filter, 'by-values':'Elegir valores', 'by-conditions':'Filtrar con una regla', 'clear-filter':'Mostrar todo', confirm:'Aplicar', 'search-placeholder':'Buscar valores…'}
    }
  })};
