import {createHash} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

if (process.argv.includes('--self-test')) {
    const {default: assert} = await import('node:assert/strict');
    assert.equal(needsInstall('same', 'same', () => '/installed/react.js', ['react']), false);
    assert.equal(needsInstall('new', 'old', () => '/installed/react.js', ['react']), true);
    assert.equal(needsInstall('same', 'same', () => {throw Error('Missing dependency');}, ['react']), true);
    process.exit(0);
}

const root = new URL('../', import.meta.url);
const require = createRequire(new URL('package.json', root));
const manifest = JSON.parse(readFileSync(new URL('package.json', root)));
const lock = readFileSync(new URL('package-lock.json', root));
const fingerprint = createHash('sha256').update(lock).update(process.version)
    .update(readFileSync(new URL('package.json', root))).digest('hex');
const stamp = new URL('node_modules/.bold-dependencies', root);

export function needsInstall(expected, installed, resolve, packages) {
    if (expected !== installed) return true;
    return packages.some(name => {
        try { resolve(name); return false; }
        catch { return true; }
    });
}

if (process.argv.includes('--record')) {
    writeFileSync(stamp, fingerprint);
} else if (needsInstall(fingerprint, existsSync(stamp) ? readFileSync(stamp, 'utf8') : '',
    name => require.resolve(name), Object.keys({...manifest.dependencies, ...manifest.devDependencies}))) {
    console.log('Preparando las dependencias de esta rama…');
    const result = spawnSync(process.execPath, [process.env.npm_execpath, 'ci', '--prefer-offline', '--no-audit', '--no-fund'], {
        cwd: fileURLToPath(root), stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
}
