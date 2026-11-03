import assert from 'node:assert/strict';
import test from 'node:test';
import {orderedServers,moveServer} from './server_order.js';

test('personal server order keeps hidden servers and appends newly accessible ones',()=>{
    const order=['hidden','b','a'],rows=['a','c','b'].map(id=>({id}));
    assert.deepEqual(orderedServers(rows,order).map(row=>row.id),['b','a','c']);
    const moved=moveServer(order,['b','a','c'],'c','b');
    assert.deepEqual(moved,['hidden','c','b','a']);
    assert.deepEqual(orderedServers([...rows,{id:'hidden'}],moved).map(row=>row.id),moved);
    assert.deepEqual(moveServer(moved,['c','b','a'],'c','a',true),['hidden','b','a','c']);
    assert.deepEqual(order,['hidden','b','a']);
});
