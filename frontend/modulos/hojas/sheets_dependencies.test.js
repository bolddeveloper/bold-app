import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const core = new URL('../core/package.json', import.meta.url);
const require = createRequire(core);
const {dependencies} = JSON.parse(readFileSync(core, 'utf8'));

test('los paquetes de Univer encuentran sus dependencias obligatorias al abrir la cuadrícula', () => {
  for (const name of Object.keys(dependencies).filter(name => name.startsWith('@univerjs/'))) {
    const manifest = JSON.parse(readFileSync(new URL(`../core/node_modules/${name}/package.json`, import.meta.url), 'utf8'));
    for (const peer of Object.keys(manifest.peerDependencies || {})) {
      if (manifest.peerDependenciesMeta?.[peer]?.optional) continue;
      assert.doesNotThrow(() => require.resolve(peer), `${name} requiere ${peer}`);
    }
  }
});
