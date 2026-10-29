export const textBlockTypes=new Set(['paragraph','heading','bullet','check']);
export const formatKeys=['bold','code','href','italic','no_link','strike'];
export const codeLanguages={text:'Texto',javascript:'JavaScript',typescript:'TypeScript',python:'Python',sql:'SQL',json:'JSON',html:'HTML',css:'CSS',bash:'Bash'};
export function safePageHref(value){
    if(typeof value!=='string' || !value || value.length>2048 || /[\x00-\x20\x7f\\]/.test(value) || !/^https?:\/\//i.test(value))throw Error('Usa un enlace http o https válido, sin espacios ni credenciales.');
    let url;try{url=new URL(value);}catch{throw Error('El enlace no es válido.');}
    if(!url.hostname || url.username || url.password || /https?:\/\/[^/]*@/i.test(value))throw Error('El enlace no puede contener credenciales.');
    return value;
}
export function formatAttributes(value){
    if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(key=>!formatKeys.includes(key)))throw Error('Atributos de formato no válidos.');
    return Object.fromEntries(formatKeys.filter(key=>Object.hasOwn(value,key)).map(key=>{if(key==='href')return [key,safePageHref(value[key])];if(value[key]!==true)throw Error('Marca de formato no válida.');return [key,true];}));
}
export function normalizeFormats(text,formats=[],limit=200){
    if(typeof text!=='string' || !Array.isArray(formats) || formats.length>limit)throw Error('El bloque admite hasta 200 tramos de formato.');
    const boundaries=new Set([0]);let size=0;for(const char of text){if(char.length===1 && /[\uD800-\uDFFF]/.test(char))throw Error('Carácter Unicode no válido.');size+=char.length;boundaries.add(size);}
    const result=[];let last=0;
    for(const row of formats){
        if(!row || !Number.isSafeInteger(row.start) || !Number.isSafeInteger(row.end) || !boundaries.has(row.start) || !boundaries.has(row.end) || row.start<last || row.start>=row.end)throw Error('El formato no puede dividir caracteres ni solaparse.');
        const {start,end,...raw}=row,attrs=formatAttributes(raw);if(!Object.keys(attrs).length)throw Error('El tramo necesita un formato.');
        const previous=result.at(-1);
        if(previous?.end===start && JSON.stringify(previous.attrs)===JSON.stringify(attrs))previous.end=end;
        else result.push({start,end,attrs});last=end;
    }
    return result.map(({start,end,attrs})=>({start,end,...attrs}));
}
export function formattedSegments(text,formats=[]){
    const result=[];let offset=0;
    for(const {start,end,...attrs} of normalizeFormats(text,formats,4096)){
        if(start>offset)result.push({start:offset,end:start,text:text.slice(offset,start),attrs:{}});
        result.push({start,end,text:text.slice(start,end),attrs});offset=end;
    }
    if(offset<text.length)result.push({start:offset,end:text.length,text:text.slice(offset),attrs:{}});
    return result;
}
export function formatsFromDelta(delta){
    let text='',offset=0;const formats=[];
    for(const item of delta){
        if(typeof item.insert!=='string')throw Error('El texto no admite objetos incrustados.');
        const attrs=formatAttributes(item.attributes || {}),end=offset+item.insert.length;
        if(Object.keys(attrs).length && end>offset)formats.push({start:offset,end,...attrs});text+=item.insert;offset=end;
    }
    // Keep an over-limit concurrent local draft readable/undoable. The write
    // contract and the server still cap accepted content at 200 runs.
    return normalizeFormats(text,formats,4096);
}
export function seedTextFormats(shared,text,formats){
    for(const {start,end,...attrs} of normalizeFormats(text,formats))shared.format(start,end-start,attrs);
}
export function applyFormats(text,formats,start,end,patch){
    if(!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start<0 || end>text.length || end<=start)throw Error('Selecciona el texto que deseas formatear.');
    const clean=formatAttributes(Object.fromEntries(Object.entries(patch).filter(([,value])=>value!==null)));
    if(Object.keys(patch).some(key=>!formatKeys.includes(key)))throw Error('Formato no admitido.');
    const points=[...new Set([0,text.length,start,end,...formats.flatMap(row=>[row.start,row.end])])].sort((a,b)=>a-b),result=[];
    for(let index=0;index<points.length-1;index++){
        const from=points[index],to=points[index+1],source=formats.find(row=>row.start<=from && row.end>=to),{start:_,end:__,...attrs}=source || {};
        if(from>=start && to<=end){for(const key of Object.keys(patch))delete attrs[key];Object.assign(attrs,clean);}
        if(Object.keys(attrs).length)result.push({start:from,end:to,...attrs});
    }
    // Coalesce before checking the public 200-run bound.
    const merged=[];for(const row of result){const {start:from,end:to,...raw}=row,attrs=formatAttributes(raw),last=merged.at(-1);if(last && last.end===from && JSON.stringify(last.attrs)===JSON.stringify(attrs))last.end=to;else merged.push({start:from,end:to,attrs});}
    return normalizeFormats(text,merged.map(({start:from,end:to,attrs})=>({start:from,end:to,...attrs})));
}
export function rangeHasFormat(text,formats,start,end,key){return start>=0 && end<=text.length && end>start && formattedSegments(text,formats).filter(row=>row.end>start && row.start<end).every(row=>!!row.attrs[key]);}
export function replaceFormattedText(text,formats,start,end,label,attributes){
    if(typeof label!=='string' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start<0 || end<start || end>text.length)throw Error('La selección no es válida.');
    const attrs=formatAttributes(attributes),next=text.slice(0,start)+label+text.slice(end),delta=label.length-(end-start),rows=[];
    if(next.length>4000)throw Error('El bloque admite hasta 4.000 caracteres.');
    for(const {start:from,end:to,...style} of normalizeFormats(text,formats,4096)){
        if(from<start)rows.push({start:from,end:Math.min(to,start),...style});
        if(to>end)rows.push({start:Math.max(from,end)+delta,end:to+delta,...style});
    }
    if(label && Object.keys(attrs).length)rows.push({start,end:start+label.length,...attrs});
    rows.sort((a,b)=>a.start-b.start);
    return {text:next,formats:normalizeFormats(next,rows)};
}
export function rebaseFormats(before,formats,after){
    let start=0,end=0;
    while(start<before.length && start<after.length && before[start]===after[start])start++;
    while(end<before.length-start && end<after.length-start && before[before.length-end-1]===after[after.length-end-1])end++;
    if(start && /[\uD800-\uDBFF]/.test(before[start-1]))start--;
    if(end && /[\uDC00-\uDFFF]/.test(before[before.length-end]))end--;
    const attrs=formattedSegments(before,formats).find(row=>row.start<=start && row.end>start)?.attrs || {};
    return replaceFormattedText(before,formats,start,before.length-end,after.slice(start,after.length-end),attrs).formats;
}
