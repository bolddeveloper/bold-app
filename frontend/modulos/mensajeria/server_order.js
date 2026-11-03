export function orderedServers(rows,order=[]){
    const rank=new Map(order.map((id,index)=>[id,index]));
    return [...rows].sort((a,b)=>(rank.get(a.id) ?? Infinity)-(rank.get(b.id) ?? Infinity));
}

export function moveServer(order,ids,source,target,after=false){
    const merged=[...new Set([...order,...ids])];
    if(source===target || !ids.includes(source) || !ids.includes(target))return merged;
    const next=merged.filter(id=>id!==source);
    next.splice(next.indexOf(target)+(after ? 1:0),0,source);
    return next;
}
