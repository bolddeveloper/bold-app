import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import React, {act,useCallback,useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import * as model from '../../hojas/sheets_model.js';
const {JSDOM}=await import(pathToFileURL(join(tmpdir(),'bold-ui-check/node_modules/jsdom/lib/api.js')));
const dom=new JSDOM('<div id="root"></div>');
for(const key of ['window','document'])globalThis[key]=dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const source=readFileSync(new URL('../../hojas/use_sheet_file.js',import.meta.url),'utf8').split('\n').filter(line=>!line.startsWith('import ')).join('\n').replace('export function','function');
const initial={id:'file',revision:4,can:{edit:true},calculated_revision:4,document:{sheets:{sheet:{cellData:{1:{1:{v:'original'}}},__bold:{blocks:[{id:'block',rowIds:['row'],startRow:0,columns:[{id:'responsible'}]}]}}}}};
let saved=structuredClone(initial),stored=null,calls=[],failStatus=400,view;
const api={get:async()=>structuredClone(saved),ticket:async()=>({ticket:'test'}),operation:async(id,operation)=>{
  calls.push(structuredClone(operation));
  if(failStatus)throw Object.assign(Error('Responsable inválido'),{status:failStatus});
  saved={...saved,revision:5,document:model.optimistic(saved.document,operation.changes)};
  return structuredClone(saved);
}};
const cache={read:async()=>stored,write:async(account,id,value)=>{stored=structuredClone(value);},remove:async()=>{stored=null;}};
const hooks={useCallback,useEffect,useRef,useState,sheetsApi:api,sheetsCache:cache,api_base_url:'http://localhost:8000',...model,WebSocket:class{close(){}}};
const useSheetFile=new Function(...Object.keys(hooks),source+'\nreturn useSheetFile;')(...Object.values(hooks));
function Harness(){view=useSheetFile('account','file',()=>assert.fail('unexpected access revocation'));return null;}
const root=createRoot(document.getElementById('root'));
const settle=async predicate=>{for(let i=0;i<20;i++){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});if(predicate())return;}assert.fail('save did not settle');};
const edit=(before,after)=>({kind:'cell',sheet:'sheet',block:'block',row:'row',column:'responsible',before:{v:before},after:{v:after}});
try{
  await act(async()=>root.render(React.createElement(Harness)));
  await settle(()=>!!view.file);
  await act(async()=>{await view.queue([edit('original','invalid')]);});
  await settle(()=>!!view.error);
  assert.equal(view.pending()[0].rejected,true);
  const rejectedId=calls[0].id;
  failStatus=0;
  await act(async()=>{await view.queue([edit('invalid','valid')]);});
  await settle(()=>!view.busy);
  assert.equal(view.error,'');
  assert.equal(calls.length,2);
  assert.notEqual(calls[1].id,rejectedId);
  assert.deepEqual(calls[1].changes,[edit('original','valid')]);
  assert.equal(view.file.document.sheets.sheet.cellData[1][1].v,'valid');
  assert.deepEqual(stored.pending,[]);
  failStatus=400;
  await act(async()=>{await view.queue([edit('valid','uncertain')]);});
  await settle(()=>!!view.error);
  const uncertainId=calls.at(-1).id;
  failStatus=503;
  await act(async()=>{await view.retry();});
  assert.equal(view.pending()[0].rejected,undefined);
  await act(async()=>{await view.queue([edit('uncertain','next')]);});
  await settle(()=>calls.length===5);
  assert.equal(calls.at(-1).id,uncertainId,'unknown network outcome must retain its operation identity');
  assert.equal(view.pending().length,2,'uncertain changes must not be replaced');
  console.log('PASS: rejected save repairs and clears error; uncertain network outcomes preserve both operations');
}finally{await act(async()=>root.unmount());dom.window.close();}

