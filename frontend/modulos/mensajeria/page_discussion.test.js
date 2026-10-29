import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiscussionApi,commentOnlyDenial} from './page_discussion_api.js';
import {commentAttempt,commentDraft,restoreComment,mergeComments} from './page_discussion_model.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

test('comment pagination cannot change page, block, state or thread',async()=>{
    const calls=[],api=createDiscussionApi({request:async(...values)=>calls.push(values)}),root=`/api/v2/messaging/channels/${id(1)}/pages/${id(2)}/discussions/`;
    await api.list(id(1),id(2),'open',id(3),root+`?state=open&block=${id(3)}&cursor=next`);
    assert.equal(calls[0][0],root+`?state=open&block=${id(3)}&cursor=next`);
    assert.throws(()=>api.list(id(1),id(2),'resolved',id(3),root+`?state=open&block=${id(3)}&cursor=next`));
    assert.throws(()=>api.list(id(1),id(2),'open',id(4),root+`?state=open&block=${id(3)}&cursor=next`));
    assert.throws(()=>api.comments(id(1),id(2),id(4),root+`${id(3)}/comments/?cursor=next`));
    assert.throws(()=>api.summary('../other',id(2)));
    await api.resolve(id(1),id(2),id(3),{version:1,resolved:true});assert.equal(calls.at(-1)[1].method,'PUT');
    await api.remove(id(1),id(2),id(3),{version:1});assert.match(calls.at(-1)[0],/delete\/$/);
});

test('recovery freezes target and attempt but never sends automatically',()=>{
    const attempt=commentAttempt('root',id(3),'  Texto seguro  ',null,id(4));
    const capture=commentDraft('Texto seguro',attempt,true,null);
    assert.deepEqual(restoreComment(capture.payload,[],'root',id(3)).attempt,attempt);
    assert.throws(()=>restoreComment(capture.payload,[],'root',id(5)));
    assert.throws(()=>restoreComment(capture.payload,[{}],'root',id(3)));
    assert.equal(commentDraft('',null,false,null),null);
    assert.throws(()=>commentAttempt('edit',id(3),'texto',0,id(4)));
    assert.throws(()=>commentAttempt('reply',id(3),'x'.repeat(4001),null,id(4)));
});

test('comment versions never regress or resurrect a tombstone',()=>{
    const removed={id:id(1),version:3,body:'',deleted_at:'now',created_at:'2026-10-29'};
    const old={...removed,version:1,body:'texto',deleted_at:null};
    assert.deepEqual(mergeComments([removed],[old]),[removed]);
    assert.equal(commentOnlyDenial({status:403,fields:{resource:'page_comments'}}),true);
    assert.equal(commentOnlyDenial({status:403,fields:{detail:'No page access'}}),false);
});
