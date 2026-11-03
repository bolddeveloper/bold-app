# Fondo de acceso BOLD

Propuesta histórica, sustituida por `../login-v4/`. No está integrada en la app. Las imágenes originales se conservan en `assets/`; los fondos públicos actuales se obtienen de los renders de Hyperframes.

Composición de Hyperframes de 36 segundos: desplazamiento lento y aumento de escala del 3,5 %, con retorno al encuadre inicial. `?theme=dark` previsualiza el tema oscuro. La composición selecciona arte vertical bajo 600 px.

La aplicación reproduce el movimiento equivalente con CSS para evitar cargar un vídeo o GSAP durante el acceso. El fondo cruza entre temas en 420 ms; los colores del formulario cambian en 280 ms. `prefers-reduced-motion` desactiva el movimiento y las transiciones. El formulario permanece independiente y estático.

Imágenes creadas mediante la herramienta integrada ImageGen, optimizadas en WebP en `frontend/modulos/core/public/auth/`. Prompts finales:

- Escritorio claro: «Original premium minimalist LIGHT THEME login background for BOLD, landscape 16:9. Warm ivory white canvas, oversized sculptural BOLD red circular rings cropped at far left and lower right edges, subtle warm gray shadows, delicate paper grain and tiny halftone details. Airy editorial design, quiet clean ivory central 55% reserved for login card. Red #e73535, ivory #f3f2ef, white, tiny charcoal accents. No text, logos, letters, interface, buttons or watermarks.»
- Móvil claro: «Original premium minimalist LIGHT THEME BOLD phone login wallpaper. Portrait 9:19 format. Warm ivory-white paper canvas #f3f2ef, massive sculptural vivid red #e73535 circular rings cropped in upper left top 22% and lower right bottom 20%. Quiet nearly blank ivory middle 55% for a real login form. Soft daylight, delicate gray shadows, very subtle grain and halftone on ring edges. No text, letters, logos, UI, buttons, watermark.»
