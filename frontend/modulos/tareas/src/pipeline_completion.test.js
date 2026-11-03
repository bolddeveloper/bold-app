import test from "node:test";
import assert from "node:assert/strict";
import {mkdir,mkdtemp,rm} from "node:fs/promises";
import {fileURLToPath,pathToFileURL} from "node:url";
import {join} from "node:path";
import {build} from "../../core/node_modules/esbuild/lib/main.js";
import {JSDOM} from "../../core/node_modules/jsdom/lib/api.js";
import React from "../../core/node_modules/react/index.js";
import {createRoot} from "../../core/node_modules/react-dom/client.js";

test("pipeline keeps confirmed completion and shared card drag and keyboard controls",async()=>{
    const cache=fileURLToPath(new URL("../../core/node_modules/.cache/",import.meta.url));
    await mkdir(cache,{recursive:true});
    const directory=await mkdtemp(join(cache,"pipeline-completion-"));
    const output=join(directory,"completion.mjs"), order=[];
    const previousWindow=globalThis.window, previousEvent=globalThis.CustomEvent;
    globalThis.window={dispatchEvent:()=>{order.push("refresh");return true;}};
    globalThis.CustomEvent=class extends Event {constructor(type,options){super(type);this.detail=options.detail;}};
    try {
        await build({stdin:{contents:'export {default as PipelinePanel,togglePipelineCompletion} from "../../tareas/src/pipelines.jsx";',resolveDir:fileURLToPath(new URL("../../core/shared/",import.meta.url)),loader:"jsx"},outfile:output,bundle:true,platform:"node",format:"esm",packages:"external",jsx:"automatic",loader:{".css":"empty"},plugins:[{name:"pipeline-test",setup(builder){
            builder.onLoad({filter:/http_client\.js$/},()=>({contents:'export const http={request:(...args)=>globalThis.__pipelineRequest(...args)};export const is_using_real_backend=()=>true;',loader:"js"}));
            builder.onLoad({filter:/core_provider\.jsx$/},()=>({contents:'export const useCore=()=>({});',loader:"js"}));
            builder.onLoad({filter:/google_cache\.js$/},()=>({contents:'export const backgroundRefresh=()=>()=>{};',loader:"js"}));
            builder.onLoad({filter:/[/\\]team\.jsx$/},()=>({contents:'import {createContext} from "react";export const SharingEye=()=>null;export const TeamSharingContext=createContext(null);',loader:"js"}));
        }}]});
        const {PipelinePanel,togglePipelineCompletion}=await import(pathToFileURL(output));
        const stages=[{id:"open",kind:"open"},{id:"done",kind:"completed"}];
        const context={project_managed:true,projects:[{project:"p",stage:"open",pipeline:{id:"pipeline",stages}}]};
        let persisted={status:"s",status_name:"Completada",status_is_final:true}, body;
        globalThis.__pipelineRequest=async(path,options)=>{if(!options)return context;body=options.body;return persisted;};
        const saved=result=>{order.push("saved");assert.equal(result,persisted);};
        assert.equal(await togglePipelineCompletion({id:"t",completed:false},"p",()=>assert.fail("No legacy patch for project pipeline"),saved),persisted);
        assert.deepEqual(body,{stage:"done"});
        assert.deepEqual(order,["saved","refresh"]);
        persisted={...persisted,status_is_final:false}; order.length=0;
        await togglePipelineCompletion({id:"t",completed:false},"p",()=>{},result=>assert.equal(result.status_is_final,false));
        globalThis.__pipelineRequest=async(path,options)=>{if(options)throw new Error("Rejected");return context;};
        await assert.rejects(togglePipelineCompletion({id:"t"},"p",()=>{},()=>assert.fail("No success on failed write")),/Rejected/);
        const completion={id:"other-unit-final",isFinal:true};
        globalThis.__pipelineRequest=async()=>({project_managed:false,projects:[],personal:{pipeline:{stages}},completion_status:completion});
        await togglePipelineCompletion({id:"shared",completed:false},null,status=>assert.equal(status,completion));
        globalThis.__pipelineRequest=async()=>({project_managed:true,projects:[],can_complete_without_project:true,completion_status:completion});
        await togglePipelineCompletion({id:"assigned-private-project",completed:false},null,status=>assert.equal(status,completion));

        const dom=new JSDOM('<div id="root"></div>',{url:"http://localhost",pretendToBeVisual:true});
        dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
        const globals=["window","document","HTMLElement","Element","navigator","localStorage","CustomEvent"];
        const descriptors=Object.fromEntries(globals.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
        for(const key of globals)Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
        const root=createRoot(document.getElementById("root")), task={id:"card",title:"Tarjeta compartida"};
        const visualStages=[{id:"open",name:"Pendiente",probability:25},{id:"done",name:"Lista",probability:100}];
        const visualPipeline={id:"visual",name:"Flujo",project:null,stages:visualStages};
        let placement="open", lastCard, dragData, moved;
        globalThis.__pipelineRequest=async(path,options)=>{
            if(options?.method==="PUT"){moved=options.body.stage;placement=moved;return {};}
            return path.includes('/board/') ? {pipeline:visualPipeline,tasks:[task],placements:{card:placement}} : {items:[visualPipeline]};
        };
        const settle=()=>new Promise(resolve=>setTimeout(resolve,15));
        const waitFor=async predicate=>{for(let i=0;i<100&&!predicate();i++)await settle();assert.ok(predicate());};
        try {
            root.render(React.createElement(PipelinePanel,{personal:true,renderCard:(row,options)=>{
                lastCard=options;
                return React.createElement('article',{...options.cardProps,key:row.id,'data-stage':options.stage.id},row.title);
            }}));
            await waitFor(()=>document.querySelector('.pipeline_card'));
            let card=document.querySelector('.pipeline_card');
            assert.equal(lastCard.stage.probability,25);assert.equal(lastCard.sharing,true);
            assert.equal(card.draggable,true);assert.equal(card.tabIndex,0);
            assert.equal(card.getAttribute('aria-describedby'),'pipeline_move_hint');
            const drag=new dom.window.Event('dragstart',{bubbles:true});
            Object.defineProperty(drag,'dataTransfer',{value:{setData:(type,value)=>{dragData={type,value};}}});
            card.dispatchEvent(drag);card.dispatchEvent(new dom.window.Event('dragend',{bubbles:true}));
            assert.equal(dragData.type,'application/bold-pipeline');assert.deepEqual(JSON.parse(dragData.value),{pipeline:'visual',task:'card'});
            card.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',altKey:true,bubbles:true}));
            await waitFor(()=>document.querySelector('[data-stage="done"]'));
            assert.equal(moved,'done');assert.equal(lastCard.stage.probability,100);
        } finally {
            root.unmount();await settle();dom.window.close();
            for(const key of globals){if(descriptors[key])Object.defineProperty(globalThis,key,descriptors[key]);else delete globalThis[key];}
        }
    } finally {
        globalThis.window=previousWindow;globalThis.CustomEvent=previousEvent;delete globalThis.__pipelineRequest;
        await rm(directory,{recursive:true,force:true});
    }
});
