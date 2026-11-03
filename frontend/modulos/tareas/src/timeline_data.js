import {dateFromISO} from "./services/task_models.js";
import {personIdentity} from "../../core/shared/people.js";

export const timelineDay = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
const dayNumber = value => {const date=dateFromISO(value);return date ? Date.UTC(date.getFullYear(),date.getMonth(),date.getDate())/86400000 : null;};
export function shiftTimelineDay(value, amount) {const date=dateFromISO(value);if(!date)return null;date.setDate(date.getDate()+amount);return timelineDay(date);}
export function timelineTaskDates(task) {
    const start=task.start_date || task.due_date || "", end=task.due_date || task.start_date || "";
    if(!start && !end)return {kind:"undated"};
    if(!dateFromISO(start) || !dateFromISO(end) || start>end)return {kind:"invalid",start,end};
    return {kind:"dated",start,end};
}
export function initialTimelineDay(tasks, today=timelineDay(new Date())) {
    const starts=tasks.map(timelineTaskDates).filter(range=>range.kind==="dated").map(range=>range.start);
    return starts.length ? starts.reduce((first,next)=>next<first?next:first) : today;
}
export function timelineWindow(anchor, scale="14") {
    const date=dateFromISO(anchor) || new Date();
    if(scale==="month") date.setDate(1);
    const start=timelineDay(date), count=scale==="month" ? new Date(date.getFullYear(),date.getMonth()+1,0).getDate() : scale==="7" ? 7 : 14;
    return {start,end:shiftTimelineDay(start,count-1),days:Array.from({length:count},(_,i)=>shiftTimelineDay(start,i))};
}
export function shiftTimelinePeriod(anchor, scale, amount) {
    if(scale!=="month")return shiftTimelineDay(anchor,amount*(scale==="7"?7:14));
    const date=dateFromISO(anchor);return timelineDay(new Date(date.getFullYear(),date.getMonth()+amount,1));
}
export function timelineBar(range, window) {
    if(range.kind!=="dated" || range.start>window.end || range.end<window.start)return null;
    const first=range.start<window.start ? window.start : range.start, last=range.end>window.end ? window.end : range.end;
    return {offset:dayNumber(first)-dayNumber(window.start),span:dayNumber(last)-dayNumber(first)+1,clippedStart:range.start<window.start,clippedEnd:range.end>window.end};
}
export function timelineRows(tasks, members, window) {
    const people=new Map(members.map(person=>[String(person.id),person])), groups=new Map(), undated=[];
    for(const task of tasks) {
        const range=timelineTaskDates(task);
        if(range.kind!=="dated"){undated.push({task,range});continue;}
        const person=people.get(String(task.assignee_id)), assigned=task.assignee_id != null && task.assignee_id!=="";
        const id=person ? personIdentity(person) : assigned ? `assignment:${task.assignee_id}` : "unassigned";
        if(!groups.has(id))groups.set(id,{id,person,name:person?.name || task.assignee_name || (assigned ? "Responsable no disponible" : "Sin responsable"),total:0,items:[]});
        const row=groups.get(id);row.total++;
        const bar=timelineBar(range,window);
        if(bar)row.items.push({task,range,...bar});
    }
    for(const row of groups.values()) {
        const occupied=[];
        row.items.sort((a,b)=>a.range.start.localeCompare(b.range.start) || a.range.end.localeCompare(b.range.end));
        for(const item of row.items) {
            let lane=occupied.findIndex(end=>end<item.offset);
            if(lane<0)lane=occupied.length;
            occupied[lane]=item.offset+item.span-1;item.lane=lane;
        }
        row.lanes=Math.max(1,occupied.length);
    }
    return {rows:[...groups.values()].sort((a,b)=>a.id==="unassigned"?1:b.id==="unassigned"?-1:0),undated};
}

// Presentation only: the same task keeps its color when navigating dates.
export function timelineTaskColor(task) {
    const colors=["#8b79df","#36a587","#dc9a3f","#568ee5","#d76c9f","#e75a5a"];
    let hash=0;
    for(const character of String(task.id ?? task.title ?? ""))hash=(Math.imul(hash,31)+character.charCodeAt(0))|0;
    return colors[(hash>>>0)%colors.length];
}

export function timelineMonthWeeks(tasks, anchor) {
    const window=timelineWindow(anchor,"month"), offset=dateFromISO(window.start).getDay();
    const weeks=Array.from({length:Math.ceil((offset+window.days.length)/7)},(_,row)=>({days:Array.from({length:7},(_,column)=>window.days[row*7+column-offset] || null),items:[],lanes:0}));
    for(const task of tasks) {
        const range=timelineTaskDates(task), bar=timelineBar(range,window);
        if(!bar)continue;
        const first=offset+bar.offset,last=first+bar.span-1;
        for(let row=Math.floor(first/7);row<=Math.floor(last/7);row++) {
            const from=Math.max(first,row*7),to=Math.min(last,row*7+6),column=from%7,span=to-from+1;
            weeks[row].items.push({task,range,column,span,continuesBefore:range.start<weeks[row].days[column],continuesAfter:range.end>weeks[row].days[column+span-1]});
        }
    }
    for(const week of weeks) {
        const occupied=[];
        week.items.sort((a,b)=>a.column-b.column || b.span-a.span);
        for(const item of week.items) {
            let lane=occupied.findIndex(end=>end<item.column);
            if(lane<0)lane=occupied.length;
            occupied[lane]=item.column+item.span-1;item.lane=lane;
        }
        week.lanes=occupied.length;
    }
    return weeks;
}
