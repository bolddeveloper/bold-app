export function createSheetPluginLoader(loaders) {
  const states = new WeakMap();
  return function load(univer, group) {
    let state = states.get(univer);
    if (!state) {
      state = {loaded: new Set(), inflight: new Map(), disposed: false};
      states.set(univer, state);
      univer.onDispose(() => {state.disposed = true;});
    }
    if (state.disposed || state.loaded.has(group) || !loaders[group]) return Promise.resolve();
    if (state.inflight.has(group)) return state.inflight.get(group);
    const pending = Promise.resolve().then(loaders[group]).then(plugins => {
      if (state.disposed) return;
      for (const [Plugin, options] of plugins) univer.registerPlugin(Plugin, options);
      state.loaded.add(group);
    }).finally(() => state.inflight.delete(group));
    state.inflight.set(group, pending);
    return pending;
  };
}

export function patchCasualSheetsLifecycle(source) {
  if (source.includes('var boldSheetPluginLoader =')) return source;
  if (!source.includes('function ensurePlugin(univer, group)')) return source;
  const state = /var loaded =[^\n]*;\r?\nvar inflight =[^\n]*;/;
  const loader = /function ensurePlugin\(univer, group\) \{[^]*?\r?\n\}/;
  if (!state.test(source) || !loader.test(source)) throw Error('Cambió el ciclo de carga de Casual Sheets. Revisa el parche antes de actualizar.');
  // Plugin registrations belong to one engine; pending imports can outlive its React mount.
  return source.replace(state, `var boldSheetPluginLoader = (${createSheetPluginLoader.toString()})(LOADERS);`)
    .replace(loader, 'function ensurePlugin(univer, group) {return boldSheetPluginLoader(univer, group);}')
    .replace(/  if \(loaded\.has\(group\)\) return Promise\.resolve\(\);\r?\n/, '');
}

export function createSheetMount(host) {
  const container = host.ownerDocument.createElement('div');
  Object.assign(container.style, {width: '100%', height: '100%', position: 'relative'});
  host.appendChild(container);
  return container;
}

export function patchCasualSheetsMount(source) {
  if (source.includes('const container = (function createSheetMount')) return source;
  if (!source.includes('const uiOpts = { ...DEFAULT_UI, ...ui, container };')) return source;
  const mount = /const container = hostRef\.current;\r?\n    if \(!container\) return;/;
  const cleanup = 'queueMicrotask(() => toDispose.dispose());';
  if (!mount.test(source) || !source.includes(cleanup)) throw Error('Cambió el montaje de Casual Sheets. Revisa el parche antes de actualizar.');
  // StrictMode reuses the host before deferred disposal; each engine needs its own React root.
  return source.replace(mount, `const host = hostRef.current;\n    if (!host) return;\n    const container = (${createSheetMount.toString()})(host);`)
    .replace(cleanup, `container.remove();\n      ${cleanup}`);
}
