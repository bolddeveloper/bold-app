# Chat: piloto interno de IT

Esta entrega habilita pruebas exclusivamente entre personas con una plaza activa
en las unidades autorizadas de IT. No constituye el lanzamiento público del chat.
Las notas de lanzamiento general se prepararán después de la aceptación del equipo.

## Acceso y configuración

`MESSAGING_PILOT_ENABLED=true` es el valor predeterminado, también en local.
`MESSAGING_PILOT_UNIT_IDS` contiene los UUID de las unidades IT autorizadas,
separados por comas. Se configura en el entorno del backend; Compose transmite
ambas variables a backend y worker. Una lista vacía no permite acceso.

La decisión procede del servidor (`chat_enabled` en el directorio de asignaciones).
La plaza activa debe pertenecer al piloto; tener otra plaza de IT no abre Chat
desde un cargo de otro departamento. El propietario no tiene excepción.
El destinatario también debe conservar una plaza activa en IT. Retirarlo del
piloto oculta el historial pero no elimina sus mensajes.

Se aplica la misma restricción a API, preferencias y eventos del WebSocket
compartido. No se crea otro socket ni un sondeo HTTP para cada conversación.

Para desarrollo se pueden consultar los UUID de las unidades locales y añadir
solo las de IT al entorno. El sandbox sintético aislado tiene configuración
independiente; nunca debe utilizarse como configuración de producción.

## Pruebas de aceptación con el equipo

1. Dos personas de IT abren **Chat** o seleccionan el cuerpo de una tarjeta en
   Equipo. El avatar muestra información del perfil, sin abrir la conversación.
2. Enviar, recibir y editar mensajes propios antes de diez minutos. Confirmar que
   otra persona no puede editar el mensaje ni acceder a una conversación ajena.
3. Verificar un anillo para guardado, dos grises para entrega al dispositivo y dos
   rojos para lectura real en la conversación visible y enfocada.
4. Desconectar y reconectar la red; comprobar recuperación y ausencia de duplicados.
5. Probar en otro departamento, con una URL guardada y llamadas directas: Chat debe
   permanecer oculto y el backend debe rechazar el acceso, incluso al propietario.
6. Probar teclado, móvil y ambos temas. En Perfil → Chat, comprobar la preferencia
   de Enter, Mayús+Enter y Ctrl/⌘+Enter.

## Notificaciones

Los eventos siguen siendo el mecanismo principal. La comprobación de recuperación
usa cinco minutos con conexión sana y un minuto sin ella, con jitter para evitar
ráfagas simultáneas. Hay espera progresiva y respeto a Retry-After ante errores.
Las pestañas ocultas no consultan periódicamente; un evento pendiente se recupera
al volver. Los avisos de escritorio expresamente habilitados pueden consultar
ante un evento real en segundo plano.

## Apertura posterior

No cambiar `MESSAGING_PILOT_ENABLED` a `false` sin autorización de lanzamiento.
Ese cambio abre el módulo a otras unidades, no concede lectura a administradores:
cada conversación sigue siendo privada para sus dos participantes.
Antes de abrir, publicar notas verificadas con las tarjetas actuales y completar
la aceptación del equipo. Imágenes, audios y archivos de Drive no forman parte
de este piloto; no anunciarlos como disponibles.
