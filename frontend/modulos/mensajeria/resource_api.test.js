import test from 'node:test';
import assert from 'node:assert/strict';
import {createResourceApi,mediaDownloadName,resourceFilters,resourceHint,resourceHref,resourcePath} from './resource_api.js';
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';

test('resource routes keep exact scope and signed cursor as data, never a remote destination',async()=>{
    const calls=[],client={request:async(...args)=>calls.push(args)},api=createResourceApi(client),signal=new AbortController().signal;
    await api.list('chat',a,{kind:'link',q:'https://bold.gt/test'},'https://evil.invalid/?q=x',{signal});
    const url=new URL(calls[0][0],'https://local.invalid');
    assert.equal(url.pathname,`/api/v2/messaging/conversations/${a}/library/`);
    assert.equal(url.searchParams.get('cursor'),'https://evil.invalid/?q=x');assert.equal(calls[0][1].signal,signal);
    await api.media('channel',a,b,{signal});
    assert.equal(calls[1][0],`/api/v2/messaging/channels/${a}/messages/${b}/media/`);assert.equal(calls[1][1].responseType,'blob');
    for(const action of [()=>resourcePath('page',a),()=>resourcePath('chat','../bad'),()=>resourcePath('chat',a,{scope:'all'}),()=>resourcePath('chat',a,{},'x'.repeat(4097))])assert.throws(action);
});
test('library dates retain local inclusive days and author/thread filters',()=>{
    const result=resourceFilters({from:'2026-10-01',to:'2026-10-02',author:a,parent:b,kind:'audio'});
    assert.equal(new Date(result.after).getDate(),1);assert.equal(new Date(result.before).getDate(),3);assert.equal(result.parent,b);
    assert.throws(()=>resourceFilters({from:'2026-02-30'}));assert.throws(()=>resourceFilters({from:'2026-10-10',to:'2026-10-01'}));
});
test('resource links are HTTP only, credential-free, and never a script or fetch preview',()=>{
    assert.equal(resourceHref('https://bold.gt/help'),'https://bold.gt/help');
    for(const value of ['javascript:alert(1)','data:text/html,hi','https://user:secret@bold.gt','https://bold.gt\\bad','https://bold.gt/\u200bx','https://[bad/'])assert.equal(resourceHref(value),null);
});
test('downloads use safe basenames and the actual sanitized MIME extension',()=>{
    assert.equal(mediaDownloadName({filename:'captura.png',kind:'image',mime_type:'image/webp'}),'captura.webp');
    assert.equal(mediaDownloadName({filename:'../a<bad>.exe',kind:'audio',mime_type:'audio/ogg'}),'abad.ogg');
    assert.throws(()=>mediaDownloadName({filename:'test.html',mime_type:'text/html'}));
});
test('only relevant hints mark the snapshot stale; receipt/reaction/page events do not query',()=>{
    assert.equal(resourceHint('channel',a,{detail:{payload:{channel_id:a,kind:'message.created'}}}),true);
    assert.equal(resourceHint('channel',a,{detail:{payload:{channel_id:b,kind:'message.created'}}}),false);
    for(const kind of ['state.changed','reactions.updated','page.updated'])assert.equal(resourceHint('channel',a,{detail:{payload:{channel_id:a,kind}}}),false);
    assert.equal(resourceHint('chat',a,{detail:{event_type:'messaging.message.updated',payload:{conversation_id:a}}}),true);
    assert.equal(resourceHint('chat',a,{detail:{event_type:'messaging.receipt.updated',payload:{conversation_id:a}}}),false);
});
