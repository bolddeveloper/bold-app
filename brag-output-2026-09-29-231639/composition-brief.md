# Brief de composición Hyperframes: Bold

## Objetivo

Crear un video de 22 segundos que demuestre el flujo actual de Bold mediante Inicio, Proyectos, Bandeja y Sugerencias, con una composición frontal y estable que elimine las deformaciones visuales de la versión anterior.

## Salida

- Proyecto: `brag-output-2026-09-29-231639/composition/`
- Preview: Hyperframes Studio local
- Video final, tras aprobación: `brag-output-2026-09-29-231639/brag.mp4`
- Poster final: `brag-output-2026-09-29-231639/brag.jpg`
- Formato: 1920 × 1080, 30 fps, 22 segundos

## Material del producto

- Navegación: Inicio, Tareas, Bandeja de entrada, Calendario, Sugerencias e Informes.
- Copia real relevante:
  - “Esto es lo más importante para hoy.”
  - “Supervisa los proyectos activos de cada departamento.”
  - “Comparte ideas, problemas y ajustes sin salir de Bold.”
  - “Sugerencia registrada.”
- Los datos demostrativos deben ser ficticios y no identificables.

## Dirección creativa

- Tono: `app-store`, pulido y sobrio.
- UI frontal, recreada con HTML/CSS; no usar screenshots estirados.
- Una sola ventana de aplicación con relación fija y `overflow: hidden`.
- Las transiciones serán cortes suaves, máscaras y desplazamientos 2D.
- Evitar perspectiva, rotación 3D, partículas sin función y cuadrículas demasiado densas.

## Contrato visual

- Fondo principal: `#F4F3F1`
- Carbón: `#3F3F41`
- Rojo: `#E73535`
- Blanco: `#FFFFFF`
- Texto: `#2C3038`
- Muted: `#6B7280`
- Tipografía: Inter/sistema sans
- Bordes: 16–24 px en tarjetas de video; líneas `#E6E3DF`
- Sombras: suaves y amplias, nunca oscuras ni pesadas

## Estructura

Usar `brag-plan.md` como contrato narrativo. Cinco escenas:

1. Marca y promesa, 0.00–3.82 s.
2. Inicio, 3.82–8.74 s.
3. Proyecto y tarea, 8.74–13.11 s.
4. Bandeja y Sugerencias, 13.11–17.47 s.
5. Resultados y cierre de marca, 17.47–22.00 s.

## Movimiento

- Timeline GSAP única, pausada y registrada con el mismo id de la composición.
- Entradas con `power3.out`; transiciones con `expo.inOut`; secundarios con `power2.out`.
- Usar transformaciones uniformes y opacidad; no animar anchura/altura cuando pueda usarse `scaleX`/`scaleY`.
- Cursor sobredimensionado únicamente durante la interacción central.
- Mantener un elemento vivo sutil durante los holds para que la composición no quede congelada.
- Añadir sidecar `index.motion.json` con verificaciones de aparición, orden, permanencia en cuadro y continuidad.

## Audio

- Copiar música y SFX dentro de `composition/assets/`.
- Música vol. 12, volumen base 0.28 y automatización de salida.
- SFX discretos: `interface/click_003.ogg`, `impact/impactSoft_medium_001.ogg` y un acento final breve.
- Extraer datos de audio para una respiración mínima del punto rojo; si la extracción falla, documentarlo y no simular reactividad aleatoria.

## Validación

- Ejecutar `hyperframes lint` durante la primera pasada.
- Ejecutar `hyperframes check --snapshots --at 1.8,6.2,10.8,15.5,19.8,21.4` como gate final previo al preview.
- Revisar visualmente snapshots y corregir cualquier clipping, solapamiento, texto pequeño o panel fuera de cuadro.
- Entregar el preview de Studio y esperar aprobación antes de renderizar.

