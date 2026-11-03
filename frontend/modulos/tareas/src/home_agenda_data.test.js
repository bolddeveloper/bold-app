import test from "node:test";
import assert from "node:assert/strict";
import {agendaDay,upcomingMeetings,meetingLink} from "./home_agenda_data.js";
const now=new Date(2026,10,2,10), at=hour=>new Date(2026,10,2,hour).toISOString();
const event=(id,start,end,extra={})=>({id,start:{dateTime:at(start)},end:{dateTime:at(end)},...extra});
test("three ongoing or upcoming meetings rotate locally after each ending",()=>{
 const events=[event("d",14,15),event("b",11,12),event("a",9,11),event("past",8,9),event("c",13,14),event("task",10,11,{kind:"task"}),event("cancel",10,11,{status:"cancelled"}),event("no",10,11,{attendees:[{self:true,responseStatus:"declined"}]}),{id:"all-day",start:{date:"2026-11-02"},end:{date:"2026-11-03"}}];
 assert.deepEqual(upcomingMeetings(events,now).map(row=>row.id),["a","b","c"]);
 assert.deepEqual(upcomingMeetings(events,new Date(2026,10,2,12)).map(row=>row.id),["c","d"]);
 assert.deepEqual(upcomingMeetings(events,new Date(2026,10,3,0)),[]);
 assert.equal(events.length,9);
});
test("calendar boundaries use local midnight; unsafe join links are rejected",()=>{
 const {start,end}=agendaDay(now);assert.equal(new Date(start).getHours(),0);assert.equal(new Date(end).getDate(),3);
 assert.equal(meetingLink({hangoutLink:"javascript:alert(1)"}),null);
 assert.equal(meetingLink({hangoutLink:"https://meet.google.com.evil.test/abc"}),null);
 assert.equal(meetingLink({hangoutLink:"https://meet.google.com/abc-defg-hij"}),"https://meet.google.com/abc-defg-hij");
});
