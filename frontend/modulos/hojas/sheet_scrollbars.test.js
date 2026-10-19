import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {patchSheetScrollbars} from '../core/tools/sheets_scrollbars.mjs';

const installed=readFileSync(new URL('../core/node_modules/@univerjs/engine-render/lib/es/index.js',import.meta.url),'utf8');
const source=patchSheetScrollbars(installed);
const keys={VIEW_MAIN:'viewMain',VIEW_ROW_BOTTOM:'viewRowBottom',VIEW_LEFT_TOP:'viewLeftTop'};
const start=source.indexOf('var ScrollBar = ')+'var ScrollBar = '.length;
const ScrollBar=new Function('Disposable','SHEET_VIEWPORT_KEY',`return ${source.slice(start,source.indexOf('\n};',start)+3)}`)(class {},keys);
const shape=()=>({visible:true,transformByState(state){Object.assign(this,state);},setProps(state){Object.assign(this,state);}});
function scrollbar(sheet=true) {
  return Object.assign(Object.create(ScrollBar.prototype),{
    _viewport:{viewportKey:'viewMain',scrollX:0,scrollY:0,scene:{getViewport:key=>sheet?(key===keys.VIEW_LEFT_TOP?{width:40,height:20}:{}):null,getParent:()=>({width:1000,height:700})}},
    _enableHorizontal:true,_enableVertical:true,_trackThickness:8,_trackBorderThickness:1,
    _hThumbMargin:2,_vThumbMargin:2,_thumbLengthRatio:1,_minThumbSizeH:20,_minThumbSizeV:20,
    horizonScrollTrack:shape(),horizonThumbRect:shape(),verticalScrollTrack:shape(),verticalThumbRect:shape(),placeholderBarRect:shape()
  });
}
test('inmovilizar filas y columnas no mueve ni reduce las barras del lienzo',()=>{
  const bar=scrollbar();
  bar.resize(800,600,2000,5000);
  const geometry=()=>[bar.verticalScrollTrack.left,bar.verticalScrollTrack.height,bar.horizonScrollTrack.top,bar.horizontalTrackWidth];
  const expected=geometry(),range=[bar._contentW-bar._viewportW,bar._contentH-bar._viewportH];
  for (const [width,height] of [[400,100],[5,5],[800,600]]) {
    bar.resize(width,height,width+range[0],height+range[1]);
    assert.deepEqual(geometry(),expected);
    assert.deepEqual([bar._contentW-bar._viewportW,bar._contentH-bar._viewportH],range);
    assert.ok(bar.hasVerticalThumb());
    assert.ok(bar.hasHorizonThumb());
  }
});
test('las barras de otros editores conservan su geometría',()=>{
  const bar=scrollbar(false);bar.resize(800,600,2000,5000);
  assert.equal(bar._viewportW,800);assert.equal(bar._viewportH,600);
});
function method(anchor,name,bindings={}) {
  const offset=source.indexOf(anchor),end=source.indexOf('\n\t}',offset)+3;
  return new Function(...Object.keys(bindings),`return {${source.slice(offset,end)}}.${name}`)(...Object.values(bindings));
}
test('el ratón alcanza la barra incluso encima de una región inmovilizada',()=>{
  const pick=method('pick(coord) {\n        if (this.objectsEvented','pick',{SHEET_VIEWPORT_KEY:keys});
  const thumb={name:'thumb'},scene={objectsEvented:true,getViewport:key=>key===keys.VIEW_MAIN?{pickScrollBar:()=>thumb}:{}};
  assert.equal(pick.call(scene,{x:996,y:25}),thumb);
});
test('el origen de las barras respeta los encabezados y no las líneas de inmovilización',()=>{
  const Transform={create(matrix=[1,0,0,1,0,0]){return {getMatrix:()=>matrix,multiply(other){matrix=other.getMatrix();}};}};
  const transform=method('getScrollBarTransForm() {','getScrollBarTransForm',{Transform,SHEET_VIEWPORT_KEY:keys});
  const viewport={viewportKey:keys.VIEW_MAIN,_left:400,_top:600,_scene:{getViewport:key=>key===keys.VIEW_LEFT_TOP?{width:40,height:20}:{}}};
  assert.deepEqual(transform.call(viewport).getMatrix(),[1,0,0,1,40,20]);
  viewport._scene.getViewport=()=>null;
  assert.deepEqual(transform.call(viewport).getMatrix(),[1,0,0,1,400,600]);
});
test('el parche es repetible y rechaza una versión incompatible del motor',()=>{
  assert.equal(patchSheetScrollbars(source),source);
  assert.throws(()=>patchSheetScrollbars('otro motor'),/Cambió el/);
});
test('los paneles inmovilizados no tapan la barra, incluso sin espacio desplazable visible',()=>{
  const draw=method('_draw(mainCtx, isMaxLayer) {','_draw',{SHEET_VIEWPORT_KEY:keys});
  const calls=[],main={getScrollBarTransForm:()=>({getMatrix:()=>[1,0,0,1,40,20]}),_drawScrollbar:()=>calls.push('scrollbar')};
  const frozen={shouldIntoRender:()=>true,render:()=>calls.push('frozen')};
  const layer={_scene:{getViewports:()=>[frozen],getViewport:key=>key===keys.VIEW_MAIN?main:{}},getObjectsByOrder:()=>[]};
  draw.call(layer,{save(){},transform(){},restore(){}},true);
  assert.deepEqual(calls,['frozen','scrollbar']);
});
