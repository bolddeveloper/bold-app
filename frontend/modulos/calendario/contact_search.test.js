import {test} from "node:test";
import assert from "node:assert/strict";
import {createContactSearch, mergeContactSuggestions} from "./contact_search.js";
test("failed warmup does not block searching; repeated queries reuse recent results", async () => {
    const calls=[];
    const search=createContactSearch(async q=>{calls.push(q);if(!q)throw Error("Warmup unavailable");return {contacts:[{email:q+"@example.com"}]};});
    const first=await search.search("Pablo",new AbortController().signal);
    assert.deepEqual(await search.search("pablo",new AbortController().signal),first);
    assert.deepEqual(calls,["","pablo"]);
});
test("late cancelled searches cannot populate cached suggestions",async()=>{
    let finish; const calls=[];
    const search=createContactSearch(async q=>{calls.push(q);if(!q)return {};return new Promise(resolve=>finish=resolve);});
    const controller=new AbortController(), pending=search.search("ana",controller.signal);
    await new Promise(resolve=>setImmediate(resolve)); controller.abort();finish({contacts:[{email:"ana@example.com"}]});
    await assert.rejects(pending,{name:"AbortError"});
    const next=search.search("ana",new AbortController().signal);await new Promise(resolve=>setImmediate(resolve));finish({contacts:[]});await next;
    assert.deepEqual(calls,["","ana","ana"]);
});

test("Gmail searches do not wait for or request a People warmup",async()=>{
    const calls=[];
    const search=createContactSearch(async q=>{calls.push(q);return {contacts:[{email:"unknown@example.com",source:"gmail"}]};},{prepare:false});
    const result=await search.search("unknown",new AbortController().signal);
    assert.equal(result.contacts[0].source,"gmail");assert.deepEqual(calls,["unknown"]);
});

test("Contact and Gmail duplicates preserve a known name and include new addresses",()=>{
    const result=mergeContactSuggestions([{email:"ana@example.com",name:"Ana"}],[{email:"ANA@example.com",name:"",source:"gmail"},{email:"nuevo@example.com",name:"Nuevo",source:"gmail"}]);
    assert.equal(result.length,2);assert.equal(result[0].name,"Ana");assert.equal(result[1].source,"gmail");
});
