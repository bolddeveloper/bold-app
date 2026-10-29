// Personal reminders never replace the actual message unread counts/receipts.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function readingScope(target){
    if(target?.kind==='chat' && uuid.test(target.conversation_id))return 'chat:'+target.conversation_id;
    if(target?.kind==='channel' && uuid.test(target.channel_id) && (!target.parent_id || uuid.test(target.parent_id)))return target.parent_id ? 'thread:'+target.parent_id:'channel:'+target.channel_id;
    return null;
}
export function parseReadingSnapshot(value){
    if(!Number.isSafeInteger(value?.version) || value.version<0 || !Array.isArray(value.items) || value.items.length>500)return null;
    const scopes=new Set(),ids=new Set(),items=[];
    for(const row of value.items){
        const target=row?.target,scope=readingScope(target);
        if(!scope || row.scope_key!==scope || !uuid.test(row.id) || !uuid.test(row.document_id) || !uuid.test(target.message_id)
            || target.kind==='chat' && !uuid.test(target.employee_id) || !Number.isSafeInteger(row.version) || row.version<1 || row.version>value.version
            || scopes.has(scope) || ids.has(row.id))return null;
        scopes.add(scope);ids.add(row.id);items.push({...row,target:{...target}});
    }
    return {version:value.version,items};
}
export const readingItems=unread=>unread?.reading?.items || [];
export function hasChatAttention(unread,conversationId=null,employeeId=null){
    return (conversationId ? unread?.byConversation?.[conversationId]?.count : employeeId ? unread?.byEmployee?.[employeeId]:unread?.total)>0
        || readingItems(unread).some(row=>row.target.kind==='chat' && (!conversationId || row.target.conversation_id===conversationId) && (!employeeId || row.target.employee_id===employeeId));
}
export const hasSlackAttention=(slack,unread)=>slack?.total>0 || readingItems(unread).some(row=>row.target.kind==='channel');
