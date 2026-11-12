export const phaseLabels={pending:'Pendiente de dependencia',available:'Disponible',in_progress:'En curso',blocked:'Bloqueada',completed:'Completada',skipped:'Omitida con autorización'};
export function phaseDefinition(phase){
    return Object.fromEntries(['id','name','description','completion_criteria','unit','lead','responsible','prerequisites','required','due_at','estimated_minutes'].map(key=>[key,phase[key]??({responsible:[],prerequisites:[],required:true,description:'',completion_criteria:''}[key]??null)]));
}
export function copyPhaseTemplate(rows,makeId=()=>crypto.randomUUID()){
    const ids=new Map(rows.map(row=>[row.id,makeId()]));
    return rows.map(row=>({...phaseDefinition(row),id:ids.get(row.id),responsible:[...(row.responsible||[])],prerequisites:(row.prerequisites||[]).map(id=>ids.get(id)).filter(Boolean)}));
}
export function newPhase(assignment,prerequisite){
    return {id:crypto.randomUUID(),name:'',description:'',completion_criteria:'',unit:String(assignment?.unit||assignment?.unit_id||''),
        lead:String(assignment?.id||''),responsible:assignment?.id?[String(assignment.id)]:[],prerequisites:prerequisite?[prerequisite]:[],required:true,due_at:null,estimated_minutes:null};
}
export function checkPhaseGraph(rows){
    const graph=new Map(rows.map(row=>[row.id,row.prerequisites||[]])),visiting=new Set(),done=new Set();
    function visit(id){if(!graph.has(id)||visiting.has(id))return false;if(done.has(id))return true;visiting.add(id);for(const before of graph.get(id))if(!visit(before))return false;visiting.delete(id);done.add(id);return true;}
    if(new Set(rows.map(row=>row.id)).size!==rows.length||![...graph.keys()].every(visit))return 'Las dependencias deben pertenecer a esta tarea y no formar ciclos.';
    if(rows.some(row=>!row.name?.trim()||!row.lead||!row.unit))return 'Completa el nombre, departamento y responsable principal de cada etapa.';
    return '';
}
