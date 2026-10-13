# Hojas de BOLD

## Implementación local

Hojas usa Casual Sheets SDK 0.20.0 sobre Univer OSS 0.25.0 como vista principal. Incluye menús, fórmulas, formato, imágenes, gráficos y tablas dinámicas. La vista de bloques trabaja sobre el mismo documento; cambiar de vista no crea otra copia. La información vive en BOLD y cada archivo conectado mantiene un único Excel en Drive. El encabezado global se oculta dentro del editor y lector.

La exportación conserva ExcelJS y añade Excelize WASM 0.1.3 en el servicio Node privado. Los gráficos y tablas dinámicas de BOLD se escriben como objetos nativos editables del `.xlsx`, sin convertir los gráficos en PNG. No requiere Docker, Collabora ni otro servicio. Cada exportación libera el proceso WASM al terminar; conserva un registro de las partes generadas para reemplazarlas en guardados posteriores.

Esta entrega permanece en local. No se ejecutaron pruebas funcionales ni compilaciones y no se desplegó en Oracle o Cloudflare. Los casos de prueba están preparados para ejecutarse cuando se retire la indicación de no probar.

### Arranque

Desde `backend`, con su entorno virtual activo:

```powershell
python manage.py migrate boldApp_hojas
python manage.py runserver
```

Desde `services/sheets-engine`:

```powershell
npm ci --ignore-scripts
npm start
```

Desde `frontend/modulos/core`, ejecutar `npm ci` y usar el arranque habitual de Vite. El `postinstall` aplica traducciones de los controles y elimina únicamente la referencia del SDK a un paquete opcional de menciones que no está publicado en npm. Los comentarios reales permanecen habilitados; la búsqueda de responsables de BOLD no depende de ese paquete. El parche exige la versión exacta 0.20.0 para impedir una actualización silenciosa incompatible. El motor de Hojas escucha en `127.0.0.1:8010` y exige el mismo token configurado en el backend. No es una API pública para el navegador.

El mismo `postinstall` corrige la carga de complementos del SDK: cada instancia de Univer mantiene sus registros y promesas pendientes. Una importación que termina después del cierre no registra complementos en el editor eliminado. La cuadrícula confirma las celdas antes de que el SDK cierre su motor. Los casos de reapertura, cierre durante una importación y reintento tras error están preparados en `sheets_lifecycle.test.js`, sin ejecutar.

Cada montaje usa un contenedor propio para el canvas. El cierre diferido de una instancia anterior no desmonta la raíz React de la nueva durante StrictMode. La incorporación de recursos vacíos al cargar complementos no cuenta como edición: evita el ciclo de guardado y remontaje sin cambios del usuario. Los comentarios, dibujos y otros recursos con datos siguen detectándose, incluida su eliminación.

Los recursos vacíos de formato condicional, temas y validación se interpretan como colecciones vacías al renderizar y calcular. El editor compara las respuestas de guardado con su estado actual: confirmar un cambio de tamaño o formato no vuelve a montar el motor ni borra Deshacer/Rehacer. El desplazamiento no dispara guardados. Las celdas recibidas del servidor se aplican mediante mutaciones, sin registrar ediciones remotas en el historial local. Los casos de recursos vacíos, tamaños y el historial real de Univer están preparados, sin ejecutar.

Configuración:

| Variable | Uso |
| --- | --- |
| `SHEETS_ENGINE_URL` | URL privada; por defecto `http://127.0.0.1:8010`. |
| `SHEETS_ENGINE_TOKEN` | Secreto compartido entre Django y Node. Obligatorio fuera de desarrollo. |
| `SHEETS_AGENDA_SOURCE` | Ruta local, controlada por el servidor, del Excel original que se recreará. |
| `REDIS_URL` | Broker y canales compartidos para varios procesos. |

En desarrollo, el motor lee `backend/.env`; sin token explícito y con `DEBUG` habilitado usa el secreto de desarrollo del backend. En otros entornos, ambos servicios deben recibir un token privado explícito.

El desarrollo existente utiliza SQLite y canales en memoria. La colaboración entre varias instancias y las garantías de bloqueo requieren PostgreSQL, Redis, worker y Celery Beat. El servicio privado y su conexión se añadieron al archivo de Compose para un despliegue futuro; no se arrancaron en Oracle.

En SQLite, las transacciones adquieren el bloqueo de escritura al comenzar (`IMMEDIATE`) y esperan hasta veinte segundos. Esto evita errores al convertir una lectura en escritura mientras otro guardado o trabajo local escribe. La configuración de PostgreSQL permanece intacta.

El guardado local programa trabajos sin bloquear la edición. Para recuperar trabajos pendientes después de reiniciar el backend puede ejecutarse, desde `backend`:

```powershell
python manage.py sheets_sync
```

Sin Redis, este proceso separado no comparte los eventos WebSocket del servidor. Para colaboración con varios procesos debe usarse Redis.

### Permisos

La migración registra `sheets.file.read`, `create`, `edit`, `assign`, `share`, `export` y `delete`. No concede permisos automáticamente. Asignarlos mediante el sistema existente de permisos; Hojas aparece cuando la cuenta tiene lectura en su cargo actual.

Cada petición, conexión WebSocket y trabajo comprueba acceso. Los miembros son lectores o editores; compartir y eliminar corresponde al propietario. Compartir un archivo no concede permisos de tareas ni de departamentos. Las tareas asignadas siguen disponibles en Mis tareas aunque el responsable no tenga acceso a Hojas.

Las imágenes privadas presentes en una hoja tienen un vínculo de acceso al archivo. Un lector puede ver esas imágenes sin recibir acceso a la tarea original. Reutilizar una imagen ajena exige acceso previo; revocar el archivo impide servir sus imágenes mediante ese vínculo. Las imágenes nuevas sin tarea vinculada permanecen en el contenido de la hoja; al conectarla, el sistema existente de tareas puede almacenarlas en Drive.

## Uso del editor

- Biblioteca con Mis archivos, Compartidos, Favoritos, Plantillas y Papelera; carpetas, búsqueda, duplicación y movimiento.
- Herramientas nativas de cuadrícula: fórmulas, formato, bordes, alineación, combinación, selección, pegado, ordenación, filtros, congelación, buscar/reemplazar, validaciones, formato condicional, enlaces, zoom y estadísticas.
- Pestañas de BOLD para añadir, duplicar, renombrar, ordenar y eliminar hojas conservando la relación con tareas.
- Menú Insertar y arrastre para cuadros de tareas, productos/licencias, comparación, resumen y texto.
- «Tabla y tareas» configura campos, desplegables y colores, departamento, asociación de estados, moneda, descuento, impuesto y conversión.
- En la vista de bloques se pueden guardar filtros personales, agrupar y plegar filas por departamento, responsable o estado.
- Las celdas Archivo/descripción y Última nota abren el editor enriquecido y el historial de comentarios. La cuadrícula muestra un resumen del contenido; las imágenes permanecen en el editor de descripción y en los comentarios.

Las tablas mantienen identificadores ocultos para sus filas y columnas. Insertar o eliminar filas dentro de una tabla usa las operaciones de BOLD. Para cambiar sus columnas se usa «Tabla y tareas». Ordenar incluye la identidad de cada fila. Estas restricciones evitan separar una tarea de su información.

Los ajustes de bloques separan columnas, precios y tareas. Cada columna muestra su nombre y tipo; al abrirla aparecen sus campos y las opciones de las listas. Los campos necesarios para cálculos y tareas están protegidos. Descuento, impuesto y conversión quedan en una sección plegable. La conexión explica quién recibe la tarea y cómo relacionar sus estados. Se conservan los controles de permisos y la validación del servidor.

Las fechas de la vista de bloques usan el mismo calendario de Tareas y Calendario. Pulsar cualquier parte del campo abre el selector; permite aplicar o quitar la fecha y conserva la fecha ISO de la fila. Los lectores ven el campo desactivado. El selector usa la capa superior del navegador para evitar que lo recorte el desplazamiento de la tabla.

Los bloques nuevos usan encabezados de BOLD, filas alternadas, texto ajustado y anchos según el contenido. Al configurar un bloque se conservan sus valores, fórmulas, formatos y tamaños elegidos. La exportación crea una tabla de Excel por bloque con datos, filtros y un nombre permanente, sin duplicarla al añadir filas ni superponerla a una tabla importada. Texto y resumen mantienen sus celdas habituales. Las alturas automáticas del Excel exportado se estiman por caracteres; las alturas manuales se respetan y no se garantiza un ajuste idéntico al de Excel.

### Agenda de triunfos

La plantilla normal incluye las seis estructuras: Liderazgo, Procesos, IT, Herramientas, Copia de Procesos y Bold Lab.

La recreación inicial local lee el archivo indicado por `SHEETS_AGENDA_SOURCE`. Copia información, fechas, estados y cuadros de costos, dejando vacíos responsables y colaboradores. No genera tareas históricas ni modifica el archivo original. Los subtotales nuevos incluyen todos los productos del cuadro.

Solo el archivo inicial marcado por el servidor puede quedar «Pendiente de carpeta». Se puede editar, calcular y descargar antes de conectarlo. Los demás archivos requieren nombre y carpeta de Drive antes de entrar al editor.

Si ya existe la recreación inicial vacía con revisión cero, su propietario verá «Recrear contenido de Agenda». Esta acción guarda una versión recuperable y solo reemplaza la recreación si continúa vacía y sin editar. No sobrescribe archivos con información del usuario.

## Filas y tareas

Los bloques Tareas crean una tarea compartida cuando una fila contiene título y un responsable o colaboradores válidos. La conexión se activa automáticamente sobre el departamento de la primera persona seleccionada, salvo que ya se haya elegido uno. Los estados predeterminados se asocian por categoría a los estados existentes del departamento; las opciones personalizadas necesitan asociación explícita. Se mantienen los permisos de creación y asignación. Los cuadros de costos solo generan tareas al activar esa opción.

Título, responsable, colaboradores, prioridad, entrega y estado se sincronizan en ambos sentidos. Los archivos usan descripción y las notas añaden comentarios; repetir la misma nota no repite el comentario. Se conserva un perfil por persona y el cargo válido del departamento.

Reasignar mantiene la tarea. Quitar responsable no la elimina. Eliminar fila, hoja o archivo conserva y desvincula tareas. Duplicar elimina asignaciones y vínculos. Si una tarea se elimina o cambia de departamento, el vínculo se desactiva; el archivo no copia datos del nuevo departamento.

Las operaciones tienen ID idempotente y revisión. Cambios independientes de celdas pueden combinarse. Un conflicto conserva los valores del servidor y del borrador y solicita resolución. Las operaciones estructurales se serializan y una revisión incompatible conserva el borrador. Fila y tarea se guardan en una transacción; los eventos se emiten después del guardado.

La cuadrícula permite seleccionar una celda con un clic y escribir. Salir del editor confirma el texto sin desplazar la selección. Las actualizaciones recibidas en segundo plano esperan a que termine la edición de la celda. Los menús de Hojas permanecen dentro del módulo y de la pantalla; se cierran al seleccionar una acción, pulsar fuera, abrir otro menú o usar Escape.

Guardar y recibir estados de Drive conserva la referencia al documento cuando sus datos no cambian. La comparación ignora el orden de las claves JSON y mantiene las referencias de formato guardadas, incluidas las de filas y columnas. Los valores, encabezados y tamaños recibidos se aplican mediante mutaciones sin remontar el editor ni añadirlos al historial local de deshacer. Cambios reales de estructura, como añadir hojas, combinar celdas o sustituir recursos nativos, todavía necesitan reconstruir la cuadrícula; el guardado normal no usa ese camino.

La caché IndexedDB se separa por cuenta y archivo. Recargar o iniciar otra vez la misma cuenta conserva su copia en este navegador. Revocar acceso elimina la copia correspondiente. Los avisos de sincronización aparecen arriba a la derecha.

## Drive y recuperación

El selector existente permite buscar y crear carpetas. BOLD guarda cuenta conectada, carpeta e ID reservado antes de crear el Excel. Los editores compartidos usan ese destino. Reintentos consultan y reutilizan el ID; no crean otro archivo. Nombre y carpeta también se actualizan sobre el mismo archivo.

BOLD guarda primero. El trabajo de fondo agrupa cambios tras tres segundos sin edición, con un máximo de quince segundos de edición continua. Mantiene un trabajo activo por archivo y la revisión pendiente más reciente. Los cambios desde Mis tareas también programan actualización.

Los estados visibles son pendiente, sincronizando, actualizado, incorporando cambios de Drive y error. Los cambios de BOLD aceptados por checksum no generan una alerta de edición externa. Los fallos mantienen el trabajo pendiente, con reintentos limitados y acción manual. Si el Excel desaparece o se pierden permisos, se pausa; no se recrea silenciosamente.

Se comprueba la versión antes de subir y cada minuto mientras el archivo está abierto. Ante una modificación externa:

1. Se programa la incorporación en segundo plano, sin el antiguo aviso fijo de cambios externos.
2. Se descargan y validan los datos y se combinan cambios independientes con la última versión común de BOLD y Drive.
3. Antes de aplicar se comprueba otra vez la versión de Drive y la revisión de BOLD. No se aplica mientras haya una subida activa.
4. Se conserva una versión recuperable, se actualizan las tareas por sus identificadores y se registra la versión importada para evitar ciclos.
5. Los conflictos sobre el mismo dato, identificadores faltantes o responsables ambiguos detienen esa incorporación y conservan ambas versiones. La revisión manual permanece disponible para resolverlos; «Ver vista previa en Drive» abre el mismo archivo.

Filas eliminadas desvinculan sus tareas. Filas nuevas solo las generan tras validar responsable y permisos. Sin los identificadores técnicos no se enlazan tareas por coincidencia de nombres. Descargar Excel no crea archivos adicionales en Drive.

## Alcance y compatibilidad

Univer OSS y ExcelJS permiten el editor solicitado sin complementos de pago. No constituyen una implementación completa de Excel. La compatibilidad se limita a las funciones del motor y a los elementos que el conversor puede representar.

La cuadrícula admite formatos condicionales nativos. Se exportan reglas de valores, fórmulas, texto, clasificación, fechas, escalas de color y barras de datos. Los conjuntos de iconos, las reglas «Detener si es verdadero» y reglas con múltiples rangos exigen resolución antes de exportar. Permanecen guardadas en BOLD; no se eliminan para completar una subida.

La exportación admite rangos con nombre globales con referencias directas y límites de fecha fijos en validaciones. Los nombres definidos como fórmulas y las validaciones de fechas con fórmulas se conservan en BOLD pero impiden la exportación hasta resolverlos. La selección múltiple de personas conserva sus datos e identidad en los metadatos; Excel no reproduce el selector interactivo de BOLD.

Excel recibe el rango del filtro de la cuadrícula y todas sus filas. Las selecciones de filtros de BOLD se conservan en los metadatos y se recuperan al importar si el rango no cambió; no se convierten en criterios de filtro de Excel. Los filtros personales de la vista de bloques pertenecen a cada usuario y no modifican el contenido del Excel.

La subida y actualización desde Drive conservan el paquete OOXML original, incluidas partes que la cuadrícula no interpreta. Ya no se rechaza todo un archivo por contener gráficos, dibujos o tablas dinámicas. Las imágenes PNG, JPEG y GIF se muestran como dibujos y se exportan con sus posiciones; las imágenes de las descripciones siguen conservándose en los metadatos de contenido enriquecido. Los gráficos 2D compatibles se leen como modelos editables. Los objetos especializados no reconocidos permanecen en el Excel original; no se garantiza que se dibujen idénticos en BOLD. Las macros y conexiones externas no se ejecutan.

Los gráficos creados en BOLD usan referencias a las celdas; incluyen columnas, barras, líneas, áreas, circular, anillo y dispersión, apilado, títulos, etiquetas y combinaciones de hasta dos grupos de series con eje secundario. Las tablas dinámicas exportan suma, conteo, promedio, mínimo, máximo, filtros y porcentajes. La agrupación de fechas y el conteo distinto permanecen en BOLD, pero requieren ajustar esa configuración antes de exportar una tabla nativa. El editor todavía puede mostrar algunos textos internos en inglés.

Las notas de celdas de Excel se admiten. Los archivos y descripciones exportan su primer enlace HTTP/HTTPS como enlace de celda; el contenido completo permanece en los metadatos. Cambiar ese enlace en Excel conserva el resto del contenido. Si la descripción contiene varios enlaces y se cambia el enlace de celda, la importación exige resolverlo en BOLD antes de aplicar.

Límites: 30 hojas, 20 000 filas y 500 columnas por hoja, 100 000 celdas guardadas y 8 MB de documento. Excel de entrada: 20 MB comprimidos y 80 MB descomprimidos. Los cuadros de costos no permiten sumar monedas diferentes sin configurar conversión.

### Alternativas revisadas

Los formatos de subrayado y tachado se convierten a objetos `ITextDecoration` antes de entrar en Univer, incluidos los archivos antiguos guardados. La exportación comprueba su indicador `s`; un objeto con `s: 0` no activa el formato en Excel. Los cambios de representación que no cambian el formato mantienen la base guardada de la operación para evitar conflictos falsos.

Las paletas de color, bordes y Autosuma usan la capa superior del navegador para escapar del recorte de la barra horizontal. Conservan el tema, cierran al pulsar fuera o Escape y admiten activación con teclado. Los comandos de la barra confirman la celda pendiente y notifican errores sin perder su texto. El parche se aplica desde `postinstall`; Vite incluye la barra en sus dependencias optimizadas.

Los paneles nativos cargan sus traducciones en español y sus hojas de estilo. El menú de tablas usa «Cambiar nombre», «Cambiar celdas», «Cambiar colores» y «Quitar tabla». El panel muestra diseños con colores visibles, indica el elegido y permite aplicarlos con Enter o Espacio. «Crear diseño» abre los colores de encabezados, filas pares e impares y última fila. Se conserva el nombre técnico existente de cada tabla para no romper referencias de fórmulas. Quitar la tabla conserva sus celdas.

«Crear gráfico» muestra el rango y una vista previa de los datos seleccionados. Los tipos se agrupan por propósito: comparar cantidades, ver cambios, partes de un total y relacionar dos cantidades. El título es opcional; cada tipo explica qué columnas usa. El formulario impide crear gráficos sin cantidades válidas y conserva los trece tipos disponibles. Las pruebas de traducciones, controles y selección de datos están preparadas, sin ejecutar.

[Casual Sheets](https://github.com/CasualOffice/sheets) aporta el editor con licencia Apache 2.0 y conserva la integración con las filas, tareas y permisos propios de BOLD. [Excelize WASM](https://github.com/xuri/excelize-wasm), con licencia BSD, resuelve la exportación de gráficos nativos editables. Se usan únicamente componentes gratuitos; no se incluyen complementos Univer Pro. No se promete equivalencia completa con Excel.

[FortuneSheet](https://github.com/ruilisi/fortune-sheet) ofrece otra cuadrícula con licencia MIT, pero no resuelve por sí solo las funciones avanzadas faltantes. [ONLYOFFICE DocumentServer](https://github.com/ONLYOFFICE/DocumentServer) ofrece un editor más cercano a Office; incorporarlo supondría otro servicio y otra integración de tareas. Su edición comunitaria usa AGPL; [la documentación oficial explica sus condiciones de integración y marca](https://helpcenter.onlyoffice.com/docs/faq/docs-community.aspx). No se instaló ni se cambió la licencia de BOLD.

Referencias: [Univer OSS](https://github.com/dream-num/univer), [Univer en Node](https://docs.univer.ai/guides/sheets/getting-started/node), [ExcelJS](https://github.com/exceljs/exceljs), [IDs de Drive](https://developers.google.com/workspace/drive/api/guides/create-file), [actualización de Drive](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update).

## Validación preparada

Los nombres reservados de filtros de Excel (`_xlnm._FilterDatabase` y `_FilterDatabase`) no se tratan como rangos de fórmulas. La exportación los reconstruye mediante los filtros; se conservan los rangos definidos por el usuario. La limpieza de gráficos y tablas dinámicas conserva los tipos de contenido que no tienen `PartName`. Ambos casos cuentan con pruebas preparadas, sin ejecutar.

Al añadir tablas o pestañas a un Excel existente se usan partes `tableN.xml` y `sheetN.xml`, sin sobrescribir las existentes. Las tablas nuevas usan relaciones relativas a la hoja. Estos nombres y rutas permiten que ExcelJS vuelva a leer el archivo durante el recálculo; los identificadores de BOLD permanecen en los metadatos. Hay pruebas preparadas de lectura, recálculo y exportaciones repetidas sin tablas duplicadas.

Responsables y colaboradores se muestran como nombres con un selector discreto. El texto enriquecido antiguo no sustituye esa etiqueta por el correo, ni en la cuadrícula ni en la exportación. Las asignaciones conservan sus identificadores. Los errores de recálculo conocidos muestran la causa del archivo o del servicio en vez de atribuir siempre el fallo a un motor desconectado.

La importación conserva las tablas de Excel como tablas de la cuadrícula: nombre, rango, columnas, filtros y estilos personalizados definidos por el archivo. Se leen los colores del tema y los estilos diferenciales de las tablas, incluyendo las franjas y los bordes. Se conservan anchos estrechos, alturas y niveles de agrupación para exportarlos. El parche de restauración de Univer mantiene el tema guardado de cada tabla. Las paletas integradas que no tienen definición en el XLSX usan las paletas disponibles en el editor; no se garantiza equivalencia visual de todas las paletas de Excel. Los archivos convertidos anteriormente a bloques necesitan una nueva importación para recuperar su diseño original; no se reemplazan automáticamente datos editados.

La mezcla automática de Drive compara cada recurso por nombre y por su contenido JSON, no por el orden del texto serializado. Combina cambios en reglas independientes mediante sus identificadores, ignora recursos vacíos y las reglas de tema que el editor deriva de las tablas. Importaciones sucesivas conservan los identificadores de tablas, validaciones, nombres y enlaces. Una edición de BOLD durante la descarga se mezcla con la revisión más reciente. Si Drive y BOLD modifican el contenido de la misma celda, se conserva la edición pendiente de BOLD y se incorpora el resto de los cambios compatibles de Drive. La versión entrante completa queda en «Versiones recuperables» como «Cambios de Drive conservados», junto al estado anterior de BOLD. Los identificadores técnicos y las estructuras incompatibles siguen requiriendo resolución; la edición simultánea entre personas dentro de BOLD conserva su comprobación de conflictos.

Al comparar documentos, valores ausentes, nulos y cadenas vacías representan la misma celda vacía; cero y falso conservan sus valores. La importación de responsables y colaboradores vacíos normaliza el valor a una cadena vacía y no presenta cambios ficticios ni `undefined` en la revisión. Hay pruebas preparadas de importación de personas vacías, conservación de contenido y fórmulas, mezcla de formato independiente y recuperación de ambas versiones después de una actualización automática de Drive.

Los selectores de responsables y colaboradores muestran nombres y guardan los identificadores de asignación. Los nombres repetidos entre personas distintas requieren seleccionar el perfil desde Bloques; nunca se elige una persona por coincidencia de nombre. Las listas y casillas de las columnas de bloques se derivan de su configuración con identificadores estables y no forman parte del guardado ni del historial de deshacer. Las validaciones nativas fuera de esas columnas se conservan. Actualizar personas u opciones modifica los selectores sin remontar el editor. Las alturas calculadas por el renderizador (`ah`) tampoco cuentan como ediciones; las alturas manuales y su configuración se conservan. Las operaciones de cuadrícula con una base válida combinan cambios independientes aunque otra persona haya avanzado la revisión; los cambios incompatibles conservan el borrador y la versión guardada.

Las selecciones múltiples del editor pueden llegar como listas JSON de nombres. Antes de guardar se convierten en identificadores de asignación, respetando los límites de cada nombre y las posiciones vigentes. Los borradores antiguos con ese formato también se normalizan en el servidor, sin modificar el cuerpo usado para comprobar reintentos ni sustituir otras celdas. Nombres desconocidos o compartidos por personas distintas requieren elegir el perfil; nunca se asignan por aproximación. Hay pruebas preparadas de selección múltiple después de sincronizar Drive, conservación de tareas y otras celdas, nombres con comas, vaciado explícito, ambigüedad y reintentos sin duplicaciones.

Los casos cubren permisos y revocación, creación con destino, Agenda sin tareas históricas, tareas sin duplicaciones, sincronización inversa, conflictos, conservación de borradores, exportación y cálculos, identidad de filas, mismo ID de Drive, subidas inciertas, cambios externos, recuperación, notas y fallos de Google. Hay casos WebSocket de revocación y casos del conversor para formato condicional y fechas.

Archivos: `backend/boldApp/hojas/tests/`, `frontend/modulos/hojas/sheets_model.test.js` y `services/sheets-engine/*.test.mjs`. Hay casos adicionales de mezcla de cambios de Drive, gráficos y tablas nativas sin duplicados, importación de gráficos e imágenes con sus posiciones. Permanecen sin ejecutar. La revisión de sintaxis no sustituye esas pruebas ni una revisión visual en el navegador.
