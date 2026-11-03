import test from "node:test";
import assert from "node:assert/strict";
import {initialTimelineDay,shiftTimelineDay,shiftTimelinePeriod,timelineTaskDates,timelineWindow,timelineBar,timelineRows,timelineTaskColor,timelineMonthWeeks} from "./timeline_data.js";

test("timeline uses calendar days and bounded periods across months and leap years",()=>{
    assert.equal(shiftTimelineDay("2028-02-28",1),"2028-02-29");
    assert.equal(shiftTimelineDay("2026-12-31",1),"2027-01-01");
    assert.equal(timelineWindow("2028-02-20","month").days.length,29);
    assert.equal(timelineWindow("2028-02-20","month").start,"2028-02-01");
    assert.equal(shiftTimelinePeriod("2026-12-01","month",1),"2027-01-01");
    assert.equal(shiftTimelinePeriod("2026-10-01","14",-1),"2026-09-17");
    const tasks=[{start_date:"2000-01-01",due_date:"2099-12-31"}];
    const window=timelineWindow(initialTimelineDay(tasks),"14");assert.equal(window.days.length,14);
    assert.equal(timelineBar(timelineTaskDates(tasks[0]),window).span,14);
});
test("timeline clips real intervals without inventing duration or dates",()=>{
    const window=timelineWindow("2026-03-07","7");
    assert.deepEqual(timelineBar(timelineTaskDates({start_date:"2026-03-06",due_date:"2026-03-09"}),window),{offset:0,span:3,clippedStart:true,clippedEnd:false});
    assert.deepEqual(timelineBar(timelineTaskDates({due_date:"2026-03-08"}),window),{offset:1,span:1,clippedStart:false,clippedEnd:false});
    assert.equal(timelineBar(timelineTaskDates({due_date:"2026-04-08"}),window),null);
    assert.deepEqual(timelineTaskDates({start_date:"2026-03-08"}),{kind:"dated",start:"2026-03-08",end:"2026-03-08"});
});
test("timeline separates missing and invalid dates instead of normalizing invalid schedules",()=>{
    assert.equal(timelineTaskDates({}).kind,"undated");
    assert.equal(timelineTaskDates({start_date:"2026-02-30",due_date:"2026-03-01"}).kind,"invalid");
    assert.equal(timelineTaskDates({start_date:"2026-03-05",due_date:"2026-03-01"}).kind,"invalid");
    assert.equal(initialTimelineDay([{}, {due_date:"bad"}],"2026-10-30"),"2026-10-30");
});
test("timeline groups assignments for the same person and packs simultaneous tasks into lanes",()=>{
    const tasks=[{id:"a",assignee_id:"one",start_date:"2026-10-01",due_date:"2026-10-03"},{id:"b",assignee_id:"two",due_date:"2026-10-02"},{id:"c",assignee_id:"one",due_date:"2026-10-04"},{id:"d",due_date:"2026-10-01"},{id:"no-date"}];
    const copy=structuredClone(tasks),members=[{id:"one",personId:"person",name:"Persona"},{id:"two",personId:"person",name:"Persona"}];
    const {rows,undated}=timelineRows(tasks,members,timelineWindow("2026-10-01"));
    assert.equal(rows.length,2);assert.equal(rows[0].total,3);assert.equal(rows[0].lanes,2);
    assert.deepEqual(rows[0].items.map(item=>item.lane),[0,1,0]);assert.equal(rows[1].name,"Sin responsable");
    assert.equal(undated[0].task.id,"no-date");assert.deepEqual(tasks,copy);
});

test("timeline task colors remain stable across navigation and vary between tasks",()=>{
    assert.equal(timelineTaskColor({id:"a"}),timelineTaskColor({id:"a",title:"Renombrada"}));
    assert.ok(new Set(["a","b","c","d","e","f"].map(id=>timelineTaskColor({id}))).size>1);
});

test("monthly timeline keeps weekday alignment, blank outer days and weekly task segments",()=>{
    const weeks=timelineMonthWeeks([{id:"long",start_date:"2026-09-28",due_date:"2026-10-08"}],"2026-10-15");
    assert.equal(weeks.length,5);assert.deepEqual(weeks[0].days.slice(0,4),[null,null,null,null]);
    assert.equal(weeks[0].days[4],"2026-10-01");assert.equal(weeks.flatMap(week=>week.days).filter(Boolean).length,31);
    assert.deepEqual(weeks.flatMap(week=>week.items).map(item=>[item.column,item.span]),[[4,3],[0,5]]);
    assert.equal(weeks[0].items[0].continuesBefore,true);assert.equal(weeks[0].items[0].continuesAfter,true);assert.equal(weeks[1].items[0].continuesAfter,false);
    const crowded=timelineMonthWeeks(Array.from({length:10},(_,i)=>({id:i,due_date:"2026-10-08"})),"2026-10-01");
    assert.equal(crowded[1].lanes,10);assert.equal(new Set(crowded[1].items.map(item=>item.lane)).size,10);
});
