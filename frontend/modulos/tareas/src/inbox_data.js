import {isMention, notificationActor, notificationTaskId} from '../../core/notification_data.js';

export const inboxTypes = {assignment:'Asignaciones',mention:'Menciones',comment:'Comentarios',date_changed:'Fechas',completed:'Completadas',status_changed:'Estados',other:'Otros avisos'};
export function inboxActivities(notifications, tasks = [], projects = [], directory = [], now = new Date()) {
    const today=new Date(now.getFullYear(),now.getMonth(),now.getDate()),yesterday=new Date(today);yesterday.setDate(today.getDate()-1);
    return notifications.map((item,index)=>{
        const taskId=notificationTaskId(item),task=tasks.find(task=>String(task.id)===String(taskId)) || null;
        const projectId=item.project?.id || item.project || item.route?.project_id || task?.project_id;
        const project=projects.find(project=>String(project.id)===String(projectId)) || null;
        const type=isMention(item)?'mention':/comment/.test(item.type)?'comment':/assign|member_added|collaborator_added/.test(item.type)?'assignment':/complet/.test(item.type)?'completed':/date|deadline/.test(item.type)?'date_changed':/status/.test(item.type)?'status_changed':'other';
        const date=new Date(item.created_at),timestamp=Number.isNaN(+date)?0:+date;
        const group=timestamp ? date>=today?'Hoy':date>=yesterday?'Ayer':'Anteriores' : item.time_label==='Ayer'?'Ayer':'Anteriores';
        return {...item,taskId,task,projectId,project,actor:notificationActor(item,directory),type,is_mention:isMention(item),timestamp,index,group};
    });
}

export function readInboxFlags(storage,key) {
    try {const value=JSON.parse(storage.getItem(key));return Object.fromEntries(['saved','archived'].map(name=>[name,Array.isArray(value?.[name])?value[name].filter(id=>typeof id==='string'):[]]));}
    catch {return {saved:[],archived:[]};}
}
