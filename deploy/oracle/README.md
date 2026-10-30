# Infraestructura de Oracle

- `compose.oracle.yaml`: backend ASGI, worker, motor privado de Sheets, PostgreSQL, Redis y Tunnel.
- `.env.oracle.example`: plantilla sin secretos.
- `backup_postgres.sh`: dump con retencion local configurable.

Sigue `../../ORACLE_CLOUD_DEPLOYMENT.md` desde la raiz del repositorio antes de
ejecutar el Compose. Nunca agregues `.env.oracle` ni la carpeta `backups` a Git.

Preparación de Sheets y comprobaciones antes de publicar: [SHEETS.md](SHEETS.md).

## Notificaciones con la PWA cerrada

La implementación Web Push necesita aplicar `boldApp_notificaciones.0003_web_push`
y configurar las cuatro variables `WEB_PUSH_*` de la plantilla. El ancla de
entorno de Compose las entrega tanto al backend como al worker. Se conserva
`WEB_PUSH_ENABLED=false` por defecto: añadir código o notas no activa la entrega.

Genera una sola pareja VAPID persistente desde un entorno con las dependencias
del backend, indicando un archivo nuevo en una carpeta privada fuera de Git:

```bash
python backend/manage.py generate_web_push_keys --output /ruta/privada/web-push.env
```

El comando no imprime ni sobrescribe claves. En Linux crea el archivo con modo
600; en otros sistemas hay que proteger también los permisos de la carpeta.
Incorpora sus cuatro valores al archivo privado `.env.oracle` sin mostrarlos en
consola, chats o notas de parche. No generes una pareja distinta en cada deploy:
cambiarla obliga a renovar las suscripciones de los dispositivos existentes.

Tras aplicar la migración y recrear backend/worker, cada empleado debe conceder
permiso en **Perfil → Notificaciones**, activar el dispositivo y guardar la
preferencia de avisos del sistema. Verifica una entrega real con la ventana
oculta y después cerrada, así como el cese tras cerrar sesión. La activación
no cambia el piloto de Chat/Slack ni el acceso a conversaciones privadas.

Los proveedores reciben un aviso cifrado con identificadores. El worker de la
PWA consulta la sesión y los permisos antes de mostrar un texto general. Las
entregas caducan a los cinco minutos, tienen hasta tres intentos y se recuperan
mediante la cola y Beat, sin sondeo del navegador cada pocos segundos. El sonido
con la PWA cerrada depende del sistema; el audio personalizado se reproduce
dentro de BOLD. iPhone/iPad necesitan la instalación en la pantalla de inicio.
