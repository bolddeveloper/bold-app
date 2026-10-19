import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const check = env => new Promise((resolve,reject)=>{
  const child = spawn(process.execPath,[fileURLToPath(new URL('./healthcheck.mjs',import.meta.url))],{env:{...process.env,...env},stdio:'pipe'});
  let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  child.once('error',reject);child.once('exit',code=>resolve({code,output}));
});
test('readiness requires a valid token and ready response without exposing credentials',async()=>{
  const token='healthcheck-test-only';let ready=true;
  const server=createServer((req,res)=>{assert.equal(req.url,'/health');const valid=req.headers.authorization===`Bearer ${token}`;res.writeHead(valid?200:403,{'Content-Type':'application/json'});res.end(JSON.stringify({status:ready?'ok':'error'}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const env={PORT:String(server.address().port),SHEETS_ENGINE_TOKEN:token};
  try {
    assert.deepEqual(await check(env),{code:0,output:''});
    assert.deepEqual(await check({...env,SHEETS_ENGINE_TOKEN:'wrong'}),{code:1,output:''});
    ready=false;assert.deepEqual(await check(env),{code:1,output:''});
    assert.deepEqual(await check({...env,SHEETS_ENGINE_TOKEN:''}),{code:1,output:''});
  } finally {await new Promise(resolve=>server.close(resolve));}
});
