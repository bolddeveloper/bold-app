# Drive y Docs en BOLD

La integración usa cuentas Google individuales. La conexión requiere la sesión de BOLD y conserva los permisos reales de la cuenta Google; no comparte las credenciales del calendario del equipo.

Docs usa pestañas internas y un visor iframe de publicaciones Google de solo lectura. «Vista Docs» conserva la biblioteca y creación de archivos; abrir un archivo nativo desde Drive o Docs activa una pestaña sin duplicarla. Las pestañas permanecen al cambiar módulos durante la sesión y se limpian al desconectar/cambiar cuenta Google o cerrar sesión. El botón «Abrir en Google» permite editar y usar Gemini.

Los editores propios están activos con `GOOGLE_WORKSPACE_EDITORS_ENABLED=true`. El visor publicado y sus pestañas se conservan en el código, temporalmente desactivados. Configurar false permite volver al visor de solo lectura. La conexión expone `editors_enabled`; cuando vale false, el frontend oculta los editores y el backend rechaza sus escrituras con 403. Para reactivarlos, configurar explícitamente esta bandera como true y reiniciar backend. Sus pruebas habilitan la bandera temporalmente.

`GET/PUT/DELETE /api/v2/workspace/files/{id}/published-view/` verifica acceso al original y conserva asociaciones por usuario BOLD, identidad Google y archivo. La migración `0002_publishedview` crea este almacenamiento; no se guarda contenido de archivos. GET consulta revisiones paginadas de Drive, distingue publicado/sin publicación/desconocido y usa enlaces publicados detectados cuando están disponibles. Una asociación manual nunca acredita publicación verificada. La consulta limita diez páginas: si no concluye, conserva estado desconocido.

Se admite URL publicada o código iframe, extrayendo únicamente un src. Se validan HTTPS, dominio exacto docs.google.com y rutas correspondientes a Docs/Sheets/Slides. Se descartan parámetros ajenos; no se ejecuta HTML pegado ni se colocan tokens en URLs. El iframe no permite navegación superior, ventanas emergentes ni acceso a BOLD. Solo se monta el visor activo.

BOLD nunca publica, despublica ni amplía permisos automáticamente. Asociar un enlace no publica el original; retirar la asociación no detiene publicación. Publicar puede hacer visible un archivo públicamente, a la organización o a grupos según Google Workspace. Estas políticas las administra Google. Para archivos sin enlace, se muestran instrucciones y asociación manual. Si Google confirma publicación retirada, se conserva la asociación pero no se carga el enlace anterior.

«Reintentar» y «Abrir en Google» están disponibles ante errores. Tras 12 segundos sin evento load aparece un aviso. El evento load solo señala carga del iframe, no demuestra que Google haya mostrado el documento: BOLD no puede inspeccionar contenido ni todos los errores entre dominios.

Cuando la bandera está habilitada, los cambios se guardan explícitamente con «Guardar» o Ctrl+S. Documentos permite editar párrafos y texto en tablas, aplicar formato, insertar tablas e imágenes mediante URL pública HTTPS y navegar pestañas. Hojas permite editar valores y fórmulas, pegar rangos visibles, aplicar formato, ordenar rangos, añadir hojas, filas, columnas y gráficos. Presentaciones permite editar texto, mover y escalar objetos, insertar formas e imágenes, crear y duplicar diapositivas y presentar dentro de BOLD.

Esta versión no reproduce toda la suite de Google: comentarios, sugerencias, historial, diseño avanzado, gráficos en el lienzo, vídeos, transiciones originales y edición de objetos complejos siguen disponibles en Google. Los objetos no compatibles se conservan; no se convierten a texto ni se reemplaza el archivo entero al guardar. Las fórmulas se calculan en Google, no en el navegador.

`GET/POST /api/v2/workspace/files/{id}/editor/` usa tokens individuales cifrados y capacidades `canEdit` de Drive. Docs y Slides exigen una revisión y usan `requiredRevisionId`; una revisión distinta impide guardar. Sheets comprueba la versión de Drive antes de guardar y actualiza solo las celdas elegidas. Sheets no ofrece una precondición de revisión atómica: una edición externa puede ocurrir entre esa comprobación y el guardado. Ante conflictos o fallos, BOLD conserva los borradores en pantalla y no reintenta escrituras automáticamente.

Drive permite listar, buscar, navegar carpetas y unidades compartidas, crear archivos y carpetas, subir archivos de hasta 20 MB, convertir formatos Office, renombrar, destacar, copiar, descargar, compartir con usuarios y mover a papelera o restaurar. El botón «Abrir Drive completo en Google» da acceso a las demás funciones originales.

## Configuración local

Las variables `GOOGLE_WORKSPACE_CLIENT_ID`, `GOOGLE_WORKSPACE_CLIENT_SECRET` y `GOOGLE_WORKSPACE_REDIRECT_URI` se guardan en `backend/.env`, excluido de Git. El cliente OAuth es una aplicación web con callback exacto `http://localhost:8000/api/v2/workspace/oauth/callback/`.

Habilitar Google Drive API, Google Docs API, Google Sheets API y Google Slides API en el proyecto y declarar los scopes `openid`, `email` y `https://www.googleapis.com/auth/drive`. Este scope amplio se necesita para explorar Drive completo. En estado de pruebas, agregar las cuentas que probarán la integración a los usuarios de prueba del proyecto. La aprobación empresarial de la aplicación se administra en Google Workspace; no se obtiene al configurar APIs en Google Cloud.

Se permite conectar cualquier cuenta Google verificada del dominio configurado en `GOOGLE_WORKSPACE_COMPANY_DOMAIN` (`bold.gt` por defecto), aunque su correo sea distinto del usuario BOLD. Las cuentas personales y los subdominios quedan excluidos. Iniciar sesión en BOLD sigue siendo necesario; la conexión pertenece al usuario BOLD que autoriza y no se comparte con otros usuarios.

Los tokens se cifran con el mecanismo existente de BOLD. Producción requiere `AUTH_ENCRYPTION_KEY`, orígenes autorizados y un callback HTTPS propios; no desplegar el cliente local como configuración de producción. Desconectar elimina únicamente la conexión del usuario en BOLD y no elimina archivos ni revoca otras conexiones del proyecto.

## Verificación

Ejecutar `venv/Scripts/python.exe manage.py test boldApp.workspace --keepdb` desde backend y `npm test` / `npm run build` desde frontend/modulos/core.

La prueba de una publicación real requiere aprobación específica sobre los archivos de prueba; no publicar documentos existentes. La prueba real requiere que el usuario entre a BOLD, abra Docs o Drive, conecte su cuenta y acepte el consentimiento Google. Verificar creación de cada tipo, apertura del editor original, carga de un archivo de prueba, permisos de lector y persistencia tras recargar. La revisión visual corresponde al usuario.


## Apertura de Microsoft Office

Word (.docx), Excel (.xlsx) y PowerPoint (.pptx) se abren desde Drive o Docs conservando el ID original. BOLD convierte temporalmente el contenido para usar las APIs de Google; la conversión permanece en la papelera entre operaciones. Al guardar, exporta Office y actualiza el contenido del archivo original, conservando nombre, ubicación y permisos. Abrir en Google también usa el ID del archivo editado.

Los formatos antiguos (.doc/.xls/.ppt) generan una sola copia al formato actual (.docx/.xlsx/.pptx), en la carpeta original. El archivo antiguo se conserva. Una propiedad privada de Drive asocia cuenta Google y archivo antiguo con la conversión: las siguientes aperturas reutilizan esa copia, incluso si cambia el archivo antiguo, para no perder ediciones. Una copia convertida en papelera produce un aviso para restaurarla; no se duplica. Si se elimina definitivamente o pierde su propiedad privada, la asociación deja de estar disponible. Los cambios posteriores se guardan sobre el mismo archivo actual, tanto desde BOLD como desde su botón Abrir en Google.

`POST /api/v2/workspace/files/{id}/open-office/` valida tipo, acceso, permisos de copia y descarga, y límite de 20 MB. `OfficeWorkspace` relaciona usuario BOLD, cuenta Google, original y conversión temporal. El guardado requiere permiso de edición del original y compara su checksum; usa If-Match cuando Google devuelve ETag. Cambios externos detectados producen 409 sin sobrescribirlos. Un bloqueo temporal evita operaciones simultáneas dentro del proceso local; varios procesos requieren caché compartida. Las conversiones fallidas se descartan de la asociación. Las copias creadas por versiones anteriores se conservan para evitar perder ediciones.

La descarga habitual de Drive devuelve el archivo Office original. `editor_export=true` permite descargar PDF desde la conversión temporal o el Office original guardado. Los formatos, fórmulas y objetos avanzados quedan sujetos a la conversión de Google y las capacidades actuales del editor BOLD.

## Conexión común y caché persistente

Drive y Calendario reutilizan el mismo cliente OAuth administrado por el dueño. Los tokens siguen siendo individuales y todos los permisos se solicitan juntos con «Conectar servicios de Google». La configuración, migraciones, verificaciones y límites de caché están documentados en [Google en BOLD](google_calendar.md). El JSON se carga desde Administración → Conectores; las variables del servidor son solo la alternativa inicial.


### Sugerencias de invitados con Gmail

El mismo cliente OAuth solicita `gmail.readonly` junto a los servicios existentes. Habilitar Gmail API en Cloud no concede acceso al buzón: cada usuario debe volver a conectar y autorizar el permiso. La búsqueda usa `/api/v2/calendar/mail-contacts/` y exclusivamente `/users/me/messages`, con el token individual cifrado. Solicita solo los encabezados From, To, Cc y Bcc; no descarga cuerpos, asuntos ni adjuntos y no guarda mensajes. Contactos y Gmail se consultan independientemente para conservar resultados si una fuente falla. Las sugerencias se mantienen únicamente en memoria, por conexión, con caducidad de 60 segundos.

La búsqueda inspecciona hasta cinco mensajes coincidentes y dispone de un presupuesto de ocho segundos para obtener encabezados. Devuelve las direcciones ya disponibles si la respuesta es parcial. Gmail no proporciona un directorio global: una dirección nueva sin mensajes previos se introduce completa para invitarla. Entrega local; no requiere nuevas credenciales.
