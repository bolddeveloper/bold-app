import test from "node:test";
import assert from "node:assert/strict";
import {createHistoryApi,historyDates,historyPath,savedError} from "./history_api.js";
const a="00000000-0000-4000-8000-000000000001",b="00000000-0000-4000-8000-000000000002";

test("history search never follows a remote pagination URL and retains every filter",async()=>{
    const calls=[],api=createHistoryApi({request:(...args)=>calls.push(args)});
    await api.search({q:"revisión & plan",kind:"image",channel:a,scope:"slack",archived:true},"signed+cursor/=",{signal:"signal"});
    const url=new URL(calls[0][0],"https://local.invalid");
    assert.equal(url.pathname,"/api/v2/messaging/search/");
    assert.equal(url.searchParams.get("q"),"revisión & plan");
    assert.equal(url.searchParams.get("cursor"),"signed+cursor/=");
    assert.equal(url.searchParams.get("channel"),a);
    assert.equal(calls[0][1].signal,"signal");
    assert.throws(()=>historyPath({resource:"other"}),/desconocido/);
    assert.throws(()=>historyPath({},"x".repeat(4097)),/válida/);
});
test("history context uses exact authenticated source paths and validates identities",async()=>{
    const calls=[],api=createHistoryApi({request:url=>calls.push(url)});
    await api.context({kind:"chat",conversation_id:a,message_id:b});
    await api.context({kind:"channel",channel_id:a,message_id:b});
    await api.context({kind:"page",channel_id:a,page_id:b});
    assert.equal(calls[0],`/api/v2/messaging/conversations/${a}/messages/${b}/context/`);
    assert.equal(calls[1],`/api/v2/messaging/channels/${a}/messages/${b}/context/`);
    assert.equal(calls[2],`/api/v2/messaging/channels/${a}/pages/${b}/`);
    assert.throws(()=>api.context({kind:"chat",conversation_id:"https://external.invalid",message_id:b}));
    assert.throws(()=>api.context({kind:"other"}));
});
test("inclusive local date controls become an exclusive next-day upper boundary",()=>{
    const values=historyDates("2026-10-27","2026-10-27");
    const after=new Date(values.after),before=new Date(values.before);
    assert.equal(after.getDate(),27);assert.equal(after.getHours(),0);
    assert.equal(before.getDate(),28);assert.equal(before.getHours(),0);
    assert.deepEqual(historyDates("",""),{});
    assert.throws(()=>historyDates("2026-02-30",""));
    assert.throws(()=>historyDates("2026-10-28","2026-10-27"));
});

test("personal saved references use only authenticated relative paths and strict source kinds",async()=>{
    const calls=[],api=createHistoryApi({request:(...args)=>calls.push(args)});
    await api.save("chat",b,{signal:"abort"});
    await api.unsave(a);
    assert.equal(calls[0][0],"/api/v2/messaging/saved-items/");
    assert.deepEqual(calls[0][1],{signal:"abort",method:"PUT",body:{kind:"chat",source_id:b}});
    assert.equal(calls[1][0],`/api/v2/messaging/saved-items/${a}/`);
    assert.equal(calls[1][1].method,"DELETE");
    assert.equal(new URL(historyPath({saved:true}),"https://local.invalid").searchParams.get("saved"),"true");
    assert.equal(new URL(historyPath({threads:true}),"https://local.invalid").searchParams.get("threads"),"true");
    assert.throws(()=>api.save("task",b));
    assert.throws(()=>api.unsave("https://remote.invalid"));
    assert.match(savedError({status:429}),/no está confirmado/);
    assert.doesNotMatch(savedError({status:0}),/filtros|búsqueda/);
});
