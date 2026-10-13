import test from 'node:test';
import assert from 'node:assert/strict';
import {createSheetPluginLoader, createSheetMount, patchCasualSheetsLifecycle, patchCasualSheetsMount} from '../core/tools/casual_sheets_lifecycle.mjs';

function engine() {
  let disposed = false;
  const callbacks = [], plugins = [];
  return {
    plugins,
    onDispose: callback => callbacks.push(callback),
    dispose() {disposed = true; callbacks.forEach(callback => callback());},
    registerPlugin(plugin) {assert.equal(disposed, false); plugins.push(plugin);}
  };
}

test('reabrir durante una importación no reutiliza el editor cerrado', async () => {
  let finish;
  const imports = new Promise(resolve => {finish = resolve;});
  const load = createSheetPluginLoader({drawing: () => imports});
  const first = engine(), second = engine(), Plugin = class {};
  const before = load(first, 'drawing');
  assert.equal(load(first, 'drawing'), before);
  first.dispose();
  const after = load(second, 'drawing');
  assert.notEqual(after, before);
  finish([[Plugin]]);
  await Promise.all([before, after]);
  assert.deepEqual(first.plugins, []);
  assert.deepEqual(second.plugins, [Plugin]);
  await load(second, 'drawing');
  assert.equal(second.plugins.length, 1);
  const third = engine();
  await load(third, 'drawing');
  assert.deepEqual(third.plugins, [Plugin]);
});

test('una importación fallida permite reintentar sin guardar una promesa rechazada', async () => {
  let attempts = 0;
  const Plugin = class {}, current = engine();
  const load = createSheetPluginLoader({drawing: async () => {
    if (++attempts === 1) throw Error('sin conexión');
    return [[Plugin]];
  }});
  await assert.rejects(load(current, 'drawing'), /sin conexión/);
  await load(current, 'drawing');
  assert.deepEqual(current.plugins, [Plugin]);
});

test('el parche permanece estable al ejecutar postinstall nuevamente', () => {
  const input = 'var loaded = new Set();\nvar inflight = new Map();\nfunction ensurePlugin(univer, group) {\n  if (loaded.has(group)) return Promise.resolve();\n}\nasync function eagerLoadForSnapshot() {}';
  const patched = patchCasualSheetsLifecycle(input);
  assert.match(patched, /boldSheetPluginLoader/);
  assert.doesNotMatch(patched, /var loaded =/);
  assert.equal(patchCasualSheetsLifecycle(patched), patched);
});

test('el cierre diferido del primer motor no desmonta la cuadrícula nueva', async () => {
  const children = new Set(), roots = new Map();
  const host = {
    ownerDocument: {createElement: () => ({style: {}, remove() {children.delete(this);}})},
    appendChild: element => children.add(element)
  };
  const first = createSheetMount(host);
  roots.set(first, 'primer canvas');
  first.remove();
  const disposing = Promise.resolve().then(() => roots.delete(first));
  const second = createSheetMount(host);
  roots.set(second, 'canvas nuevo');
  await disposing;
  assert.deepEqual([...children], [second]);
  assert.equal(roots.get(second), 'canvas nuevo');
  assert.notEqual(first, second);
});

test('postinstall aísla el montaje sin repetir contenedores ni cambiar otros efectos', () => {
  const input = 'const container = hostRef.current;\n    if (!container) return;\nconst uiOpts = { ...DEFAULT_UI, ...ui, container };\nqueueMicrotask(() => toDispose.dispose());\nconst container = hostRef.current;';
  const patched = patchCasualSheetsMount(input);
  assert.match(patched, /function createSheetMount/);
  assert.match(patched, /container.remove\(\)/);
  assert.ok(patched.endsWith('const container = hostRef.current;'));
  assert.equal(patchCasualSheetsMount(patched), patched);
});
