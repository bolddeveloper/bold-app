# BOLD Orbit: puntos en movimiento

Petición: sustituir la iluminación parcial que parece dividir el aro por una trama de puntos animados inspirada en el manifiesto de BOLD V10. Se conservan los dos aros laterales, el inferior abajo y la tarjeta de acceso real, sin botón de pausa.

## Dirección
Tono polished. Rojo #e73535, carbón #101112 y marfil #f3f2ef. El fondo se renderiza con Hyperframes; no se incorpora una animación CSS sustitutiva. Sin música, voz, textos ni datos de usuario: es un fondo funcional de acceso.

## Referencia observada
https://lucent-sopapillas-2f2f51.netlify.app/v10/#arriba

El manifiesto usa una trama radial de puntos con máscara difuminada. Su animación alterna desplazamiento de 6 % horizontal y 5 % vertical y escala de 1 a 1,12. Se adapta el contraste para fondo claro y oscuro; no se copia el texto ni el fondo rojo completo.

## Storyboard: bucle de 18 s
- 0–9 s: la trama se desplaza lentamente y se amplía; centro despejado para la tarjeta.
- 9–18 s: la trama regresa suavemente al estado inicial, sin corte ni destello.
- Los aros mantienen sus posiciones y su movimiento mínimo. Se elimina el arco brillante parcial y la variación de iluminación.

## Entrega
Cuatro vídeos H.264 sin audio: claro y oscuro, escritorio 1920×1080 y móvil 864×1872. 24 fps. Poster de su propio render para movimiento reducido y respaldo. Validar y renderizar con Hyperframes, comprobar los extremos del bucle y el movimiento intermedio. La app conserva su reproducción en bucle, pausa al ocultarse y transición entre temas.
