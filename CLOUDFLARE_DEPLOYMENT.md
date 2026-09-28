# Cloudflare Pages y Oracle Cloud

El frontend se publica en Cloudflare Pages y el backend se ejecuta en Oracle
Cloud a traves de Cloudflare Tunnel. La configuracion completa, incluyendo la
creacion de la VM, Docker, secretos, migracion de datos, backups y puesta en
marcha, se encuentra en `ORACLE_CLOUD_DEPLOYMENT.md`.

Configuracion resumida de Pages:

```text
Production branch: Setup-CloudFlare-Oracle
Root directory: frontend/modulos/core
Build command: npm ci && npm run build
Build output directory: dist
VITE_USE_REAL_BACKEND: true
VITE_API_BASE_URL: https://api.bold.gt
```

Cuando la migracion quede aprobada y se fusione la rama, cambia la rama de
produccion de Pages a `Develop`.
