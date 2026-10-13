import test from 'node:test';
import assert from 'node:assert/strict';
import { bindSheetMenus } from './sheet_menus.js';

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
