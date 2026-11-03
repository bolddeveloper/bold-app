import test from "node:test";
import assert from "node:assert/strict";
import {cardProgress,dailyProgress,localDay,weekDays,readTaskDay,writeTaskDay} from "./task_progress.js";

test("daily progress uses due dates, authorized participation and unique root tasks",()=>{
    const dates=weekDays(new Date(2026,9,30));
    assert.equal(localDay(dates[0]),"2026-10-26");
    const task={id:"a",due_date:"2026-10-30",assignee_id:"me",completed:true};
    const rows=dailyProgress([task,task,{...task,id:"b",completed:false},{...task,id:"child",parentTaskId:"a"},{...task,id:"other",assignee_id:"other"}],"me",dates);
    assert.deepEqual(rows[4],{date:"2026-10-30",total:2,completed:1,percent:50});
    assert.equal(rows[0].percent,null);
});
test("pipeline percentage respects project context and never averages multiple flows",()=>{
    const task={pipeline_progress:[{project:"a",label:"Revisión",percent:75},{project:"b",label:"Inicio",percent:25}],subtasks:[{completed:true}]};
    assert.equal(cardProgress(task).label,"Varios flujos");
    assert.equal(cardProgress({...task,pipelineContext:"a"}).percent,75);
    assert.equal(cardProgress({...task,pipelineContext:"private"}).percent,null);
});
test("date filter defaults to all and persists only valid selections in the current assignment",()=>{
    const descriptor=Object.getOwnPropertyDescriptor(globalThis,"localStorage"), values=new Map();
    Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)}});
    try{
        assert.equal(readTaskDay("one"),null);
        writeTaskDay("one","2026-10-19");assert.equal(readTaskDay("one"),"2026-10-19");assert.equal(readTaskDay("two"),null);
        writeTaskDay("one","undated");assert.equal(readTaskDay("one"),"undated");
        writeTaskDay("one",null);assert.equal(readTaskDay("one"),null);
        for(const invalid of ["2026-02-30","2026-13-01","2026-2-01",{},42]){writeTaskDay("one",invalid);assert.equal(readTaskDay("one"),null);}
        values.set("one","invalid json");assert.equal(readTaskDay("one"),null);
        Object.defineProperty(globalThis,"localStorage",{configurable:true,get(){throw Error("Storage unavailable");}});
        assert.equal(readTaskDay("one"),null);assert.doesNotThrow(()=>writeTaskDay("one","undated"));
    }finally{if(descriptor)Object.defineProperty(globalThis,"localStorage",descriptor);else delete globalThis.localStorage;}
});

