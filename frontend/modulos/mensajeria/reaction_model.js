// Reactions, content and receipts have independent clocks.
export const newestReactions=(current,incoming)=>!incoming || (current?.version ?? -1)>(incoming.version ?? -1) ? current:incoming;
export function applyReactions(messages,updates){
    const byId=new Map(updates.map(row=>[row.id,row.reactions]));
    return messages.map(row=>byId.has(row.id) ? {...row,reactions:newestReactions(row.reactions,byId.get(row.id))}:row);
}
