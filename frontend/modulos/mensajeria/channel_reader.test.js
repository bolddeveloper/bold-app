import test from "node:test";
import assert from "node:assert/strict";
import {createChannelReader,visibleChannelBounds} from "./channel_reader.js";
import {mergeChannelDetails} from "./channel_api.js";

test('read visibility intersects the device viewport and every clipping scroll ancestor',()=>{
    const outer={getBoundingClientRect:()=>({top:100,bottom:400}),parentElement:null};
    const inner={getBoundingClientRect:()=>({top:80,bottom:600}),parentElement:outer};
    const host={getBoundingClientRect:()=>({top:50,bottom:700}),parentElement:inner};
    const style=node=>({overflowY:node===inner ? 'auto':'hidden'});
    assert.deepEqual(visibleChannelBounds(host,{height:375,style}),{top:100,bottom:375});
    outer.getBoundingClientRect=()=>({top:-200,bottom:-10});
    const clipped=visibleChannelBounds(host,{height:375,style});assert.ok(clipped.bottom<=clipped.top,'an offscreen root cannot acknowledge its children');
    assert.deepEqual(visibleChannelBounds(host,{height:375,style:()=>({overflowY:'visible'})}),{top:50,bottom:375});
});

test("observed channel reads coalesce monotonically without acknowledging another view",async()=>{
    let release,calls=[],seen=[];
    const reader=createChannelReader({mark:async id=>{calls.push(id);if(calls.length===1)await new Promise(resolve=>release=resolve);return {read_sequence:Number(id)};},onRead:value=>seen.push(value)});
    const work=reader.observe({id:"1",sequence:1});reader.observe({id:"3",sequence:3});reader.observe({id:"2",sequence:2});release();await work;
    assert.deepEqual(calls,["1","3"]);assert.equal(seen.length,2);await reader.observe({id:"2",sequence:2});assert.equal(calls.length,2);reader.dispose();
});

test("channel read retries are activity driven, bounded and aborted on leaving the view",async()=>{
    let calls=0,clock=0,errors=0,signal;
    const reader=createChannelReader({now:()=>clock,mark:async(id,options)=>{calls++;signal=options.signal;throw {status:429,retryAfterMs:120000};},onError:()=>errors++});
    await reader.observe({id:"1",sequence:1});clock=60001;await reader.observe({id:"2",sequence:2});assert.equal(calls,1);
    clock=120001;await reader.observe({id:"2",sequence:2});assert.equal(calls,2);assert.equal(errors,2);reader.dispose();assert.ok(signal.aborted);
});

test("late channel histories cannot undo following, a read acknowledgement or a newer rename",()=>{
    const current={id:"channel",version:2,name:"Nuevo",activity_version:4,state_version:3,following:true,unread_count:0};
    const stale={...current,version:1,name:"Viejo",state_version:2,following:false,unread_count:4};
    assert.deepEqual(mergeChannelDetails(current,stale),current);
    const activity={...current,activity_version:5,unread_count:1};
    assert.equal(mergeChannelDetails(activity,{...current,state_version:4}).unread_count,1,"an older activity snapshot cannot erase a newer arrival");
});
