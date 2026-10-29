import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {showPwaUpdate} from './pwa_notice.js';
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(options={}){
    const dom=new JSDOM('<div id="root"><input aria-label="Draft"><button>Send</button></div>'),page=dom.window.document;
    page.querySelector('input').focus();const calls=[];
    showPwaUpdate(request=>{calls.push(request);return true;},{page,protect:async()=>true,confirm:async()=>true,...options});
    return {dom,page,calls,update:page.querySelector('#bold-pwa-update button'),later:page.querySelector('.pwa_update_later')};
}
test('update notice is in flow before the app, does not steal focus, can be postponed and never installs/reloads automatically',()=>{
    const s=fixture();assert.equal(s.page.body.firstElementChild.id,'bold-pwa-update');assert.equal(s.page.body.children[1].id,'root');
    assert.equal(s.page.activeElement,s.page.querySelector('input'));assert.equal(s.calls.length,0);
    showPwaUpdate(()=>assert.fail('duplicate notice'),{page:s.page});assert.equal(s.page.querySelectorAll('#bold-pwa-update').length,1);
    const css=readFileSync(new URL('./pwa_updates.css',import.meta.url),'utf8');assert.doesNotMatch(css,/position:\s*(fixed|sticky)|z-index|transform:/);assert.match(css,/min-height:\s*44px/);
    s.later.click();assert.equal(s.page.querySelector('#bold-pwa-update'),null);assert.equal(s.page.activeElement,s.page.querySelector('input'));assert.equal(s.calls.length,0);s.dom.window.close();
});
test('update waits for protection, coalesces clicks and only activates after an explicit confirmation',async()=>{
    let complete,asked=0;const s=fixture({protect:()=>new Promise(resolve=>complete=resolve),confirm:async message=>{asked++;assert.match(message,/borradores protegidos/);return true;}});
    s.update.click();s.update.click();assert.ok(s.update.disabled);assert.ok(s.later.disabled);assert.equal(asked,0);assert.equal(s.calls.length,0);
    complete(true);await settle();assert.equal(asked,1);assert.equal(s.calls.length,1);
    s.calls[0].onRetry('reload_not_completed');assert.ok(!s.update.disabled);assert.ok(!s.later.disabled);assert.match(s.page.querySelector('[role="status"]').textContent,/recarga no se completó/);s.dom.window.close();
});
test('cancel, failed protection, timeout reset and thrown preparation retain usable controls and do not force a reload',async()=>{
    let message;const cancel=fixture({protect:async()=>false,confirm:async value=>{message=value;return false;}});
    cancel.update.click();await settle();assert.match(message,/podría perderlos/);assert.equal(cancel.calls.length,0);assert.ok(!cancel.update.disabled);cancel.dom.window.close();
    const error=fixture({protect:async()=>{throw Error('Disk full');}});error.update.click();await settle();assert.equal(error.calls.length,0);assert.ok(!error.update.disabled);assert.match(error.page.querySelector('[role="status"]').textContent,/no se ha forzado/);error.dom.window.close();
    const retry=fixture();retry.update.click();await settle();retry.calls[0].onRetry('activation_timeout');assert.ok(!retry.update.disabled);assert.match(retry.page.querySelector('[role="status"]').textContent,/aún no está lista/);assert.equal(retry.calls.length,1);retry.dom.window.close();
});
