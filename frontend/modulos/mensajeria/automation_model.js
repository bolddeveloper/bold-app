export const automationKinds={task_status:'Cambio de estado de tarea',reminder:'Recordatorio del canal',recurring_page:'Página periódica desde plantilla'};
export const automationReasons={manual:'Pausada por ti',manual_capacity:'Pausada por ti; auditoría sin espacio',completed:'Recordatorio completado',
    capacity:'Presupuesto agotado; conserva el historial',identity_unavailable:'Cuenta o asignación no disponible',identity_changed:'Cambió la identidad o sus credenciales',
    channel_permission:'Acceso al canal retirado o canal archivado',message_permission:'Permiso de publicar retirado',project_permission:'Proyecto no disponible',
    source_changed:'Cambió el departamento del proyecto',status_unavailable:'Estado no disponible',page_permission:'Permiso de páginas retirado',
    template_changed:'La plantilla cambió o fue archivada',task_scope_changed:'La tarea dejó el proyecto',source_permission:'Origen no disponible con los permisos actuales',
    worker_error:'Falló el trabajador; revisa el registro',rule_changed:'La regla cambió antes de ejecutarse',unsupported_kind:'Tipo no admitido'};
const validUuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');
const pad=value=>String(value).padStart(2,'0');
export function localSchedule(value){
    if(!value)return '';
    const date=new Date(value);
    return Number.isFinite(date.getTime()) ? `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`:'';
}
export function emptyAutomationForm(row=null){
    return {name:row?.name || '',kind:row?.kind || 'task_status',project_id:row?.project_id || '',to_status_id:row?.to_status_id || '',
        from_status_id:row?.from_status_id || '',template_id:row?.template_id || '',template_version:row?.template_version || '',
        body:row?.body || '',next_at:localSchedule(row?.next_at),interval_days:row?.interval_days ? String(row.interval_days):'',share_confirmed:false};
}
export function automationInput(form,clientId,{now=Date.now(),checkTime=true}={}){
    const errors={},values={client_id:clientId,name:form.name.trim(),kind:form.kind,share_confirmed:form.share_confirmed===true};
    if(!validUuid(clientId))throw Error('Intento no válido.');
    if(!values.name || values.name.length>120)errors.name='Escribe un nombre de hasta 120 caracteres.';
    if(!Object.hasOwn(automationKinds,form.kind))errors.kind='Selecciona un tipo admitido.';
    if(!values.share_confirmed)errors.share_confirmed='Revisa y confirma la acción antes de guardar.';
    if(form.kind==='task_status'){
        for(const key of ['project_id','to_status_id'])if(!validUuid(form[key]))errors[key]=key==='project_id' ? 'Selecciona un proyecto accesible.':'Selecciona un estado destino.';
        if(form.from_status_id && !validUuid(form.from_status_id))errors.from_status_id='Selecciona un estado origen válido.';
        if(form.from_status_id && form.from_status_id===form.to_status_id)errors.from_status_id='El estado origen debe ser distinto del destino.';
        Object.assign(values,{project_id:form.project_id,to_status_id:form.to_status_id,...(form.from_status_id ? {from_status_id:form.from_status_id}:{})});
    }else if(form.kind==='reminder' || form.kind==='recurring_page'){
        const date=new Date(form.next_at);
        if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(form.next_at) || !Number.isFinite(date.getTime()) || localSchedule(date)!==form.next_at)
            errors.next_at='Indica una fecha y hora válidas de este dispositivo. Una hora inexistente por cambio de horario no se ajusta silenciosamente.';
        else if(checkTime && (date.getTime()<now+5000 || date.getTime()>now+365*86400000))errors.next_at='Elige una fecha entre cinco segundos y 365 días en el futuro.';
        else values.next_at=date.toISOString();
        if(form.interval_days){
            if(!/^\d+$/.test(form.interval_days) || +form.interval_days<1 || +form.interval_days>365)errors.interval_days='Usa de 1 a 365 días de 24 horas UTC.';
            else values.interval_days=+form.interval_days;
        }else if(form.kind==='recurring_page')errors.interval_days='Indica cada cuántos días se creará la página.';
        if(form.kind==='reminder'){
            values.body=form.body.trim();if(!values.body || values.body.length>2000)errors.body='Escribe un recordatorio de hasta 2.000 caracteres.';
        }else{
            if(!validUuid(form.template_id) || !Number.isSafeInteger(+form.template_version) || +form.template_version<1)errors.template_id='Selecciona y revisa una plantilla de este canal.';
            values.template_id=form.template_id;values.template_version=+form.template_version;
        }
    }
    return {values,errors};
}
export function automationError(error){
    if([401,403,404].includes(error?.status))return 'La regla o el canal ya no están disponibles con tus permisos actuales.';
    if(error?.status===409)return 'La versión o el presupuesto cambió. Conserva tu revisión y actualiza el estado antes de decidir; no se creó otra acción.';
    const detail=error?.fields?.detail || error?.fields?.non_field_errors;
    if(typeof detail==='string' && detail.length<700)return detail;
    if(Array.isArray(detail) && detail.every(item=>typeof item==='string'))return detail.join(' ');
    return 'No se pudo confirmar la operación. Reintenta el mismo intento para comprobarlo sin duplicar ni cambiar sus parámetros.';
}
export const automationDefinitive=error=>[400,401,403,404,409,422].includes(error?.status);
export const automationStamp=value=>value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString('es',{dateStyle:'medium',timeStyle:'short'}):'Sin fecha';

const canonical=value=>JSON.stringify(value && typeof value==='object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,JSON.parse(canonical(item))])):value);
export function captureAutomationReview(state,channelId){
    if(!state.attempt && (!state.editing || canonical(state.form)===canonical(state.baseline)))return {payload:null,files:[]};
    return {payload:{version:1,channel_id:channelId,editing:state.editing,form:state.form,baseline:state.baseline,
        base_rule:state.selected ? {id:state.selected.id,version:state.baseVersion}:null,attempt:state.attempt},files:[]};
}
export function restoreAutomationReview(payload,channelId){
    const reject=()=>{throw Error('La revisión conservada no corresponde a este canal o tiene datos incompatibles. No se envió ninguna operación.');};
    if(!payload || Object.keys(payload).sort().join(',')!=='attempt,base_rule,baseline,channel_id,editing,form,version' || payload.version!==1 || payload.channel_id!==channelId || typeof payload.editing!=='boolean')reject();
    const checkForm=form=>{
        const fields=emptyAutomationForm();
        if(!form || canonical(Object.keys(form).sort())!==canonical(Object.keys(fields).sort()) || !Object.hasOwn(automationKinds,form.kind) || typeof form.share_confirmed!=='boolean')reject();
        for(const [key,value] of Object.entries(form)){
            if(key==='share_confirmed')continue;
            if(key==='template_version'){if(value!=='' && (!Number.isSafeInteger(+value) || +value<1))reject();continue;}
            if(typeof value!=='string' || value.length>(key==='body' ? 2000:key==='name' ? 120:80))reject();
            if(['project_id','to_status_id','from_status_id','template_id'].includes(key) && value && !validUuid(value))reject();
        }
    };
    checkForm(payload.form);checkForm(payload.baseline);
    if(payload.base_rule && (!validUuid(payload.base_rule.id) || !Number.isSafeInteger(payload.base_rule.version) || payload.base_rule.version<1 || Object.keys(payload.base_rule).sort().join(',')!=='id,version'))reject();
    let attempt=payload.attempt;
    if(attempt){
        if(Object.keys(attempt).sort().join(',')!=='action,rule,values' || !['create','replace','toggle'].includes(attempt.action) || !validUuid(attempt.values?.client_id))reject();
        const rule=payload.base_rule;
        if(attempt.action==='create'){
            if(attempt.rule!==null || rule)reject();
        }else if(!rule || attempt.rule!==rule.id || attempt.values.version!==rule.version)reject();
        if(attempt.action==='toggle'){
            if(Object.keys(attempt.values).sort().join(',')!=='active,client_id,share_confirmed,version' || typeof attempt.values.active!=='boolean' || attempt.values.share_confirmed!==attempt.values.active)reject();
        }else{
            const result=automationInput(payload.form,attempt.values.client_id,{checkTime:false});
            const expected={...result.values,...(rule ? {version:rule.version}:{})};
            if(Object.keys(result.errors).length || canonical(expected)!==canonical(attempt.values))reject();
        }
        attempt=Object.freeze({...attempt,values:Object.freeze({...attempt.values})});
    }
    return {...payload,form:{...payload.form},baseline:{...payload.baseline},attempt};
}
