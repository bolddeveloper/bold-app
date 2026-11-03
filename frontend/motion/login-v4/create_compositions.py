"""Build reproducible Hyperframes sources; no account data or raster backgrounds."""
from pathlib import Path

ROOT = Path(__file__).parent
TEMPLATE = '''<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BOLD Orbit · {name}</title>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>html,body{{margin:0;width:{render_w}px;height:{render_h}px;overflow:hidden;background:{bg}}}main,svg{{display:block;width:100%;height:100%}}.orbital{{fill:none;stroke:{ink};stroke-width:1;opacity:.12}}</style></head><body>
<main data-composition-id="main" data-start="0" data-duration="18" data-width="{render_w}" data-height="{render_h}" data-fps="24">
<svg viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<defs>
 <linearGradient id="red" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ff715c"/><stop offset=".32" stop-color="#e73535"/><stop offset=".72" stop-color="#bf202b"/><stop offset="1" stop-color="#740e1d"/></linearGradient>
 <linearGradient id="rim" x1="1" y1="0" x2="0" y2="1"><stop stop-color="#ffb2a0"/><stop offset=".35" stop-color="#f04b45"/><stop offset="1" stop-color="#9a1826"/></linearGradient>
 <radialGradient id="shade"><stop stop-color="{bg}" stop-opacity="0"/><stop offset="1" stop-color="{edge}" stop-opacity=".25"/></radialGradient>
 <pattern id="dots" width="{dot_step}" height="{dot_step}" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="{dot_radius}" fill="{dot_color}"/></pattern>
 <radialGradient id="dotFade"><stop stop-color="#fff"/><stop offset=".55" stop-color="#fff" stop-opacity=".8"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
 <mask id="dotMask"><rect width="{w}" height="{h}" fill="url(#dotFade)"/></mask>
</defs>
<rect width="100%" height="100%" fill="{bg}"/>
<g class="dot_field" mask="url(#dotMask)" opacity="{dot_opacity}"><rect x="-{pad_x}" y="-{pad_y}" width="{field_w}" height="{field_h}" fill="url(#dots)"/></g>
<g transform="translate({ax} {ay})"><g class="orbit_a">
 <circle r="{outer}" fill="none" stroke="{ink}" stroke-width="1" opacity=".12"/>
 <circle cy="16" r="{ar}" fill="none" stroke="#7d1521" stroke-width="{thick}"/>
 <circle r="{ar}" fill="none" stroke="url(#red)" stroke-width="{thick}"/>
 <circle r="{inner}" fill="none" stroke="url(#rim)" stroke-width="2"/>
</g></g>
<g transform="translate({bx} {by})"><g class="orbit_b">
 <circle r="{br}" fill="none" stroke="#801423" stroke-width="{thick}" transform="translate(0 16)"/>
 <circle r="{br}" fill="none" stroke="url(#red)" stroke-width="{thick}"/>
 <circle r="{binner}" fill="none" stroke="url(#rim)" stroke-width="2"/>
 <circle class="orbital" r="{bouter}"/>
</g></g>
<rect width="100%" height="100%" fill="url(#shade)"/>
</svg></main>
<script>
const timeline=gsap.timeline({{paused:true}});
timeline.to('.orbit_a',{{x:14,y:10,rotation:4,scale:1.025,svgOrigin:'0 0',duration:9,ease:'sine.inOut'}},0)
.to('.orbit_a',{{x:0,y:0,rotation:0,scale:1,duration:9,ease:'sine.inOut'}},9)
.to('.orbit_b',{{x:-4,y:-3,rotation:-3,scale:1.015,svgOrigin:'0 0',duration:9,ease:'sine.inOut'}},0)
.to('.orbit_b',{{x:0,y:0,rotation:0,scale:1,duration:9,ease:'sine.inOut'}},9)
.fromTo('.dot_field',{{x:-{dot_x},y:-{dot_y},scale:1,svgOrigin:'{center_x} {center_y}'}},{{x:{dot_x},y:{dot_y},scale:1.12,duration:9,ease:'sine.inOut'}},0)
.to('.dot_field',{{x:-{dot_x},y:-{dot_y},scale:1,duration:9,ease:'sine.inOut'}},9);
window.__timelines={{main:timeline}};
</script></body></html>'''

for mobile in (False, True):
    for dark in (False, True):
        name = f"{'dark' if dark else 'light'}{'-mobile' if mobile else ''}"
        w, h = (432, 936) if mobile else (1280, 720)
        geometry = dict(ax=-15, ay=-45, ar=170, bx=445, by=955, br=205, thick=66) if mobile else dict(ax=-50, ay=140, ar=275, bx=1310, by=680, br=305, thick=100)
        source = TEMPLATE.format(name=name, w=w, h=h, render_w=864 if mobile else 1920, render_h=1872 if mobile else 1080, bg='#101112' if dark else '#f3f2ef', ink='#e8e4de' if dark else '#8b8278', edge='#000' if dark else '#d1c4b6', outer=geometry['ar']+geometry['thick']*.8, inner=geometry['ar']-geometry['thick']/2, binner=geometry['br']-geometry['thick']/2, bouter=geometry['br']+geometry['thick']*.8, dot_step=9 if mobile else 6, dot_radius=1.2 if mobile else .85, dot_color='#dedbd4' if dark else '#59534e', dot_opacity=.24 if dark else .18, pad_x=w*.15, pad_y=h*.15, field_w=w*1.3, field_h=h*1.3, dot_x=w*.03, dot_y=h*.025, center_x=w/2, center_y=h/2, **geometry)
        project = ROOT / name
        project.mkdir(exist_ok=True)
        (project / 'index.html').write_text(source, encoding='utf-8')
        (project / 'hyperframes.json').write_text('{"$schema":"https://hyperframes.heygen.com/schema/hyperframes.json","paths":{"assets":"assets"}}\n',encoding='utf-8')

(ROOT / 'hyperframes.json').write_text('{"$schema":"https://hyperframes.heygen.com/schema/hyperframes.json","paths":{"assets":"assets"}}\n',encoding='utf-8')
