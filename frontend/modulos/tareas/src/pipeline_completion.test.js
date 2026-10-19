import test from "node:test";
import assert from "node:assert/strict";
import {mkdir,mkdtemp,rm} from "node:fs/promises";
import {fileURLToPath,pathToFileURL} from "node:url";
import {join} from "node:path";
import {build} from "../../core/node_modules/esbuild/lib/main.js";

test("pipeline completion applies the confirmed status before announcing refresh and preserves aggregate completion",async()=>{
    const cache=fileURLToPath(new URL("../../core/node_modules/.cache/",import.meta.url));
    await mkdir(cache,{recursive:true});
    const directory=await mkdtemp(join(cache,"pipeline-completion-"));
    const output=join(directory,"completion.mjs"), order=[];
    const previousWindow=globalThis.window, previousEvent=globalThis.CustomEvent;
    globalThis.window={dispatchEvent:()=>{order.push("refresh");return true;}};
    globalThis.CustomEvent=class extends Event {constructor(type,options){super(type);this.detail=options.detail;}};
    try {
        await build({stdin:{contents:'export {togglePipelineCompletion} from "../../tareas/src/pipelines.jsx";',resolveDir:fileURLToPath(new URL("../../core/shared/",import.meta.url)),loader:"jsx"},outfile:output,bundle:true,platform:"node",format:"esm",packages:"external",jsx:"automatic",loader:{".css":"empty"},plugins:[{name:"pipeline-test",setup(builder){
            builder.onLoad({filter:/http_client\.js$/},()=>({contents:'export const http={request:(...args)=>globalThis.__pipelineRequest(...args)};export const is_using_real_backend=()=>true;',loader:"js"}));
            builder.onLoad({filter:/core_provider\.jsx$/},()=>({contents:'export const useCore=()=>({});',loader:"js"}));
            builder.onLoad({filter:/google_cache\.js$/},()=>({contents:'export const backgroundRefresh=()=>()=>{};',loader:"js"}));
            builder.onLoad({filter:/[/\\]team\.jsx$/},()=>({contents:'export const SharingEye=()=>null;export const TeamSharingContext={};',loader:"js"}));
        }}]});
        const {togglePipelineCompletion}=await import(pathToFileURL(output));
        const stages=[{id:"open",kind:"open"},{id:"done",kind:"completed"}];
        const context={project_managed:true,projects:[{project:"p",stage:"open",pipeline:{id:"pipeline",stages}}]};
        let persisted={status:"s",status_name:"Completada",status_is_final:true}, body;
        globalThis.__pipelineRequest=async(path,options)=>{if(!options)return context;body=options.body;return persisted;};
        const saved=result=>{order.push("saved");assert.equal(result,persisted);};
        await togglePipelineCompletion({id:"t",completed:false},"p",()=>assert.fail("No legacy patch for project pipeline"),saved);
        assert.deepEqual(body,{stage:"done"});
        assert.deepEqual(order,["saved","refresh"]);
        persisted={...persisted,status_is_final:false}; order.length=0;
        await togglePipelineCompletion({id:"t",completed:false},"p",()=>{},result=>assert.equal(result.status_is_final,false));
        globalThis.__pipelineRequest=async(path,options)=>{if(options)throw new Error("Rejected");return context;};
        await assert.rejects(togglePipelineCompletion({id:"t"},"p",()=>{},()=>assert.fail("No success on failed write")),/Rejected/);
        const completion={id:"other-unit-final",isFinal:true};
        globalThis.__pipelineRequest=async()=>({project_managed:false,projects:[],personal:{pipeline:{stages}},completion_status:completion});
        await togglePipelineCompletion({id:"shared",completed:false},null,status=>assert.equal(status,completion));
    } finally {
        globalThis.window=previousWindow;globalThis.CustomEvent=previousEvent;delete globalThis.__pipelineRequest;
        await rm(directory,{recursive:true,force:true});
    }
});
