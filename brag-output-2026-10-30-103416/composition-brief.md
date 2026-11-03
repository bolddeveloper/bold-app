# Brief Hyperframes: BOLD Orbit

Crear un fondo nuevo para el login BOLD. Referencias de código: `frontend/modulos/core/login_screen.jsx`, `design_v3.css` y el círculo del logotipo. Conservar rojo, marfil, carbón, tarjeta compacta y geometría recta. Sin nombres, correos, pantallas de usuario ni contenido privado.

Dos aros con profundidad y una trama de puntos muy discreta. Movimiento independiente de los aros, luz que respira, centro tranquilo. Crear en HTML/SVG con GSAP controlado por la línea de tiempo pausada de Hyperframes; no copiar el fondo raster anterior ni hacer un simple desplazamiento de esa imagen. Duración 18 s, 24 fps, bucle continuo. Validar antes de renderizar. Render local, un trabajador para limitar RAM.

Cuatro archivos de composición: oscuro/claro y escritorio/móvil. MP4 reales reproducidos por `<video>`; respaldo WebP de su propio render. Movimiento reducido: no cargar vídeo. Pausar cuando la pestaña no está visible. Fundido de tema de 420 ms; conservar el vídeo anterior hasta que el nuevo esté preparado. Si falla la reproducción, mostrar su respaldo.
