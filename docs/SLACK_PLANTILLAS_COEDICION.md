# Plantillas y coedición de páginas — piloto IT

Estado: validación local aprobada; despliegue pendiente. No acredita producción.
Rama: `feature/chat-directo`. Base: `8459c3c1`.

## Entrega solicitada

1. Plantillas iniciales y plantillas compartidas del canal; crear páginas desde
   ellas, guardar una página como plantilla, actualizarla, renombrarla y archivarla.
   Las plantillas heredan el acceso del canal y no conceden acceso a tareas.
2. Coedición real del título y bloques, mezcla de texto simultáneo, presencia y
   selección de los participantes. Sin sobrescritura del documento completo.
3. Reintentos, reconexión, restauración de historial y cambios de autorización
   deben conservar los borradores legítimos y retirar el contenido revocado.
4. Pruebas de convergencia entre Yjs y Python, PostgreSQL concurrente, contratos
   de interfaz y recorrido con dos identidades. Conservar pruebas anteriores.
5. Compilar, commit y despliegue verificado en Oracle y Cloudflare; mantener el
   piloto exclusivamente en IT. Respaldo antes de migrar, sin perder cambios ajenos.
6. Nota de parche en `pendingPilotReleaseNotes`, no en las publicaciones generales.

## Decisiones de implementación

- Yjs ya está fijado en el frontend; pycrdt proporciona el motor compatible en
  el proceso Django existente. Un WebSocket por página abierta, con ticket breve
  de un solo uso, autorización de sesión/asignación/piloto/canal/página.
- Persistencia transaccional en PostgreSQL y eventos en Channels/Redis. No hay
  un servicio de colaboración adicional ni un recurso cloud de pago nuevo.
- El estado compartido no contiene títulos ni identificadores protegidos de
  tareas. Las referencias se conservan separadamente en el servidor y se
  proyectan para cada participante según sus permisos actuales.
- Solo se transmite actividad mientras la página está abierta. Ediciones
  agrupadas y una sola operación en vuelo; presencia acotada, sin sondeo HTTP.
- Restaurar una versión inicia una época nueva de colaboración. Los cambios
  pendientes de una época anterior no pueden resucitar contenido descartado:
  el usuario debe elegir explícitamente si recupera su borrador.
- Mantener instantáneas recuperables sin almacenar una página completa por
  cada pulsación. Los recibos de actualización permiten reintentos idempotentes.

## Puertas pendientes

- [x] Plantillas y permisos configurables implementados y probados.
- [x] Coedición, cursores, reconexión, revocación e historial probados.
- [x] PostgreSQL aislado y recorrido de dos usuarios aprobados.
- [x] Interfaz clara/oscura/móvil y compilación aprobadas.
- [ ] Nota de parche preparada y commit publicado en la rama del piloto.
- [ ] Oracle: respaldo, migración, versión y salud verificados.
- [ ] Cloudflare: versión/assets/salud verificados.
- [ ] IT autorizado; otra unidad denegada, sin abrir el piloto.

## Evidencia local del 22 de octubre

- PostgreSQL 18.6 temporal, puerto independiente: 200 pruebas aprobadas sin
  omitir concurrencia; incluye dos escritores CRDT bajo bloqueo de fila.
- Regresión CRDT: 7 pruebas aprobadas, con Yjs real → Python → Yjs, texto
  Unicode y encabezados numéricos; vectores malformados no alteran la página.
- WebSocket ASGI real: 3 pruebas aprobadas, dos participantes, ticket de un
  solo uso, origen, revocación de canal privado y transferencia fragmentada.
- Frontend: 83 pruebas de mensajería; suite general 393 aprobadas y una
  omisión existente; PWA y Worker, 7 pruebas cada una. DOM de Chat y páginas
  aprobados. Se sustituyeron esperas fijas de coedición por confirmaciones.
- Navegador sobre build de producción: dos cuentas ficticias, edición del
  mismo título y distintos bloques, convergencia idéntica y guardado en ambas;
  captura y reutilización de plantilla por la otra identidad.
- Revisión a 375 px y 720 × 375 sin desbordamiento horizontal, modo claro y
  oscuro, reducción de movimiento. Los campos móviles de plantilla usan 16 px.
- La primera comprobación real detectó niveles de encabezado recibidos como
  números flotantes desde Yjs. Se normalizan únicamente 1, 2 y 3 enteros; se
  conserva la validación estricta del resto y se añadió regresión interoperable.

Los borradores viven en memoria de la sesión, no son almacenamiento offline
durable. Una reconexión del editor conserva los cambios; recargar o retirar el
módulo por revalidación de seguridad puede descartarlos. La revocación debe
purgar el contenido. Cámara física/Drive y aceptación del equipo siguen siendo
comprobaciones independientes; páginas y plantillas no consumen Drive.
