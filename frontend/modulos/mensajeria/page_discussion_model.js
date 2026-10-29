const uuid=value=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function commentAttempt(mode,parent,body,version,clientId){
    if(!['root','reply','edit'].includes(mode) || !uuid(parent) || !uuid(clientId) || typeof body!=='string' || !body.trim() || body.length>4000)throw Error('Revisa el comentario antes de enviarlo.');
    if(mode==='edit' && (!Number.isSafeInteger(version) || version<1))throw Error('Versión de comentario no válida.');
    return {client_id:clientId,body:body.trim(),...(mode==='root' ? {block_id:parent}:{}),...(mode==='edit' ? {version}:{})};
}
export function commentDraft(body,attempt,touched,version){
    return touched || attempt ? {payload:{schema:1,body,attempt,version:version ?? null},files:[]}:null;
}
export function restoreComment(payload,files,mode,parent){
    if(files?.length || payload?.schema!==1 || typeof payload.body!=='string' || payload.body.length>4000)throw Error('El borrador de comentario no es válido.');
    const attempt=payload.attempt;
    if(attempt){
        const expected=commentAttempt(mode,parent,attempt.body,attempt.version,attempt.client_id);
        if(JSON.stringify(expected)!==JSON.stringify(attempt))throw Error('El intento conservado pertenece a otro comentario.');
    }
    return {body:payload.body,attempt:attempt || null,version:payload.version,touched:true};
}
export function mergeComments(old,incoming){
    const rows=new Map(old.map(row=>[row.id,row]));
    for(const row of incoming)if(!rows.has(row.id) || rows.get(row.id).version<=row.version)rows.set(row.id,row);
    return [...rows.values()].sort((a,b)=>a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}
