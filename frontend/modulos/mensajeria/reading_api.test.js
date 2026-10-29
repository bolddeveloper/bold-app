import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadingApi} from './reading_api.js';
import {historyPath} from './history_api.js';
const id='00000000-0000-4000-8000-000000000001',request='00000000-0000-4000-8000-000000000002';
test('personal reading requests validate source identity and immutable optimistic attempts',async()=>{
    const calls=[],api=createReadingApi({request:async(...args)=>{calls.push(args);return {};}});
    await api.state('chat',id);await api.mark('channel',id,{version:3,client_id:request});await api.clear(id,{version:4,client_id:request});
    assert.match(calls[0][0],/kind=chat&source_id=/);assert.equal(calls[1][1].method,'PUT');
    assert.deepEqual(calls[1][1].body,{kind:'channel',source_id:id,version:3,client_id:request});
    assert.deepEqual(calls[2][1].body,{version:4,client_id:request});
    assert.throws(()=>api.mark('page',id,{version:0,client_id:request}));
    assert.throws(()=>api.clear('../foreign',{version:0,client_id:request}));
    assert.throws(()=>api.mark('chat',id,{version:-1,client_id:request}));
    assert.match(historyPath({marked_unread:true}),/marked_unread=true/);
});
