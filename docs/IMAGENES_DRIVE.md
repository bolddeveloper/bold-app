# Im√°genes de BOLD en Drive

En Administraci√≥n ‚Üí Conectores, configura el JSON OAuth, conecta la cuenta Google administradora y selecciona una carpeta en **Almacenamiento de im√°genes**. La selecci√≥n requiere los permisos actuales de Conectores y MFA reciente. No se concede acceso por direcci√≥n de correo.

Las im√°genes nuevas se guardan al guardar el recurso. La cuenta seleccionada realiza las operaciones de Drive; los dem√°s usuarios no necesitan conectar Google. Las lecturas pasan por el backend y comprueban los permisos del recurso. Los archivos no se hacen p√∫blicos. Quienes tengan acceso directo a la carpeta en Drive podr√°n leer sus archivos, incluidas im√°genes de notas privadas.

Desconectar la cuenta seleccionada pausa la subida y la lectura hasta reconectarla con la misma identidad Google. Cambiar de carpeta afecta a nuevas im√°genes; las anteriores conservan sus referencias. Quitar o reemplazar una imagen en BOLD no borra su archivo en Drive.

La estructura separa Proyectos, Mis tareas, Perfiles, Sugerencias, Notas privadas, Calendario, Workspace y Administraci√≥n/Cargos. Las tareas conservan su origen de creaci√≥n: proyecto original o creador de la tarea personal. Los IDs internos distinguen carpetas con nombres iguales. Las etiquetas se actualizan al guardar nombres; si Drive no est√° disponible, se reintentan en el siguiente guardado o migraci√≥n.

## Migraci√≥n inicial

Despu√©s de seleccionar la carpeta, ejecutar desde `backend`:

```powershell
.\venv\Scripts\python.exe manage.py migrate_drive_images --limit 100
```

Repetir hasta completar los registros pendientes, o quitar `--limit` para procesarlos todos. El comando sustituye referencias √∫nicamente despu√©s de subir im√°genes correctamente. Los registros que fallen conservan sus datos originales. Los reintentos recuperan archivos marcados por BOLD sin crear duplicados. No se ejecuta autom√°ticamente al iniciar el servidor ni durante una migraci√≥n del esquema.

Las descripciones locales de Workspace con im√°genes anteriores se migran al abrir Workspace o guardar la carpeta. Si fallan, se conserva el contenido original. Los eventos anteriores que viven en Google Calendar se convierten al volver a guardarlos desde BOLD.

Las subidas son s√≠ncronas y est√°n sujetas a tiempos de espera, memoria y permisos de Google. No se usa almacenamiento alternativo si Drive falla. Audios y documentos quedan fuera de este conector.

Las descripciones de tareas suben sus im√°genes antes de abrir la transacci√≥n de guardado para evitar bloquear otras escrituras en SQLite. Las peticiones de guardado de tareas tienen un tiempo m√°ximo de espera de dos minutos en el navegador; ante un resultado incierto, se conserva el borrador y debe comprobarse si la tarea aparece antes de repetirla. El l√≠mite global de tama√±o del cuerpo JSON de Django est√° deshabilitado porque las im√°genes viajan en base64; siguen aplicando la memoria disponible y los l√≠mites del proxy o servidor.


## CachÈ del navegador

Las im·genes privadas de BOLD (avatares, proyectos, descripciones y carruseles) se reutilizan desde IndexedDB, separadas por cuenta y cargo. Los originales permanecen en Drive; esta cachÈ no modifica las restricciones de subida o descarga. Los identificadores de imagen cambian al subir una imagen nueva.

Drive restaura su ˙ltima vista y sus miniaturas antes de consultar la conexiÛn. Las miniaturas se identifican por archivo y versiÛn. Calendario restaura la ˙ltima vista y los rangos ya consultados; ambos mÛdulos consultan cambios en segundo plano cada minuto mientras est·n visibles, y al recuperar foco o conexiÛn. Un cambio de contenido produce un aviso flotante; la primera carga no produce ese aviso.

La cachÈ no caduca por tiempo, pero tiene limpieza por uso: metadatos Google hasta 10 MB/100 entradas, miniaturas hasta 100 MB/2000 entradas e im·genes privadas hasta 256 MB/4000 entradas. El navegador tambiÈn puede borrar datos por falta de espacio. Rangos o im·genes todavÌa no consultados necesitan conexiÛn. Si IndexedDB falla, se conserva ˙nicamente cachÈ en memoria durante la sesiÛn.

Cerrar sesion cancela solicitudes y oculta las caches privadas sin borrarlas. La misma cuenta y cargo pueden reutilizarlas al entrar nuevamente. Los cambios de permisos limpian las imagenes privadas. La limpieza se comunica entre pestanas.


Las descripciones de carpetas de Workspace y proyectos ya no ofrecen subida de imagenes. Las imagenes anteriores se conservan, pero editar una carpeta no intenta migrarlas automaticamente a Drive.

Workspace permite agregar accesos a carpetas de Drive desde la misma ventana de seleccion de proyectos y tareas. Se reutiliza el selector de Docs, con busqueda, navegacion y creacion de carpetas. Los accesos se guardan con los datos existentes del workspace por departamento y se abren dentro del modulo Drive de BOLD, con los permisos Google habituales. Quitar un acceso no elimina la carpeta original. Las carpetas no compartidas siguen siendo locales.


Las carpetas creadas por el usuario pueden compartirse con personas activas de su departamento mediante el buscador por nombre o correo. El servidor guarda el arbol compartido, sus accesos y los destinatarios. Los destinatarios ven la carpeta y sus subcarpetas en modo consulta; el propietario controla la organizacion y puede quitar personas. Los cambios se consultan en segundo plano. Compartir una carpeta de Workspace no concede permisos adicionales sobre proyectos, tareas ni Google Drive. Aplicar la migracion boldApp_tareas 0012 en cada entorno antes de publicar este cambio.
