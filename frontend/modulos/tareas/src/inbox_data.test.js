import test from 'node:test';
import assert from 'node:assert/strict';
import {inboxActivities,readInboxFlags} from './inbox_data.js';
import {notificationTaskId} from '../../core/notification_data.js';

test('inbox uses explicit task IDs, serialized sender and actual mentions without guessing a task',()=>{
    const tasks=[{id:'one',title:'Entrega',project_id:'p'},{id:'two',title:'Entrega'}];
    const [unknown,comment,mention]=inboxActivities([
        {id:'a',title:'Entrega',body:'Actualizó Entrega',actor_name:'Persona autorizada'},
        {id:'b',title:'Comentario',type:'comment.created',task:'two',actor_assignment:'author',actor_name:'Nombre actual',actor_avatar_url:'/avatar'},
        {id:'c',title:'Aviso',type:'comment.mentioned',route:{task_id:'one'},created_at:'2026-11-01T11:00:00'},
    ],tasks,[{id:'p',label:'Campaña'}],[{id:'author',name:'Nombre anterior',avatar_url:'/old'}],new Date(2026,10,2,12));
    assert.equal(unknown.task,null);assert.equal(unknown.taskId,null);assert.equal(unknown.project,null);
    assert.equal(comment.task.id,'two');assert.equal(comment.actor.name,'Nombre actual');assert.equal(comment.actor.avatar_url,'/avatar');assert.equal(comment.is_mention,false);
    assert.equal(mention.task.id,'one');assert.equal(mention.project.label,'Campaña');assert.equal(mention.is_mention,true);assert.equal(mention.group,'Ayer');
    assert.equal(notificationTaskId({resource_id:'unrelated'}),null);
});

test('inbox dates distinguish today, yesterday and older notifications',()=>{
    const rows=inboxActivities(['2026-11-02T09:00:00','2026-11-01T09:00:00','2026-10-30T09:00:00'].map(created_at=>({created_at})),[],[],[],new Date(2026,10,2,12));
    assert.deepEqual(rows.map(row=>row.group),['Hoy','Ayer','Anteriores']);
});
test('saved inbox IDs are isolated by key and invalid storage is ignored',()=>{
    const storage={getItem:key=>key==='account:a'?'{"saved":["one",42],"archived":["two"]}':null};
    assert.deepEqual(readInboxFlags(storage,'account:a'),{saved:['one'],archived:['two']});
    assert.deepEqual(readInboxFlags(storage,'account:b'),{saved:[],archived:[]});
    assert.deepEqual(readInboxFlags({getItem(){throw new Error('Storage blocked');}},'a'),{saved:[],archived:[]});
});
