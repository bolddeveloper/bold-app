# Soporte BOLD en Slack

El servicio responde a mensajes nuevos dirigidos a **soportebold**, sin distinguir mayúsculas. Al escribir `@soporte` aparece en las sugerencias como **Asistente IA**. El selector inserta `@soportebold@bold.gt` con el formato de referencias existente; el mensaje publicado muestra `@soportebold`. También reconoce el alias corto `@soportebold` y la forma anterior `@soporte bold`.

Las menciones dentro de código o enlaces no lo activan. Responde como **soportebold · Asistente IA** en el hilo original. No procesa mensajes directos, menciones añadidas al editar ni menciones históricas.

## Cuenta y consumo

Esta implementación ejecuta el cliente oficial `codex exec` con inicio de sesión de **ChatGPT obligatorio**. No usa claves de OpenAI Platform ni cambia automáticamente a facturación API. Utiliza la cuenta conectada a Codex CLI en el equipo que ejecuta el servicio, que puede ser distinta de la cuenta visible en otra ventana de Codex. Comprobarla antes de iniciar.

Cada generación consume el uso del plan y, cuando corresponda, sus créditos disponibles. El consumo de créditos depende de la cuenta, el modelo y el trabajo realizado; los tokens del registro no equivalen directamente a una cantidad fija de créditos ni permiten deducir el saldo. Consultar el uso en la cuenta de ChatGPT/Codex.

Valores iniciales: `gpt-6-luna`, 100 consultas diarias entre todos y 20 por persona. Estos límites cuentan intentos admitidos, incluidos fallos. El cambio de día sigue `TIME_ZONE` del backend. `messaging_support_requests` conserva estado, modelo y tokens de entrada, entrada en caché y salida cuando el cliente comunica un resultado completo. Un cierre o fallo del proveedor puede consumir créditos sin devolver un desglose.

La primera prueba local real registró 7.548 tokens de entrada y 41 de salida. Es un ejemplo observado, no una tarifa ni una cantidad fija por respuesta. La entrada incluye las instrucciones del cliente, además de la pregunta.

La prueba completa de Slack registró 7.565 tokens de entrada y 40 de salida, con respuesta y evento en vivo en 6,62 segundos. Según la [tarifa estándar de Codex consultada el 6 de noviembre de 2026](https://learn.chatgpt.com/docs/pricing), GPT-6 Luna cuesta 2,5 créditos por millón de tokens de entrada sin caché y 12,5 por millón de salida. Ese ejemplo equivale aproximadamente a 0,0194 créditos; cien consultas similares, a 1,94 créditos. Es una estimación con la tarifa publicada, no un cargo confirmado ni una predicción del consumo incluido del plan.

## Activar en este equipo

Requiere Codex CLI con `exec --ignore-user-config`, una sesión autorizada y acceso al modelo. No copiar credenciales a este repositorio ni leer archivos de autenticación desde BOLD.

1. Ejecutar `codex login status`; debe indicar ChatGPT. Si hace falta, usar `codex login`.
2. Configurar en el entorno privado del backend:

   ```dotenv
   BOLD_SUPPORT_ENABLED=true
   BOLD_SUPPORT_MODEL=gpt-6-luna
   BOLD_SUPPORT_DAILY_LIMIT=100
   BOLD_SUPPORT_USER_DAILY_LIMIT=20
   # Solo si codex no está en PATH:
   BOLD_SUPPORT_CODEX_BINARY=
   ```

3. Aplicar migraciones con `python manage.py migrate`.
4. Ejecutar una vez `python manage.py run_support_bot --unit UUID_DEL_DEPARTAMENTO --once`. Prepara la cuenta de servicio `soportebold@bold.gt`, inactiva y con contraseña inutilizable, junto con su identidad y asignación inactivas. No concede permisos ni inicio de sesión. Si ese correo ya pertenece a otra persona, la configuración se detiene sin modificarla.
5. Reiniciar el backend para cargar las variables. En desarrollo (`DEBUG=true`) su servidor ASGI atiende la cola automáticamente desde la primera petición HTTP. No iniciar otro proceso de soporte: compartir el proceso permite recibir eventos en vivo sin Redis.
6. Escribir `@soporte bold ¿Cómo reviso mis tareas?` en un canal con acceso. Revisar su hilo. `--once` permite una pasada de diagnóstico.

El proceso comprueba la cola cada dos segundos. La espera no envía solicitudes al modelo. Solo una consulta admitida genera una llamada. Fuera de desarrollo, el comando sin `--once` atiende la cola en un host autorizado y requiere Redis compartido para los eventos en vivo. No añadir este cliente a un endpoint público ni dar acceso al ejecutable a través del contenido de los mensajes.

## Alcance y protección

- Solo texto y consultas de lectura de BOLD. No dispone de comandos, navegación, imágenes, plugins, conexiones externas ni agentes secundarios. La preparación de SE Ranking se retiró; no requiere autorizar ese servicio.
- El ejecutable y sus argumentos son fijos, sin shell. Se ignora la configuración personal y se usa una carpeta temporal vacía con permisos de solo lectura. La autenticación la conserva el cliente oficial.
- Se envía una instantánea en memoria de hasta 24.000 caracteres: pregunta, hasta 16 mensajes iniciales recientes del canal, el origen y hasta ocho respuestas del hilo, hasta 80 asignaciones activas del directorio público de Mi equipo y hasta 20 tareas publicadas del departamento. Los mensajes se recortan a 700 caracteres; se indica si un listado o un mensaje quedó parcial. No se descargan adjuntos ni se leen mensajes directos, otros canales, documentos o tareas sin compartir.
- Antes de generar y de publicar se comprueban cuenta, asignación, sesión cuando existe, permisos, versión del mensaje, archivo del canal y estado del hilo. Se revalida la instantánea antes de publicar: si se retiró una publicación o cambió su contenido, se descarta la respuesta generada sin repetir la inferencia. El uso ya consumido se conserva en el recibo.
- Una petición tiene un recibo único. Los reenvíos del mismo mensaje y la recuperación de un proceso no duplican inferencias. Si una inferencia se interrumpe, se marca como fallida sin reintento automático para evitar cargos repetidos.
- El servicio no conserva conversaciones de Codex mediante `--ephemeral`. Los mensajes y sus respuestas sí permanecen en BOLD según su almacenamiento habitual.

## Producción

La activación local no despliega ni habilita el bot en Cloudflare u Oracle. La imagen Docker `support` instala el cliente nativo de Codex; el perfil Compose del mismo nombre ejecuta un proceso independiente con PostgreSQL y Redis compartidos. Conserva su sesión en un volumen privado, accesible solo por ese servicio. No se transfieren automáticamente la sesión ni las credenciales de este equipo.

El procedimiento completo está en [MCP y Soporte en Oracle](../deploy/oracle/MCP_SUPPORT.md). Incluye respaldo, migraciones, autorización de la cuenta, `run_support_bot --check`, activación, comprobación de salud y aceptación pública. El chequeo no consume un modelo ni procesa preguntas. La preparación local no certifica disponibilidad ni saldo de la cuenta del servidor.

Referencias: [autenticación de Codex](https://learn.chatgpt.com/docs/auth), [modo no interactivo](https://learn.chatgpt.com/docs/non-interactive-mode), [configuración](https://learn.chatgpt.com/docs/config-file/config-reference).

## Qué preguntar

- `@soportebold Resume lo que se comentó recientemente en este canal.`
- En un hilo: `@soportebold ¿Qué acordamos aquí?`
- `@soportebold ¿Quiénes aparecen en el equipo de Marketing?`
- `@soportebold ¿Qué tareas compartidas hay y quién es responsable?`

Las tareas son publicaciones explícitas de Mi equipo, con el acceso y la participación del publicador revisados en cada lectura. Se usan las publicaciones del departamento del canal; en canales independientes o servidores personales, el departamento activo de quien pregunta. Se incluye título, estado, responsable, fecha límite y persona que comparte; no descripciones ni comentarios. Un enlace o tarjeta de una tarea en Slack no permite copiar sus datos privados. El directorio solo aporta nombres y departamentos activos, sin correos ni datos administrativos.

La lectura del contexto no crea tableros ni cambia datos de negocio. El servicio solo escribe su respuesta, el estado de la consulta y los efectos habituales de un mensaje en BOLD. No interpreta imágenes, audio o archivos compartidos. El contexto parcial no sirve para afirmar totales del equipo. El modelo recibe este contexto para elaborar la respuesta mediante Codex, por lo que sigue consumiendo uso y créditos de la cuenta configurada.
