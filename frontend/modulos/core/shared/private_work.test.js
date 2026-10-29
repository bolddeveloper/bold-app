import test from "node:test";
import assert from "node:assert/strict";
import {registerPrivateWork,protectPrivateWork} from "./private_work.js";
test("PWA protection waits for pending writes and honors unregister",async()=>{let finish;const remove=registerPrivateWork(()=>new Promise(resolve=>finish=resolve));const result=protectPrivateWork();finish(true);assert.equal(await result,true);remove();assert.equal(await protectPrivateWork(),true);});
test("failure or timeout cannot claim drafts are protected",async()=>{let remove=registerPrivateWork(async()=>false);assert.equal(await protectPrivateWork(),false);remove();remove=registerPrivateWork(()=>new Promise(()=>{}));assert.equal(await protectPrivateWork({timeoutMs:10}),false);remove();remove=registerPrivateWork(()=>{throw Error("quota");});assert.equal(await protectPrivateWork(),false);remove();});
