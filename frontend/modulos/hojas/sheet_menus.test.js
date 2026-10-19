import test from 'node:test';
import assert from 'node:assert/strict';
import { bindSheetMenus, routeSheetDialog, tableBlockRemovalChanges } from './sheet_menus.js';

test('quitar una tabla de bloque elimina el bloque aunque sea importada, sin tocar otras tablas',()=>{
  const metadata={sheets:{sheet:{__bold:{blocks:[{id:'tasks',startRow:37,rowIds:['a','b','c'],columns:[{},{}]},{id:'other',startRow:50,rowIds:['d'],columns:[{}]}]}}}};
  const table={id:'native',range:{startRow:37,endRow:40,startColumn:1,endColumn:2}};
  const snapshot={resources:[{name:'SHEET_TABLE_PLUGIN',data:JSON.stringify({sheet:{tables:[table]}})}]};
  assert.deepEqual(tableBlockRemovalChanges(snapshot,metadata,'native'),[{kind:'block.remove',sheet:'sheet',block:'tasks'}]);
  assert.deepEqual(tableBlockRemovalChanges(snapshot,metadata,'missing'),[]);
  table.range.startRow=60;table.range.endRow=63;
  snapshot.resources[0].data=JSON.stringify({sheet:{tables:[table]}});
  assert.deepEqual(tableBlockRemovalChanges(snapshot,metadata,'native'),[]);
});

test('gráficos y tablas dinámicas abren el diálogo propio desde barra o menú, también con teclado', () => {
  for (const kind of ['insert-chart','insert-pivot']) for (const menu of [false,true]) {
    const api={}, opened=[];
    const button={disabled:false,getAttribute:name=>name==='data-action' ? (menu?null:kind) : `cs-menuitem-${kind}`};
    let prevented=0, stopped=0;
    const event={target:{closest:()=>button},preventDefault(){prevented++;},stopPropagation(){stopped++;}};
    routeSheetDialog({...event,type:'mousedown'},api,value=>opened.push(value));
    assert.deepEqual(opened,[]);
    routeSheetDialog({...event,type:'click',detail:0},api,value=>opened.push(value));
    assert.deepEqual(opened,[{kind,api}]);
    assert.equal(prevented,2);
    assert.equal(stopped,2);
    button.disabled=true;
    routeSheetDialog({...event,type:'click'},api,value=>opened.push(value));
    assert.equal(opened.length,1);
  }
});

test('ambos botones del panel de gráficos abren únicamente el editor propio', () => {
  for (const testId of ['charts-panel-empty-cta','charts-panel-add']) {
    const api={}, opened=[];
    const button={disabled:false,getAttribute:name=>name==='data-testid'?testId:null};
    let prevented=0,stopped=0;
    const event={target:{closest:selector=>{assert.ok(selector.includes(`[data-testid="${testId}"]`));return button;}},preventDefault(){prevented++;},stopPropagation(){stopped++;}};
    routeSheetDialog({...event,type:'mousedown'},api,value=>opened.push(value));
    routeSheetDialog({...event,type:'click',detail:0},api,value=>opened.push(value));
    assert.deepEqual(opened,[{kind:'insert-chart',api}]);
    assert.equal(prevented,2);
    assert.equal(stopped,2);
  }
});

function events() {
  const handlers = new Map();
  return {
    addEventListener(type, handler) {handlers.set(type, handler);},
    removeEventListener(type, handler) {if (handlers.get(type) === handler) handlers.delete(type);},
    emit(type, event) {handlers.get(type)?.(event);},
    handlers
  };
}
function fixture() {
  const view = {...events(), innerWidth: 1200, innerHeight: 800};
  const ownerDocument = {...events(), defaultView: view};
  const root = {...events(), ownerDocument, getBoundingClientRect: () => ({left: 200, right: 1200})};
  const details = (rect, height = 180) => {
    const summary = {getBoundingClientRect: () => rect, focus() {this.focused = true;}};
    const menu = {
      style: {}, offsetWidth: 240, offsetHeight: height, shown: false,
      setAttribute() {}, showPopover() {this.shown = true;}, hidePopover() {this.shown = false;},
      matches: selector => selector === ':popover-open' ? menu.shown : selector.includes('[popover]'),
      contains: target => target === menu || target === button
    };
    const button = {closest: () => button};
    const item = {
      tagName: 'DETAILS', open: true, matches: () => false,
      querySelector: selector => selector === 'summary' ? summary : menu,
      contains: target => [item, summary, menu, button].includes(target)
    };
    menu.parentElement = item;
    return {item, menu, summary, button};
  };
  return {view, ownerDocument, root, details};
}

test('menus stay inside the module and open above bottom tabs', () => {
  const {root, details} = fixture(), cleanup = bindSheetMenus(root);
  const left = details({left: 100, top: 750, bottom: 780});
  root.emit('toggle', {target: left.item});
  assert.equal(left.menu.style.left, '208px');
  assert.equal(left.menu.style.top, '564px');
  const right = details({left: 1190, top: 100, bottom: 130}, 1000);
  root.emit('toggle', {target: right.item});
  assert.equal(left.item.open, false);
  assert.equal(left.menu.shown, false);
  assert.equal(right.menu.style.left, '952px');
  assert.equal(right.menu.style.top, '8px');
  assert.equal(right.menu.style.maxHeight, '784px');
  cleanup();
  assert.equal(right.menu.shown, false);
  assert.equal(root.handlers.size, 0);
});

test('outside clicks, other buttons and Escape close menus without closing on menu content', () => {
  const {root, ownerDocument, details} = fixture(), cleanup = bindSheetMenus(root);
  const current = details({left: 210, top: 100, bottom: 130});
  root.emit('toggle', {target: current.item});
  ownerDocument.emit('pointerdown', {target: current.button});
  assert.equal(current.item.open, true);
  ownerDocument.emit('click', {target: current.button});
  assert.equal(current.item.open, false);
  current.item.open = true;
  root.emit('toggle', {target: current.item});
  ownerDocument.emit('pointerdown', {target: {}});
  assert.equal(current.item.open, false);
  current.item.open = true;
  root.emit('toggle', {target: current.item});
  ownerDocument.emit('click', {target: {}});
  assert.equal(current.item.open, false);
  current.item.open = true;
  root.emit('toggle', {target: current.item});
  ownerDocument.emit('keydown', {key: 'Escape', preventDefault() {}, stopPropagation() {}});
  assert.equal(current.menu.shown, false);
  assert.equal(current.summary.focused, true);
  cleanup();
  assert.equal(ownerDocument.handlers.size, 0);
});
