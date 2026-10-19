import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'vite';
import React, {act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {optimistic} from '../../hojas/sheets_model.js';
const {JSDOM}=await import(pathToFileURL(join(tmpdir(),'bold-ui-check/node_modules/jsdom/lib/api.js')));
const dom=new JSDOM('<div id="root"></div>');
for(const key of ['window','document','HTMLElement'])globalThis[key]=dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
dom.window.HTMLElement.prototype.attachEvent=function(){};
dom.window.HTMLElement.prototype.detachEvent=function(){};
let opened=0;
dom.window.HTMLElement.prototype.showPopover=function(){opened++;};
const server=await createServer({configFile:false,plugins:[{name:'mock-task-inputs',enforce:'pre',transform(source,id){
  if(!id.replaceAll('\\','/').endsWith('/hojas/sheets_visual.jsx'))return;
  return source.split('\n').filter(line=>!line.includes("from '../tareas/") && !line.includes("from 'lucide-react'")).join('\n')+'\nfunction TaskText(){return null;} function CalendarDateField(){return null;} const ChevronDown=()=>null,GripVertical=ChevronDown,Plus=ChevronDown,Settings=ChevronDown,Trash2=ChevronDown,ArrowUp=ChevronDown,ArrowDown=ChevronDown,Search=ChevronDown;';
}}],resolve:{dedupe:['react','react-dom']},optimizeDeps:{noDiscovery:true,entries:[],include:[]},esbuild:{jsx:'automatic'},server:{middlewareMode:true,hmr:false},appType:'custom'});
const initial={sheets:{sheet:{id:'sheet',cellData:{0:{0:{v:'block:block'}},1:{0:{v:'row'},1:{v:''}}},__bold:{blocks:[{id:'block',title:'Tareas',type:'tasks',task:{enabled:false},startRow:0,rowIds:['row'],columns:[{id:'collaborators',name:'Colaboradores',type:'collaborators'}]}]}}}};
const people=[{id:'one',employee:'employee-one',name:'Samuel',email:'one@test',department:'Marketing'},{id:'two',employee:'employee-two',name:'David Urbina',email:'two@test',department:'Operaciones'}];
let changes=[];
const root=createRoot(document.getElementById('root'));
try{
  const {VisualSheet}=await server.ssrLoadModule(`/@fs/${resolve('../hojas/sheets_visual.jsx').replaceAll('\\','/')}`);
  function Harness(){const [data,setData]=useState(initial);return React.createElement('div',{className:'sheets_module'},React.createElement(VisualSheet,{file:{can:{edit:true,assign:true}},sheet:data.sheets.sheet,directory:{people},filters:{},setFilters(){},queue:items=>{changes.push(...items);setData(old=>optimistic(old,items));}}));}
  await act(async()=>root.render(React.createElement(Harness)));
  const control=document.querySelector('.sheets_person_value');
  control.parentElement.getBoundingClientRect=()=>({left:1000,bottom:760});
  await act(async()=>control.click());
  const menu=document.querySelector('.sheets_person_menu');
  assert.equal(menu.getAttribute('popover'),'manual');assert.equal(opened,1);
  assert.equal(menu.style.width,'260px');assert.equal(menu.style.maxHeight,'300px');
  assert.equal(menu.style.left,'756px');assert.equal(menu.style.top,'460px');
  assert.equal(menu.querySelector('.sheets_initials'),null);
  const option=name=>[...menu.querySelectorAll('button')].find(button=>button.textContent.includes(name));
  await act(async()=>option('Samuel').click());
  assert.equal(changes.at(-1).after.v,'one');
  await act(async()=>option('David Urbina').click());
  assert.equal(changes.at(-1).after.v,'one,two');
  assert.equal(document.querySelector('.sheets_person_value').textContent,'Samuel, David Urbina');
  await act(async()=>menu.querySelector('input').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  assert.equal(document.querySelector('.sheets_person_menu'),null);
  console.log('PASS: compact popover stays inside viewport, keeps multi selections and closes with Escape');
}finally{await act(async()=>root.unmount());await server.close();dom.window.close();}
