const timeline = window.__timelines.main;
const clips = [...document.querySelectorAll('.scene')];
const at = (scene, selector) => scene.querySelector(selector);
function point(scene, element) {
  const a = element.getBoundingClientRect(), w = at(scene, '.window').getBoundingClientRect();
  return { x: a.left - w.left + a.width * .55, y: a.top - w.top + a.height * .5 };
}
function move(scene, selector, time, click = true) {
  const element = at(scene, selector), cursor = at(scene, '.cursor'), ring = at(scene, '.ring');
  if (!element || !cursor) return;
  const {x,y} = point(scene, element);
  timeline.to(cursor, {opacity:1,x,y,duration:.5}, time-.5);
  if (click) {
    timeline.to(cursor, {scale:.82,duration:.1,yoyo:true,repeat:1}, time);
    timeline.fromTo(ring,{opacity:.7,scale:.2,x:x-24,y:y-24},{opacity:0,scale:1.2,duration:.4},time);
  }
}
function show(element, time, duration=.4) {
  if (element) timeline.fromTo(element,{opacity:0,y:12},{opacity:1,y:0,duration},time);
}
function hide(element,time) { if(element) timeline.to(element,{opacity:0,duration:.25},time); }
clips.forEach((scene,index) => {
  const start=+scene.dataset.start, duration=+scene.dataset.duration;
  const copy=at(scene,'.copy'), win=at(scene,'.window'), cursor=at(scene,'.cursor');
  if(copy) timeline.fromTo(copy,{opacity:0,x:-28},{opacity:1,x:0,duration:.55},start+.12);
  if(win) timeline.fromTo(win,{opacity:0,y:36},{opacity:1,y:0,duration:.65},start+.18);
  if(!win) return;
  timeline.set(cursor,{opacity:0,x:90,y:550},start);
  if(index===0){
    move(scene,'.login-form .action',2.3);
    show(at(scene,'.login-next'),2.75);
    move(scene,'.login-next .field',4.55);
    show(at(scene,'.role-menu'),4.85);
    move(scene,'.role-option',5.85);
    timeline.set(at(scene,'.role-choice'),{textContent:'Marketing · Equipo de marketing'},6.05);
    hide(at(scene,'.role-menu'),6.05);
  } else if(index===1){
    move(scene,'.add-widget',10.65);
    show(at(scene,'.widget-gallery'),11);
    move(scene,'.gallery-add',12.8);
    move(scene,'.widget-gallery footer',14.5);
    hide(at(scene,'.widget-gallery'),14.7);
    move(scene,'.home-task.action',17.5);
    show(at(scene,'.detail-drawer'),17.85);
  } else if(index===2){
    move(scene,'header .action',25.1);
    show(at(scene,'.editor'),25.45);
    move(scene,'.task-name',26.3,false);
    const name='Enviar propuesta', field=at(scene,'.task-name');
    [...name].forEach((_,i)=>timeline.set(field,{textContent:name.slice(0,i+1)},26.65+i*.11));
    move(scene,'.editor footer .primary',29.3);
    hide(at(scene,'.editor'),29.55);
    show(at(scene,'.task-row.reveal'),29.8);
    show(at(scene,'.task-progress .reveal'),29.8);
    move(scene,'.tour-columns',31.2);
    hide(at(scene,'.table'),31.35);
    show(at(scene,'.tour-board'),31.5);
    timeline.to(at(scene,'.tour-list'),{backgroundColor:'#eef0f3',color:'#637083',duration:.2},31.3);
    timeline.to(at(scene,'.tour-columns'),{backgroundColor:'#e73535',color:'#fff',duration:.2},31.3);
    move(scene,'.board-add-section',33.15);
    show(at(scene,'.board-section-form'),33.45);
    move(scene,'.board-create-section',34.35);
    hide(at(scene,'.board-section-form'),34.55);
    hide(at(scene,'.board-add-section'),34.55);
    show(at(scene,'.board-target'),34.7);
    const board=at(scene,'.tour-board').getBoundingClientRect(), source=at(scene,'.movable-task').getBoundingClientRect(), target=at(scene,'.board-destination').getBoundingClientRect(), ghost=at(scene,'.drag-ghost');
    ghost.style.left=(source.left-board.left)+'px'; ghost.style.top=(source.top-board.top)+'px';
    ghost.style.width=source.width+'px';
    move(scene,'.movable-task',36.05,false);
    timeline.set(ghost,{opacity:1},36.25);
    hide(at(scene,'.movable-task'),36.25);
    timeline.to(ghost,{x:target.left-source.left,y:target.top-source.top,duration:1.15,ease:'power1.inOut'},36.3);
    const dest=at(scene,'.board-destination');
    timeline.to(cursor,{x:point(scene,dest).x,y:point(scene,dest).y,duration:1.15,ease:'power1.inOut'},36.3);
    timeline.set(dest,{innerHTML:'<strong>Enviar propuesta</strong><small>Alta · 06 oct</small>'},37.5);
    timeline.set(at(scene,'.board-count'),{textContent:'1'},37.5);
    hide(ghost,37.5);
  } else if(index===3){
    move(scene,'.project-add',43.2);
    show(at(scene,'.project-editor'),43.55);
    move(scene,'.project-name',45.4,false);
    move(scene,'.project-save',49.3);
    hide(at(scene,'.project-editor'),49.55);
    hide(at(scene,'.project-empty'),49.55);
    show(at(scene,'.project-card'),49.75);
  } else {
    const action=at(scene,'.action');
    if(action) move(scene,'.action',start+Math.min(2.7,duration*.35));
    scene.querySelectorAll('.reveal:not(.more)').forEach((el,n)=>show(el,start+3.15+n*.12));
    scene.querySelectorAll('.reveal.more').forEach((el,n)=>show(el,start+duration*.68+n*.08));
    scene.querySelectorAll('.hide-after,.before').forEach(el=>hide(el,start+duration*.66));
  }
  timeline.to(cursor,{opacity:0,duration:.3},start+duration-.55);
});
timeline.seek(0);
