export const states={intent_queued:'En cola para interpretar',intent_processing:'Interpretando tu petición',awaiting_scope:'Revisar alcance',prepare_queued:'En cola para preparar',preparing:'Consultando fuentes autorizadas',awaiting_approval:'Revisar cambios',execute_queued:'Ejecución aprobada en cola',executing:'Aplicando acciones aprobadas',completed:'Completada',failed:'Detenida',partial:'Completada parcialmente',uncertain:'Resultado pendiente de comprobar',cancelled:'Cancelada'};
export const actions={'tasks.create':'Crear tarea','tasks.update':'Modificar tarea','tasks.organize':'Organizar tarea','projects.create':'Crear proyecto','projects.update':'Modificar proyecto','execution.define':'Definir etapas','execution.advance':'Avanzar una etapa','events.create':'Crear reunión BOLD','events.update':'Modificar reunión BOLD','google.create':'Crear reunión Google','google.update':'Modificar reunión Google','reports.save':'Guardar o compartir informe'};
export const fields={title:'Título',summary:'Título',description:'Descripción',unit:'Departamento',status:'Estado',priority:'Prioridad',due_date:'Fecha objetivo',due_time:'Hora objetivo',assignee_assignment:'Responsable',project:'Proyecto',section:'Sección',parent_task:'Tarea principal',name:'Nombre',owner_assignment:'Responsable del proyecto',color:'Color',member_ids:'Miembros',phases:'Etapas',version:'Revisión del registro',phase_id:'Etapa',action:'Acción',reason:'Motivo',start:'Inicio',end:'Fin',dateTime:'Fecha y hora con zona',date:'Fecha',timeZone:'Zona horaria',attendees:'Invitados',email:'Correo',location:'Ubicación',reminders:'Recordatorios',addMeet:'Añadir Google Meet',removeMeet:'Retirar Google Meet',definition:'Configuración del informe',shared_with:'Compartir con',task:'Tarea',position:'Orden',responsible:'Responsables',lead:'Responsable principal',completion_criteria:'Criterio de finalización',prerequisites:'Dependencias',required:'Obligatoria',estimated_minutes:'Estimación en minutos',due_at:'Fecha objetivo'};
export const busyStates=new Set(['intent_queued','intent_processing','prepare_queued','preparing','execute_queued','executing']);
Object.assign(fields,{start_date:'Fecha de inicio',end_date:'Fecha de cierre',color_hex:'Color del proyecto',metric:'Métrica',group_by:'Agrupación',from:'Desde',to:'Hasta',timezone:'Zona horaria',filters:'Filtros',scope:'Alcance',date_basis:'Fecha de referencia',visualization:'Visualización',include_subtasks:'Incluir subtareas',assignments:'Personas',projects:'Proyectos',units:'Departamentos',statuses:'Estados',tasks:'Tareas'});
export function openAssistant(detail={}){globalThis.window?.dispatchEvent(new CustomEvent('bold:assistant-open',{detail}));}
export function supportMentionText(body){
    const literals=/```[\s\S]*?```|`[^`\n]*`|(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+|mailto:\S+/gi;
    const clean=body.replace(literals,match=>' '.repeat(match.length));
    const match=/(?<![\w@.+%-])(?:@soporte[ \t]+bold|@soportebold(?:@bold\.gt)?)(?![\w@%+-]|\.[\w])/i.exec(clean);
    return match?(body.slice(0,match.index)+body.slice(match.index+match[0].length)).trim():null;
}
export function routeMention(person,assignment,body,context={}){
    if(!person?.privateAssistant||!assignment?.assistant_enabled)return false;
    openAssistant({text:body,context});return true;
}
export function supportsDictation(){return Boolean(globalThis.SpeechRecognition||globalThis.webkitSpeechRecognition);}
export function assistantMentionPeople(rows,assignment){
    if(!assignment?.assistant_enabled)return rows;
    return [...rows,{employee_id:'assistant-private',is_bot:true,privateAssistant:true,name:'soportebold · privado',aliases:['Soporte BOLD','soportebold privado']}];
}
export function startDictation({onText,onError,onEnd}){
    const Recognition=globalThis.SpeechRecognition||globalThis.webkitSpeechRecognition;
    if(!Recognition)throw Error('Este navegador no ofrece dictado. Puedes usar el dictado del dispositivo o escribir.');
    const recognition=new Recognition();recognition.lang='es';recognition.continuous=false;recognition.interimResults=false;
    recognition.onresult=event=>onText(Array.from(event.results).map(row=>row[0].transcript).join(' '));
    recognition.onerror=()=>onError('El dictado no pudo completarse. El texto anterior se conserva.');
    recognition.onend=onEnd;recognition.start();return()=>recognition.abort();
}
