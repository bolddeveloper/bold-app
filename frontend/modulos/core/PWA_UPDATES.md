# Actualizaciones de la PWA

La instalación es un acceso a la aplicación del mismo origen, no una copia que se deba reinstalar en cada despliegue.

## Diagnóstico (9 octubre 2026)

La web devuelve `/sw.js` con `no-cache, no-store, must-revalidate` y HTML con revalidación. El SW anterior usaba un nombre fijo `bold_app_shell_v3`, no cambiaba en cada build y no gestionaba versiones esperando activación. Una ventana abierta seguía ejecutando el JavaScript cargado inicialmente; desplegar no sustituye ese JavaScript en memoria. No se ha inspeccionado cada dispositivo afectado, por lo que esto identifica carencias confirmadas del código, no descarta problemas particulares de conectividad o una instalación desde otro origen.

## Parche

- Vite genera un SW con versión derivada del contenido de los JS/CSS y del propio SW; no depende de recordar cambiar un número ni de definir `VITE_APP_VERSION`.
- Comprueba versiones al iniciar y al retomar foco/conexión, con mínimo de diez minutos entre comprobaciones y revisión periódica cada treinta minutos solo visible y conectado. No consulta APIs ni añade polling rápido.
- Aviso «Actualizar» con confirmación para guardar trabajo. Nunca recarga una ventana abierta sin consentimiento. La primera instalación no recarga.
- Activación explícita `skipWaiting`, toma de control `clients.claim` y recarga tras el cambio de controlador. Si otra pestaña actualiza, esta avisa en lugar de borrar trabajo.
- HTML con revalidación; fallback offline y precarga de JS/CSS versionados. Caché limitada al shell/recursos estáticos, nunca API, WebSocket ni salud. Retiene como máximo una caché anterior de BOLD para pestañas aún abiertas, sin borrar cachés de otros sistemas.

## Publicación y prueba manual

Este parche debe compilarse y publicarse en Cloudflare; Oracle no requiere cambios. No cambiar el dominio/start_url ni desinstalar la PWA. Un cliente que aún ejecuta código anterior puede necesitar cerrar y volver a abrir, o recargar, una vez para recibir el nuevo mecanismo.

1. Instalar/abrir una versión A de la PWA y mantenerla abierta; escribir sin guardar en un formulario.
2. Publicar una versión B con un cambio JS/CSS; confirmar que los bytes/versiones de `/sw.js` difieren.
3. Esperar comprobación o retomar tras diez minutos: aparece el aviso, sin perder el formulario. Cancelar confirmación no recarga.
4. Guardar trabajo, pulsar Actualizar y confirmar: aparece B sin reinstalar. Repetir con dos ventanas; la segunda no se recarga sola.
5. Cerrar/abrir conectado carga HTML vigente; sin conexión puede mostrar la versión disponible offline. Volver a conectar permite buscar la nueva.

Pruebas automatizadas: `npm run test:pwa`, suite frontend y build de producción. La prueba real instalada con dos despliegues/dispositivos sigue siendo necesaria para validar particularidades de cada navegador.
