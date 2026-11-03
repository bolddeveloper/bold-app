# BOLD Orbit: referencia de movimiento

La implementación activa del fondo utiliza SVG inline en `frontend/modulos/core/login_background.jsx` y animaciones CSS en `design_v3.css`. No carga MP4 ni WebP. Los gradientes y la trama se dibujan a la resolución del dispositivo; los colores cambian sobre el mismo SVG sin reiniciar la animación. Las posiciones base de los aros permanecen separadas de sus transformaciones animadas.

Las animaciones se pausan al ocultar la pestaña y `prefers-reduced-motion` las desactiva. El fondo conserva los formatos de escritorio y móvil. Esta decisión sustituye la reproducción de vídeo por petición del usuario.

## Archivo histórico: renderizar la referencia

Las instrucciones y cifras siguientes documentan los vídeos anteriores; no son dependencias ni archivos que deba cargar la app. Los renders originales se conservan en sus directorios `brag-output`.

Fondo creado mediante la skill brag y Hyperframes 0.8.90. Sustituye la propuesta anterior de desplazar una imagen con CSS.

`create_compositions.py` genera cuatro proyectos independientes de Hyperframes. Ejecutar desde este directorio:

```powershell
python create_compositions.py
npx hyperframes@0.8.90 check dark
npx hyperframes@0.8.90 render dark --output dark.mp4 --fps 24 --crf 18 --workers 1 --no-browser-gpu --strict
```

Repetir para `light`, `dark-mobile` y `light-mobile`. Copiar los MP4 a `frontend/modulos/core/public/auth/bold-orbit-{variante}-v3.mp4` y extraer el primer fotograma a su WebP correspondiente. El código de la app está en `core/login_background.jsx`.

Para la entrega web se optimiza el render sin cambiar su resolución ni sus 24 fps:

```powershell
ffmpeg -i dark.mp4 -c:v libx264 -preset slow -crf 22 -tune animation -pix_fmt yuv420p -movflags +faststart -an -threads 2 dark-web.mp4
```

El archivo optimizado es el que se copia al directorio público. Se conserva el render original para futuras revisiones.

## Diseño y reproducción

- Escritorio: 1920×1080. Móvil: 864×1872. H.264, YUV420P, 24 fps, 18 segundos, sin audio.
- Los aros se componen en SVG con gradientes; no se utiliza el fondo raster anterior.
- La posición base de cada aro está en un grupo exterior. GSAP anima un grupo interior, evitando sustituir la traslación que mantiene el segundo aro abajo.
- Se elimina el arco brillante parcial que daba sensación de corte. El color de los aros conserva su gradiente continuo, sin animación de iluminación.
- Trama de puntos con máscara radial inspirada en el manifiesto de [BOLD V10](https://lucent-sopapillas-2f2f51.netlify.app/v10/#arriba). La referencia desplaza la trama un 6 % horizontal y 5 % vertical y aumenta su escala un 12 %. La composición adapta ese recorrido a un bucle completo de 18 s, con puntos claros en tema oscuro y grises en tema claro.
- Bucle de ida y vuelta con extremos en reposo. Las transformaciones regresan al estado inicial.
- Verificación de la revisión de puntos: los vídeos mantienen 18 s y 24 fps; diferencia media entre fotogramas extremos del render oscuro optimizado de aproximadamente 1 nivel RGB sobre 255. Reproducción real comprobada en ambos temas y a 390 px sin desbordamiento horizontal.
- La app carga el formato del dispositivo y conserva brevemente el tema anterior durante el cambio. El vídeo reproduce en bucle y sin sonido; el formulario queda separado.
- Sin botón de pausa, por petición expresa del usuario. Se detiene automáticamente al ocultar la pestaña. Movimiento reducido muestra únicamente el WebP, sin descargar vídeo.
- El primer fotograma es una composición completa y sirve de respaldo si no se reproduce el vídeo.

Los planes, briefs y renders iniciales se conservan en `brag-output-2026-10-30-103416/`; la revisión con puntos animados está en `brag-output-2026-10-30-105336/`. No hubo publicación externa ni cambios en Oracle.
