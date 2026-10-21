import {normalizeQuery} from "./messaging_models.js";

export const CHANNEL_COLORS = ["#B82146", "#4760A8", "#9250A3", "#287065", "#A14B30", "#59602B", "#427887", "#7254AD"];
export const channelColor = row => /^#[0-9a-f]{6}$/i.test(row?.color) ? row.color : /^#[0-9a-f]{6}$/i.test(row?.department?.color) ? row.department.color : CHANNEL_COLORS[0];

function similar(term, word) {
    if (word.includes(term)) return true;
    const limit = term.length >= 8 ? 2 : term.length >= 4 ? 1 : 0;
    if (!limit || Math.abs(term.length-word.length)>limit) return false;
    let previous=Array.from({length:word.length+1},(_,i)=>i),before=null;
    for(let i=1;i<=term.length;i++) {
        const current=[i];
        for(let j=1;j<=word.length;j++) {
            let distance=Math.min(current[j-1]+1,previous[j]+1,previous[j-1]+(term[i-1]!==word[j-1]));
            if(before && j>1 && term[i-1]===word[j-2] && term[i-2]===word[j-1]) distance=Math.min(distance,before[j-2]+1);
            current.push(distance);
        }
        before=previous;previous=current;
    }
    return previous.at(-1)<=limit;
}
export function channelMatches(name, query) {
    const words=normalizeQuery(name).match(/[\p{L}\p{N}_]+/gu) || [];
    return (normalizeQuery(query).match(/[\p{L}\p{N}_]+/gu) || []).every(term=>words.some(word=>similar(term,word)));
}
export function personMatches(person, query) {
    return normalizeQuery([person.name,person.email,...(person.departments || []).map(row=>row.name)].join(" ")).includes(normalizeQuery(query));
}
// Bulk invitations never promote a reader, overwrite a block or partially add a department.
export function invitePeople(members, people) {
    const rows=new Map(members.map(row=>[row.employee_id,row]));
    for(const person of people) if(!rows.has(person.employee_id)) rows.set(person.employee_id,{...person,access:"write"});
    if(rows.size>200) throw Error("El departamento supera el límite de 200 personas. No se añadió ninguna; selecciona personas individualmente.");
    return [...rows.values()];
}
