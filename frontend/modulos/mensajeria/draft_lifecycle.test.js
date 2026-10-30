import test from "node:test";
import assert from "node:assert/strict";
import {permissionDraftAction,cacheDraftAction} from "./draft_lifecycle.js";
test("uncertainty and unchanged-policy recovery suspend keys without deleting a durable draft",()=>{
    assert.equal(permissionDraftAction({uncertain:true,authorizationChanged:false}),"suspend");
    assert.equal(permissionDraftAction({uncertain:false,authorizationChanged:false}),"suspend");
    assert.equal(permissionDraftAction({uncertain:false,authorizationChanged:true}),"purge");
    assert.equal(permissionDraftAction({uncertain:false}),"purge","legacy explicit permission invalidations remain conservative");
});
test("logout suspends draft keys and preserves ciphertext; explicit cache clearing still purges",()=>{
    assert.equal(cacheDraftAction("bold:private-cache-suspend"),"suspend");
    assert.equal(cacheDraftAction("bold:private-cache-clear"),"purge");
});
