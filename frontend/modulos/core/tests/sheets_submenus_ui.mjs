import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import React,{act,useState,useRef,useMemo,useEffect,useCallback} from 'react';
import {jsx,jsxs} from 'react/jsx-runtime';
import {createRoot} from 'react-dom/client';
import {createPortal} from 'react-dom';
import {patchSheetContextMenus} from '../tools/sheets_context_menus.mjs';

const {JSDOM}=await import(pathToFileURL(join(tmpdir(),'bold-ui-check/node_modules/jsdom/lib/api.js')));
const dom=new JSDOM('<div id="root"></div>');
for (const key of ['window','document','HTMLElement']) globalThis[key]=dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const frames=[];
window.requestAnimationFrame=callback=>{frames.push(callback);return frames.length;};
window.cancelAnimationFrame=()=>{};
const original=await readFile(new URL('../node_modules/@univerjs/ui/lib/es/index.js',import.meta.url),'utf8');
const patched=patchSheetContextMenus(original);
assert.equal(patchSheetContextMenus(patched),patched);
const start=patched.indexOf('function ContextMenuMenuItem(props)'),end=patched.indexOf('\nfunction useContextGroupHiddenStates$1',start);
assert.ok(start>=0 && end>start);
const locale={t:value=>value,direction$:'ltr'},menus={getMenuByPositionKey:()=>[{}]};
const dependencies={useState,useRef,useMemo,useEffect,useCallback,jsx,jsxs,createPortal,
  LocaleService:'locale',IMenuManagerService:'menus',useDependency:key=>key==='locale'?locale:menus,
  useObservable:(value,fallback)=>value ?? fallback,isObservable:()=>false,
  clsx:(...values)=>values.filter(Boolean).join(' '),resolveMenuItemActiveState:()=>false,
  isNonSelectableLabel:()=>false,isNonHoverableLabel:()=>false,isRealNum:()=>false,
  CustomLabel:({title})=>jsx('span',{children:title}),MoreIcon:()=>null,
  ContextMenuMenu:()=>jsx('button',{children:'Eliminar fila seleccionada'}),
  contentClassName:'',scrollbarClassName:'',submenuOverlapOffset:2,submenuVisualGap:20,menuViewportPadding:8};
const MenuItem=new Function(...Object.keys(dependencies),patched.slice(start,end)+';return ContextMenuMenuItem;')(...Object.values(dependencies));
const root=createRoot(document.getElementById('root'));
try {
  await act(async()=>root.render(jsx(MenuItem,{menuKey:'delete',menuItem:{id:'delete',type:3,title:'Eliminar'},activeItemIds:[],submenuPortalContainer:document.body,maxMenuHeight:400})));
  const button=document.querySelector('button'),wrapper=button.parentElement;
  await act(async()=>wrapper.dispatchEvent(new window.MouseEvent('mouseover',{bubbles:true,relatedTarget:document.body})));
  await act(async()=>frames.splice(0).forEach(callback=>callback()));
  const submenu=()=>document.querySelector('[data-u-context-menu-submenu]');
  assert.equal(submenu().style.visibility,'visible');
  await act(async()=>button.click());
  assert.equal(submenu().style.visibility,'visible','clicking an open submenu must not leave it hidden');
  await act(async()=>wrapper.dispatchEvent(new window.MouseEvent('mouseover',{bubbles:true,relatedTarget:document.body})));
  assert.equal(submenu().style.visibility,'visible','hovering again must preserve its position');
  assert.match(submenu().textContent,/Eliminar fila seleccionada/);
  function Siblings(){
    const [activeSubmenuKey,onSubmenuActive]=useState(null);
    return jsxs('div',{children:['delete','insert','freeze'].map(key=>jsx(MenuItem,{menuKey:key,menuItem:{id:key,type:3,title:key},activeSubmenuKey,onSubmenuActive,activeItemIds:[],submenuPortalContainer:document.body,maxMenuHeight:400},key))});
  }
  await act(async()=>root.render(jsx(Siblings,{})));
  for (const key of ['delete','insert','freeze','delete','insert']) {
    const trigger=[...document.querySelectorAll('#root button')].find(button=>button.textContent===key);
    await act(async()=>trigger.parentElement.dispatchEvent(new window.MouseEvent('mouseover',{bubbles:true,relatedTarget:document.body})));
    await act(async()=>frames.splice(0).forEach(callback=>callback()));
    assert.equal(document.querySelectorAll('[data-u-context-menu-submenu]').length,1,'rapid switches must replace the previous submenu');
  }
  const lastTrigger=[...document.querySelectorAll('#root button')].find(button=>button.textContent==='insert');
  await act(async()=>{
    lastTrigger.parentElement.dispatchEvent(new window.MouseEvent('mouseout',{bubbles:true,relatedTarget:submenu()}));
    submenu().dispatchEvent(new window.MouseEvent('mouseover',{bubbles:true,relatedTarget:lastTrigger}));
  });
  await act(async()=>new Promise(resolve=>setTimeout(resolve,550)));
  assert.equal(submenu().style.visibility,'visible','moving into the submenu must keep it open');
  console.log('PASS: sibling submenus replace each other and remain open while crossing into their panel');
} finally {await act(async()=>root.unmount());dom.window.close();}
