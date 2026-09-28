# Infraestructura de Oracle

- `compose.oracle.yaml`: backend ASGI, worker, PostgreSQL, Redis y Tunnel.
- `.env.oracle.example`: plantilla sin secretos.
- `backup_postgres.sh`: dump con retencion local configurable.

Sigue `../../ORACLE_CLOUD_DEPLOYMENT.md` desde la raiz del repositorio antes de
ejecutar el Compose. Nunca agregues `.env.oracle` ni la carpeta `backups` a Git.
