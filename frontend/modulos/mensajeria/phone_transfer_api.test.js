import test from "node:test";
import assert from "node:assert/strict";
import {phoneLink, readPhoneLink, phoneSecret, phoneRequest, takePhoneEntry, watchPhoneEntry} from "./phone_transfer_api.js";

test("QR capability stays in fragment, malformed links are rejected", () => {
    const id="11111111-2222-4333-8444-555555555555", token="A".repeat(43);
    const url = new URL(phoneLink(id,token,"https://bold.invalid"));
    assert.equal(url.search,""); assert.equal(url.pathname,"/");
    assert.deepEqual(readPhoneLink(url.hash),{id,token});
    assert.equal(readPhoneLink("#phone-transfer=bad"),null);
    assert.match(phoneSecret(),/^[0-9a-f]{64}$/);
});
test("mobile capability uses explicit authorization, no cookies, no URL token", async () => {
    const original=globalThis.fetch; let request;
    try {
        globalThis.fetch=async (url,options)=>{request={url,options}; return {ok:true,json:async()=>({approved:true})};};
        await phoneRequest("identity","secret","mobile");
        assert.ok(!request.url.includes("secret"));
        assert.equal(request.options.credentials,"omit"); assert.equal(request.options.cache,"no-store");
        assert.equal(request.options.headers.Authorization,"Bearer secret");
        assert.equal(request.options.referrerPolicy,"no-referrer");
    } finally {globalThis.fetch=original;}
});
test("same-document QR navigation replaces the isolated entry and removes its capability", () => {
    const id="11111111-2222-4333-8444-555555555555", token="A".repeat(43);
    const location={hash:`#phone-transfer=${id}.${token}`,pathname:"/",search:""};
    const history={replaceState:(_,__,url)=>{assert.equal(url,"/#phone-transfer");location.hash="#phone-transfer";}};
    const target=new EventTarget(), entries=[];
    const stop=watchPhoneEntry(entry=>entries.push(entry),target,()=>takePhoneEntry(location,history));
    target.dispatchEvent(new Event("hashchange"));
    assert.deepEqual(entries,[{link:{id,token}}]);
    assert.equal(location.hash,"#phone-transfer");
    location.hash="#phone-transfer=invalid";target.dispatchEvent(new Event("hashchange"));
    assert.deepEqual(entries[1],{link:null});
    stop();target.dispatchEvent(new Event("hashchange"));assert.equal(entries.length,2);
});
