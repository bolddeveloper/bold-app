import test from "node:test";
import assert from "node:assert/strict";
import {lockChannelMedia, unlockRejectedChannelMedia} from "./channel_outbox.js";

test("channel media retry freezes its UUID, file, caption, task and thread", () => {
    const file=new File(["pixels"],"captura.png",{type:"image/png"});
    const draft={id:"stable-id",file,caption:" Contexto ",attempted:false};
    const attempt=lockChannelMedia(draft,{parentId:"thread",taskId:"task"});
    assert.equal(attempt.file,file);
    assert.deepEqual(attempt.attempt,{body:"Contexto",client_id:"stable-id",parent_id:"thread",task_id:"task"});
    assert.equal(lockChannelMedia(attempt,{parentId:"other",taskId:"other"}),attempt);
    assert.equal(draft.attempted,false,"locking does not mutate the original draft");
});

test("validation-only unlock keeps the file and caption while rebuilding rejected context", () => {
    const item={id:"stable-id",file:{},caption:"Contexto"};
    const rejected=unlockRejectedChannelMedia(lockChannelMedia(item,{taskId:"revoked"}));
    assert.equal(rejected.attempted,false);
    assert.equal(rejected.attempt,undefined);
    assert.equal(rejected.file,item.file);
    assert.deepEqual(lockChannelMedia(rejected).attempt,{body:"Contexto",client_id:"stable-id",parent_id:null});
});
