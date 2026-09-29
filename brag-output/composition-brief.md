# Hyperframes Composition Brief: Bold

## Objective
Create a 21-second launch-style brag video for Bold that proves the product through one real workflow: see today's priorities, create and advance a task, and watch project visibility update.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 21 seconds at 30 fps

## Source Material
- Project root: `C:/Users/j_sam/Documents/GitHub/bold-app`
- Primary files read: `frontend/modulos/core/index.html`, `frontend/modulos/core/login_screen.jsx`, `frontend/modulos/core/app_shell.css`, `frontend/modulos/tareas/src/styles.css`, `frontend/modulos/tareas/src/home_module.jsx`, `frontend/modulos/tareas/src/task_app.jsx`, `frontend/modulos/tareas/src/reports_module.jsx`, `frontend/modulos/permisos/permissions_module.jsx`, and `frontend/modulos/core/README.md`
- Product name: Bold
- Tagline / strongest claim: “Todo tu trabajo, en un solo lugar.”
- Key UI or visual moment to recreate: the Bold workspace shell and Inicio widgets flowing into a task creation/move interaction with visible project progress
- Copy that must appear verbatim:
  - “Todo tu trabajo, en un solo lugar.”
  - “Esto es lo más importante para hoy”
  - “Lanzamiento Q4”
  - “Seguridad y acceso”
  - “Trabajo claro. Equipos en movimiento.”
  - “Conoce Bold”

## Creative Direction
- Tone preset: `app-store` refined with `polished`
- Creative direction: quiet premium product film with decisive red accents
- Interpretation: UI-first, generous readable holds, controlled feature pacing, no exaggerated claims, and no motion without a product purpose
- Angle: work fragments become one command center; Bold shows what matters, turns it into accountable work, and exposes the result without leaving the workspace
- Hook: scattered work fragments lock into the Bold wordmark and the product's own promise
- Outro / punchline: “Trabajo claro. Equipos en movimiento.” followed by “Conoce Bold.”
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals or unrelated particles
  - Unrelated visual redesign
  - Real names, emails, hostnames, credentials, or customer data
  - A six-card dashboard grid that reads like a web screenshot rather than a video frame

## Visual Identity
- Background: `#F4F3F1`
- Text: `#2C3038`
- Accent: `#E73535`
- Charcoal: `#3F3F41`
- Surface: `#FFFFFF`
- Muted: `#7B808A`
- Display font: local Inter if available; otherwise Arial/system sans with identical weight hierarchy
- Body font: local Inter if available; otherwise Arial/system sans
- Visual references from the project: charcoal navigation rail, lowercase bold wordmark with red point, warm off-white canvas, red progress/action states, rounded white task and metric surfaces

## Storyboard
Use `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. One place — 3.7s — fragments resolve into the wordmark and “Todo tu trabajo, en un solo lugar.”
2. Today, composed — 4.7s — the authentic Inicio shell and four product widget types assemble
3. Work moves — 7.4s — cursor creates “Preparar presentación de clientes,” moves it to En curso, and progress rises 68%→74%
4. Clarity at every level — 5.2s — project, completion, and security signals resolve into the final Bold lockup and CTA

Rhythm: lock-and-HOLD → assemble-and-breathe → click/move/RESULT → resolve-and-HOLD. The central product action is the energy peak.

## Audio
- Audio role: warm bed with sparse professional accents
- Audio arc: quiet identity opening, modest lift during the task interaction, resolved final logo with a controlled fade
- Music: `happy-beats-business-moves-vol-9-by-ende-dot-app.mp3`
- Music treatment: baseline volume around 0.28–0.32, no narration carve, fade smoothly during 20.2–21.0s
- Music cue guidance: bundled preset `C:/Users/j_sam/.codex/skills/brag/assets/music/cues/happy-beats-business-moves-vol-9-by-ende-dot-app.music-cues.json`; use 3.70s for the first UI reveal, 8.44s for task creation, 12.65s for the progress result, and 17.91s for the logo lock when natural timing permits
- Audio-reactive treatment: subtle; pre-extract music data and let the persistent red point / ambient red presence scale or glow by only a few percent. No waveform or equalizer visual.
- Audio-coupled moments:
  - Scene 1 — fragments lock and red point lands
  - Scene 2 — widget groups assemble on alternating beats, then remain visible
  - Scene 3 — visible cursor click, task card arrival, column transfer, count-up result
  - Scene 4 — signals collapse and final logo locks
- SFX selection guidance: use low-HF-risk precise clicks for interaction, a soft low-risk reveal cue for task landing, and at most one restrained bell/impact on the final logo
- SFX analysis guidance: `C:/Users/j_sam/.codex/skills/brag/assets/sfx/sfx-analysis.md`
- Exact SFX choice: Hyperframes chooses filenames, timestamps, density, and volume based on the implemented motion
- Audio files: copy selected files into `brag-output/composition/assets/`

## Hyperframes Instructions
Use the loaded `hyperframes-core`, `hyperframes-animation`, `hyperframes-creative`, `hyperframes-keyframes`, and `hyperframes-cli` domain guidance. This is the `/brag` workflow: do not enter the generic Hyperframes intent interview or generic promo workflow.

Requirements:
- Build current native Hyperframes HTML; do not use a stale `/brag` template.
- Use one standalone composition with deterministic, paused GSAP animation.
- Show real Bold UI language and interaction, recreated with fictional presentation data.
- Keep all required text readable in the final render.
- Keep root duration exactly 21 seconds.
- Include planned music and restrained SFX.
- Copy every referenced asset inside the composition directory and use relative paths.
- Implement at least one subtle per-frame audio-reactive visual, or document extraction failure.
- Mark major cue locks in code with `// beat-locked` and sequential rhythm with `// beat-grid`.
- Favor transforms and opacity; avoid layout-property animation and transform conflicts.
- Use the catalog findings only where useful: an oversized cursor interaction and an assembled widget grid fit the product. Author locally if registry components are unavailable.
- Run `hyperframes check` as the single pre-render gate and fix all errors before render.
