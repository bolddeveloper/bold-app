import test from "node:test";
import assert from "node:assert/strict";
import {channelMatches, channelColor, invitePeople, personMatches} from "./channel_discovery.js";
import {channelPage, createChannelApi} from "./channel_api.js";

test("discovery matches accents, substrings, reordered words and bounded typos",()=>{
    for(const query of ["diseno","campana","campanas diseno","diseño","disneo","campanas","campañas diseño"])
        assert.ok(channelMatches("Diseño · Campañas",query),query);
    for(const query of ["finanzas","xyz","diq","campanhas urgentes"])assert.equal(channelMatches("Diseño · Campañas",query),false,query);
    assert.ok(channelMatches("General",""));
});
test("people discovery includes name, corporate email and all departments",()=>{
    const person={name:"María Pérez",email:"mperez@bold.gt",departments:[{name:"Diseño"},{name:"IT"}]};
    for(const query of ["maria","perez","mperez@","diseno","it"])assert.ok(personMatches(person,query));
    assert.equal(personMatches(person,"ventas"),false);
});
test("colors use validated channel override, department inheritance and BOLD fallback",()=>{
    assert.equal(channelColor({color:"#123ABC",department:{color:"#287065"}}),"#123ABC");
    assert.equal(channelColor({color:"url(bad)",department:{color:"#287065"}}),"#287065");
    assert.equal(channelColor(null),"#B82146");
});
test("bulk invites are atomic and deduplicated without promoting existing restrictions",()=>{
    const members=[{employee_id:"a",access:"blocked"},{employee_id:"b",access:"read"}];
    const next=invitePeople(members,[{employee_id:"a"},{employee_id:"b"},{employee_id:"c",name:"C"},{employee_id:"c"}]);
    assert.deepEqual(next.map(row=>[row.employee_id,row.access]),[["a","blocked"],["b","read"],["c","write"]]);
    assert.equal(members.length,2);
    assert.throws(()=>invitePeople(members,Array.from({length:199},(_,i)=>({employee_id:String(i)}))),/200/);
    assert.equal(members.length,2);
});
test("search and invitation cursors retain every ACL and query context",async()=>{
    const root="/api/v2/messaging/channels/people/",filters={channel:"abc",department:"it",q:"mar"};
    assert.throws(()=>channelPage(root,root+"?cursor=x&channel=abc&department=other&q=mar",filters));
    assert.throws(()=>channelPage(root,root+"?cursor=x&channel=other&department=it&q=mar",filters));
    const calls=[],api=createChannelApi({request:async path=>{calls.push(path);return {};}});
    await api.people(filters,{},root+"?cursor=x&channel=abc&department=it&q=mar");
    assert.equal(calls[0],root+"?channel=abc&department=it&q=mar&cursor=x");
    await api.list(false,null,{}, {q:"diseno"});assert.equal(calls[1],"/api/v2/messaging/channels/?q=diseno");
});
