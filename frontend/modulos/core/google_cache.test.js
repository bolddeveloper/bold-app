import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoogleCache, cacheScope, backgroundRefresh, cachedContentChanged, restoreGoogleConnection, clearGoogleCache, googleCache} from './google_cache.js';

// A tiny asynchronous IndexedDB transport exercises persistence, not browser layout.
function storage() {
    const rows = new Map();
    const database = {transaction() {
        const transaction = {objectStore: () => Object.fromEntries(['getAll', 'put', 'delete', 'clear'].map(action => [action, value => {
            const request = {};
            queueMicrotask(() => {
                if (action === 'put') rows.set(value.id, structuredClone(value));
                if (action === 'delete') rows.delete(value);
                if (action === 'clear') rows.clear();
                request.result = action === 'getAll' ? structuredClone([...rows.values()]) : undefined;
                request.onsuccess?.(); transaction.oncomplete?.();
            });
            return request;
        }]))};
        return transaction;
    }};
    return {open() {const request = {}; queueMicrotask(() => {request.result = database; request.onsuccess();}); return request;}};
}

test('visited metadata survives reload, remains isolated, and invalidation affects related queries only', async () => {
    const indexedDB = storage(), first = createGoogleCache({indexedDB});
    await first.put('alice:position1', 'drive:data:folder', {files: [{id: 'one'}], next: 'page2'});
    await first.put('alice:position1', 'calendar:data:week', {events: []});
    const reload = createGoogleCache({indexedDB});
    assert.equal((await reload.get('alice:position1', 'drive:data:folder')).next, 'page2');
    assert.equal(await reload.get('bob:position1', 'drive:data:folder'), null);
    assert.equal(await reload.get('alice:position2', 'drive:data:folder'), null);
    await reload.invalidate('alice:position1', 'drive:data:');
    assert.equal(await reload.get('alice:position1', 'drive:data:folder'), null);
    assert.deepEqual(await reload.get('alice:position1', 'calendar:data:week'), {events: []});
    assert.equal(cacheScope({connected: false, connection_key: 'alice'}, 'role'), '');
});

test('expiry, least-recent eviction, and oversized metadata are bounded', async () => {
    let time = 1;
    const cache = createGoogleCache({indexedDB: null, now: () => time, ttl: 86400000});
    await cache.put('a', 'old', {});
    time += 86400001;
    assert.equal(await cache.get('a', 'old'), null);
    for (let index = 0; index < 100; index++) {time++; await cache.put('a', String(index), {});}
    time++; await cache.get('a', '0'); time++; await cache.put('a', 'new', {});
    assert.deepEqual(await cache.get('a', '0'), {});
    assert.equal(await cache.get('a', '1'), null);
    await cache.put('a', 'huge', 'x'.repeat(10 * 1024 * 1024));
    assert.equal(await cache.get('a', 'huge'), null);
});

test('thumbnail blobs survive reload without expiry and stay isolated by account and file version', async () => {
    const indexedDB = storage();
    const options = {indexedDB, name: 'bold-google-thumbnails', ttl: Infinity, maxBytes: 100};
    await createGoogleCache(options).put('alice', 'thumbnail:file:1', new Blob(['preview'], {type: 'image/jpeg'}));
    const reload = createGoogleCache({...options, now: () => Date.now() + 365 * 86400000});
    const blob = await reload.get('alice', 'thumbnail:file:1');
    assert.equal(await blob.text(), 'preview');
    assert.equal(blob.type, 'image/jpeg');
    assert.equal(await reload.get('alice', 'thumbnail:file:2'), null);
    assert.equal(await reload.get('bob', 'thumbnail:file:1'), null);
    await reload.clear();
    assert.equal(await reload.get('alice', 'thumbnail:file:1'), null);
});

test('thumbnail cache counts blob bytes when evicting old entries', async () => {
    let time = 0;
    const cache = createGoogleCache({indexedDB: null, ttl: Infinity, maxBytes: 5, now: () => ++time});
    await cache.put('alice', 'old', new Blob(['123']));
    await cache.put('alice', 'new', new Blob(['456']));
    assert.equal(await cache.get('alice', 'old'), null);
    assert.equal(await (await cache.get('alice', 'new')).text(), '456');
});

test('IndexedDB failure falls back to memory; clearing blocks queued writes', async () => {
    const cache = createGoogleCache({indexedDB: {open() {throw new Error('blocked');}}});
    await cache.put('a', 'data', {value: 1});
    const copy = await cache.get('a', 'data'); copy.value = 2;
    assert.equal((await cache.get('a', 'data')).value, 1);
    const pending = cache.put('a', 'queued', {}), clear = cache.clear();
    await Promise.all([pending, clear]);
    assert.equal(await cache.get('a', 'queued'), null);
});

test('background refresh observes age, visibility, connection and cleanup', () => {
    let time = 0, count = 0, tick;
    const target = new EventTarget(), document = new EventTarget();
    target.navigator = {onLine: true}; document.visibilityState = 'visible';
    target.setInterval = handler => {tick = handler; return 1;}; target.clearInterval = () => {tick = null;};
    const stop = backgroundRefresh(() => count++, {target, document, now: () => time});
    target.dispatchEvent(new Event('focus')); assert.equal(count, 0);
    time = 30000; target.dispatchEvent(new Event('focus')); assert.equal(count, 1);
    document.visibilityState = 'hidden'; tick(); assert.equal(count, 1);
    document.visibilityState = 'visible'; target.navigator.onLine = false; tick(); assert.equal(count, 1);
    target.navigator.onLine = true; target.dispatchEvent(new Event('online')); assert.equal(count, 2);
    tick(); assert.equal(count, 3); stop();
    target.dispatchEvent(new Event('online')); assert.equal(count, 3);
});


test('metadata persists across reload even after a year', async () => {
    const indexedDB = storage();
    await createGoogleCache({indexedDB, now: () => 1}).put('alice', 'calendar', {events: [{id: 'event'}]});
    const reload = createGoogleCache({indexedDB, now: () => 365 * 86400000});
    assert.deepEqual(await reload.get('alice', 'calendar'), {events: [{id: 'event'}]});
});

test('background notices require changed content, ignore row order, and skip first load', () => {
    assert.equal(cachedContentChanged(null, {events: []}), false);
    assert.equal(cachedContentChanged({events: [{id: 'a'}, {id: 'b'}]}, {events: [{id: 'b'}, {id: 'a'}]}), false);
    assert.equal(cachedContentChanged({events: [{id: 'a', summary: 'old'}]}, {events: [{id: 'a', summary: 'new'}]}), true);
});

test('connection restoration shows cached account first and discards requests after logout', async () => {
    await googleCache.put('alice', 'connection:calendar', {connected: true, connection_key: 'alice'});
    let finish, started;
    const ready = new Promise(resolve => {started = resolve;});
    const published = [];
    const restoring = restoreGoogleConnection('alice', 'calendar', () => {started(); return new Promise(resolve => {finish = resolve;});}, value => published.push(value));
    await ready;
    assert.equal(published[0].connection_key, 'alice');
    clearGoogleCache();
    finish({connected: true, connection_key: 'late'});
    await restoring;
    assert.equal(published.length, 1);
    assert.equal(await googleCache.get('alice', 'connection:calendar'), null);
});


test('ending a session preserves cache for the same account but cancels queued writes', async () => {
    const indexedDB = storage();
    const cache = createGoogleCache({indexedDB});
    await cache.put('alice:role', 'thumbnail', new Blob(['preview']));
    const queued = cache.put('alice:role', 'late', {});
    cache.suspend();
    await queued;
    const loginAgain = createGoogleCache({indexedDB});
    assert.equal(await (await loginAgain.get('alice:role', 'thumbnail')).text(), 'preview');
    assert.equal(await loginAgain.get('alice:role', 'late'), null);
    assert.equal(await loginAgain.get('bob:role', 'thumbnail'), null);
});
