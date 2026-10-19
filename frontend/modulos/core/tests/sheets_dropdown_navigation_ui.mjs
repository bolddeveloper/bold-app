import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import React,{act,useState,useRef,useEffect} from 'react';
import {jsx,jsxs} from 'react/jsx-runtime';
import {createRoot} from 'react-dom/client';
import {patchCasualSheetsChrome} from '../tools/casual_sheets_chrome.mjs';
import {patchSheetDateRendering,patchSheetDateValidator,patchSheetDropdownState} from '../tools/sheets_date_selectors.mjs';
const {JSDOM}=await import(pathToFileURL(join(tmpdir(),'bold-ui-check/node_modules/jsdom/lib/api.js')));
const dom=new JSDOM('<div id="root"></div>');
for(const key of ['window','document','HTMLElement'])globalThis[key]=dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const chrome=patchCasualSheetsChrome(await readFile(new URL('../node_modules/@casualoffice/sheets/dist/chrome.js',import.meta.url),'utf8'));
assert.equal(patchCasualSheetsChrome(chrome),chrome);
const style=chrome.slice(chrome.indexOf('var SUBMENU_PANEL_STYLE ='),chrome.indexOf('function MenuBar('));
const panelStyle=new Function(style+';return SUBMENU_PANEL_STYLE;')();assert.equal(panelStyle.marginLeft,-1);
const menuSource=chrome.slice(chrome.indexOf('function MenuBar('),chrome.indexOf('// src/chrome/SheetTabs.tsx'));
const dependencies={useState22:useState,useRef7:useRef,useEffect10:useEffect,jsx24:jsx,jsxs23:jsxs,useDialogs:()=>({canOpen:()=>true}),ensureChromeFonts(){},computeVisibleMenus:menus=>menus,
  MENUS:[{id:'format',label:'Formato',items:['borders','numbers'].map(id=>({id,label:id,kind:'submenu',items:[{id:id+'-option',label:id+' option'}]}))}],
  BAR_STYLE4:{},MENU_BTN_STYLE:{},DROPDOWN_STYLE:{},ITEM_STYLE3:{},SUBMENU_PANEL_STYLE:panelStyle,Icon:()=>null};
const MenuBar=new Function(...Object.keys(dependencies),menuSource+';return MenuBar;')(...Object.values(dependencies));
const dropdownSource=patchSheetDropdownState(await readFile(new URL('../node_modules/@univerjs/sheets-ui/lib/es/index.js',import.meta.url),'utf8'));
assert.equal(patchSheetDropdownState(dropdownSource),dropdownSource);
const listSource=dropdownSource.slice(dropdownSource.indexOf('function ListDropDown(props)'),dropdownSource.indexOf('ListDropDown.componentKey'));
const listDependencies={useState,useEffect,jsx,useDependency:()=>({t:key=>key}),LocaleService:'locale',getListDropdownValue:value=>value?[value]:[],serializeListOptions:JSON.stringify,SelectList:props=>jsx('output',{'data-testid':'selected',children:props.value.join(',')})};
const List=new Function(...Object.keys(listDependencies),listSource+';return ListDropDown;')(...Object.values(listDependencies));
const dateSource=patchSheetDateRendering(await readFile(new URL('../node_modules/@univerjs/sheets-data-validation-ui/lib/es/index.js',import.meta.url),'utf8'));
assert.equal(patchSheetDateRendering(dateSource),dateSource);
const dateCore=patchSheetDateValidator(await readFile(new URL('../node_modules/@univerjs/sheets-data-validation/lib/es/index.js',import.meta.url),'utf8'));
assert.equal(patchSheetDateValidator(dateCore),dateCore);
const valueExpression=dateSource.match(/const valueStr = (rule.type === DataValidationType.DATE[^\n]+);/)[1];
const formatDate=new Function('rule','value','DataValidationType','return '+valueExpression);
assert.equal(formatDate({type:'date'},46318,{DATE:'date'}),'2026-10-23');
assert.equal(formatDate({type:'date'},'',{DATE:'date'}),'');
const root=createRoot(document.getElementById('root'));
try{
  await act(async()=>root.render(jsx(MenuBar,{api:{}})));
  await act(async()=>document.querySelector('[data-testid="cs-menu-format"]').dispatchEvent(new window.MouseEvent('mousedown',{bubbles:true})));
  const parent=id=>document.querySelector(`[data-testid="cs-menuitem-${id}"]`);
  await act(async()=>parent('borders').click());assert.equal(parent('borders').getAttribute('aria-expanded'),'true');
  const submenu=document.querySelector('[aria-label="borders"]');
  await act(async()=>parent('borders').dispatchEvent(new window.MouseEvent('mouseout',{bubbles:true,relatedTarget:submenu})));
  assert.ok(document.querySelector('[aria-label="borders"]'),'moving into a child panel must keep it open');
  await act(async()=>parent('numbers').dispatchEvent(new window.MouseEvent('mouseover',{bubbles:true,relatedTarget:document.body})));
  assert.equal(document.querySelector('[aria-label="borders"]'),null);assert.ok(document.querySelector('[aria-label="numbers"]'));
  const renderList=async(value,row)=>act(async()=>root.render(jsx(List,{popup:{extraProps:{location:{unitId:'book',subUnitId:'sheet',worksheet:{},row,col:1},defaultValue:value,options:[]}}})));
  for(const [value,row] of [['Samuel',1],['David Urbina',2],['Paulus',3],['Samuel',1]]){await renderList(value,row);assert.equal(document.querySelector('output').textContent,value);}
  console.log('PASS: toolbar submenus stay reachable; dropdown selection follows each cell; date capsules format Excel serials');
}finally{await act(async()=>root.unmount());dom.window.close();}
