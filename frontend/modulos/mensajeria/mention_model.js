const tokenPattern=()=>/(?<![A-Za-z0-9._%+@-])(@[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,189}\.[A-Za-z]{2,24})(?![A-Za-z0-9_%+@-]|\.[A-Za-z0-9])/gi;
const literalPattern=()=>/```[\s\S]*?```|`[^`\n]*`|[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+|mailto:\S+/gi;

export function mentionParts(body,mentions=[]){
    const literals=[...body.matchAll(literalPattern())].map(match=>[match.index,match.index+match[0].length]);
    const verified=new Map(mentions.filter(row=>typeof row.token==='string' && typeof row.name==='string').map(row=>[row.token.toLowerCase(),row]));
    let start=0;const parts=[];
    for(const match of body.matchAll(tokenPattern())){
        const mention=verified.get(match[0].toLowerCase());
        if(!mention || literals.some(([from,to])=>from<=match.index && match.index<to))continue;
        if(match.index>start)parts.push({text:body.slice(start,match.index)});
        parts.push({text:match[0],mention});start=match.index+match[0].length;
    }
    if(start<body.length || !parts.length)parts.push({text:body.slice(start)});
    return parts;
}

export function insertMention(body,person,start=body.length,end=start){
    const token=person.token;
    if(typeof token!=='string' || !/^@[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,189}\.[A-Za-z]{2,24}$/i.test(token))throw Error('La referencia de esta persona no es válida. Vuelve a buscarla.');
    if(!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start<0 || end<start || end>body.length)throw Error('La selección del borrador cambió. Vuelve a seleccionar dónde mencionar.');
    const left=body.slice(0,start),right=body.slice(end),insert=(left && !/\s$/.test(left) ? ' ':'')+token+' ';
    const text=left+insert+right;
    if(text.length>5000)throw Error('La mención supera el límite de 5.000 caracteres. Reduce el texto antes de añadirla.');
    return {text,caret:left.length+insert.length};
}
