import * as Y from "../core/shared/crdt.js";

export const toBase64=bytes=>{let result="";for(let i=0;i<bytes.length;i+=32768)result+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(result);};
export const fromBase64=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const clone=value=>JSON.parse(JSON.stringify(value));
const localOrigin=Symbol("page-local");
const blockTypes=new Set(["paragraph","heading","bullet","check","task"]);
const fieldText=(doc,field)=>field==="title" ? doc.getText("title"):doc.getMap("blocks").get(field)?.get("text");

export function textSplice(before,after){
    let start=0,end=0;
    while(start<before.length && start<after.length && before[start]===after[start])start++;
    while(end<before.length-start && end<after.length-start && before[before.length-end-1]===after[after.length-end-1])end++;
    // Do not split a surrogate pair at the edit boundary.
    if(start && /[\uD800-\uDBFF]/.test(before[start-1]))start--;
    if(end && /[\uDC00-\uDFFF]/.test(before[before.length-end]))end--;
    return {start,remove:before.length-start-end,insert:after.slice(start,after.length-end)};
}
function updateText(text,value){
    const patch=textSplice(text.toString(),value);
    if(patch.remove)text.delete(patch.start,patch.remove);
    if(patch.insert)text.insert(patch.start,patch.insert);
}
export function readSharedPage(doc,knownRefs=new Map()){
    const blocks=doc.getMap("blocks"),order=doc.getArray("order").toArray();
    const ids=[...new Set([...order,...[...blocks.keys()].sort()])];
    return {title:doc.getText("title").toString(),icon:doc.getMap("meta").get("icon") || "note",blocks:ids.filter(id=>blocks.has(id)).map(id=>{
        const block=blocks.get(id),kind=block.get("type");
        return {id,type:kind,...(kind==="task" ? (knownRefs.has(id) ? {task_id:knownRefs.get(id)}:{}):{text:block.get("text")?.toString() || ""}),
            ...(kind==="heading" ? {level:block.get("level") || 2}:{}),...(kind==="check" ? {checked:!!block.get("checked")}:{})};
    })};
}
export function writeSharedPage(doc,value,{references=new Map(),compositions=new Map()}={}){
    doc.transact(()=>{
        if(!compositions.has("title"))updateText(doc.getText("title"),value.title);
        if(doc.getMap("meta").get("icon")!==value.icon)doc.getMap("meta").set("icon",value.icon);
        const blocks=doc.getMap("blocks"),ids=value.blocks.map(row=>row.id),wanted=new Set(ids);
        for(const id of [...blocks.keys()])if(!wanted.has(id)){blocks.delete(id);references.delete(id);}
        for(const row of value.blocks){
            if(!blockTypes.has(row.type))throw Error("Tipo de bloque no admitido.");
            let block=blocks.get(row.id);
            if(!block){block=new Y.Map();blocks.set(row.id,block);block.set("type",row.type);if(row.type!=="task")block.set("text",new Y.Text());}
            if(row.type==="task"){if(row.task_id)references.set(row.id,row.task_id);continue;}
            if(!compositions.has(row.id))updateText(block.get("text"),row.text || "");
            if(row.type==="check" && block.get("checked")!==!!row.checked)block.set("checked",!!row.checked);
            if(row.type==="heading" && block.get("level")!==(row.level || 2))block.set("level",row.level || 2);
        }
        const order=doc.getArray("order");
        // Change only the moved/inserted entries, not the entire shared array.
        for(let index=0;index<ids.length;index++){
            if(order.get(index)===ids[index])continue;
            const later=order.toArray().indexOf(ids[index],index+1);
            if(later>=0)order.delete(later,1);
            order.insert(index,[ids[index]]);
        }
        if(order.length>ids.length)order.delete(ids.length,order.length-ids.length);
    },localOrigin);
}

export function createCollaborativePage({page,connect,onChange,onDenied=()=>{},onBeforeRemote=()=>()=>{},delay=650,now=Date.now,uuid=()=>crypto.randomUUID()}){
    let doc=new Y.Doc(),base=clone(page),epoch=null,serverState=null,socket=null,closed=false,ready=false,running=null;
    let generation=0,accepted=0,status="connecting",error=null,conflict=null,pending=null,connection=null,failures=0;
    let timer=null,reconnectTimer=null,deadline=null,heartbeat=null,rosterTimer=null,lastSelection=0;
    let transfers=new Map(),references=new Map(),tasks=new Map(),peers=new Map(),compositions=new Map();
    let restoreSelection=null,openedAt=0;
    const touched=new Map();let recoveredBlocks=[];
    let initialDraft={title:page.title,icon:page.icon,blocks:page.blocks.map(({task,...row})=>row)};
    let desiredDraft=initialDraft;
    const dirty=()=>generation>accepted || !!pending || compositions.size>0;
    const signal=new AbortController();
    function projectTasks(rows){for(const row of rows || []){tasks.set(row.id,row.task);if(row.task_id)references.set(row.id,row.task_id);else if(row.task?.available===false)references.delete(row.id);}}
    projectTasks(page.blocks);
    function draft(){
        const result=ready ? readSharedPage(doc,references):clone(desiredDraft);
        for(const [field,composition] of compositions){if(field==="title")result.title=composition.value;else {const row=result.blocks.find(row=>row.id===field);if(row)row.text=composition.value;}}
        return result;
    }
    function emit(remote=false){
        if(closed)return;
        const value=draft();desiredDraft=value;
        const peerList=[...peers.values()].filter(peer=>now()-peer.seen<75000).map(peer=>({...peer,range:resolveRange(peer.selection)}));
        const model={base:{...base,can_edit:!!base.can_edit && ready && status!=="connecting",blocks:value.blocks.map(row=>row.type==="task" ? {...row,task:tasks.get(row.id) || {available:false}}:row)},
            draft:clone(value),dirty:dirty(),status,error,conflict:conflict && clone(conflict),pending:!!pending,peers:peerList,collaborative:true,recoveredBlocks:clone(recoveredBlocks)};
        const restore=remote ? restoreSelection || onBeforeRemote():null;
        restoreSelection=null;
        onChange(model,{remote});restore?.();
    }
    function clearTimers(){for(const handle of [timer,reconnectTimer,deadline])clearTimeout(handle);for(const handle of [heartbeat,rosterTimer])clearInterval(handle);}
    function schedule(){clearTimeout(timer);if(!closed && ready && socket?.readyState===1 && dirty() && !pending && !conflict && status!=="error" && base.can_edit)timer=setTimeout(flush,delay);}
    function send(packet){
        if(!socket || socket.readyState!==1)throw Error("La conexión no está abierta.");
        if((packet.update?.length || 0)<=60000){socket.send(JSON.stringify(packet));return;}
        if(packet.update.length>349528)throw Error("El cambio es demasiado grande. Conservamos el borrador; reduce el contenido antes de reintentar.");
        const id=uuid(),chunks=packet.update.match(/.{1,60000}/g);
        socket.send(JSON.stringify({type:"transfer.start",id,parts:chunks.length,packet:{...packet,update:undefined}}));
        chunks.forEach((data,index)=>socket.send(JSON.stringify({type:"transfer.chunk",id,index,data})));
        socket.send(JSON.stringify({type:"transfer.end",id}));
    }
    function readPacket(packet){
        if(packet.type==="transfer.start"){
            if(transfers.size>2 || !Number.isInteger(packet.parts) || packet.parts<1 || packet.parts>100)throw Error("Transferencia no válida.");
            transfers.set(packet.id,{parts:packet.parts,chunks:[],packet:packet.packet});return;
        }
        if(packet.type==="transfer.chunk" || packet.type==="transfer.end"){
            const transfer=transfers.get(packet.id);if(!transfer)throw Error("Transferencia incompleta.");
            if(packet.type==="transfer.chunk"){if(packet.index!==transfer.chunks.length || typeof packet.data!=="string" || packet.data.length>60000 || transfer.chunks.length>=transfer.parts)throw Error("Transferencia no válida.");transfer.chunks.push(packet.data);return;}
            if(transfer.chunks.length!==transfer.parts)throw Error("Transferencia incompleta.");transfers.delete(packet.id);packet={...transfer.packet,update:transfer.chunks.join("")};
        }
        receive(packet);
    }
    function watch(next){next.on("update",(_,origin)=>{if(origin===localOrigin)generation++;});return next;}
    watch(doc);
    function merge(packet){
        restoreSelection ||= onBeforeRemote();
        const before=ready ? draft().blocks:[];
        if(packet.update)Y.applyUpdate(doc,fromBase64(packet.update),"remote");
        const ids=new Set(doc.getMap("blocks").keys());
        for(const row of before)if(!ids.has(row.id) && row.type!=="task" && row.text && (touched.has(row.id) || compositions.has(row.id)) && !recoveredBlocks.some(old=>old.id===row.id)){
            recoveredBlocks.push({...row,text:compositions.get(row.id)?.value || row.text});
            compositions.get(row.id)?.doc.destroy();compositions.delete(row.id);touched.delete(row.id);
        }
        projectTasks(packet.tasks);
    }
    function receive(packet){
        if(closed)return;
        if(packet.type==="revoked"){onDenied({status:403});dispose();return;}
        if(packet.type==="presence"){
            if(packet.connection===connection)return;
            if(packet.left)peers.delete(packet.connection);else peers.set(packet.connection,{...packet,seen:now()});emit();return;
        }
        if(packet.type==="error"){
            pending=null;clearTimeout(deadline);error={status:packet.status,fields:{detail:packet.detail}};status="error";emit();return;
        }
        if(packet.type==="sync"){
            connection=packet.connection || connection;
            if(epoch && packet.epoch!==epoch && (dirty() || compositions.size)){
                conflict={...packet.page,collaboration:packet};pending=null;status="conflict";ready=true;clearTimeout(deadline);emit(true);return;
            }
            if(epoch && packet.epoch!==epoch){doc.destroy();doc=watch(new Y.Doc());references.clear();tasks.clear();}
            epoch=packet.epoch;base={...packet.page};projectTasks(base.blocks);merge(packet);serverState=fromBase64(packet.state);ready=true;
            if(pending && base.can_edit){status="saving";send(pending.payload);armDeadline();}else {status=dirty() ? "unsaved":"saved";schedule();}
            error=null;emit(true);return;
        }
        if(!ready || packet.epoch!==epoch)return;
        if(packet.type==="ack"){
            merge(packet);serverState=fromBase64(packet.state);const saved=readSharedPage(doc,references);base={...base,title:saved.title,icon:saved.icon,version:Math.max(base.version,packet.version),updated_at:packet.updated_at || base.updated_at,updated_by:packet.updated_by || base.updated_by};
            if(pending?.payload.client_id===packet.client_id){accepted=Math.max(accepted,pending.generation);pending=null;clearTimeout(deadline);}
            for(const [id,value] of touched)if(value<=accepted)touched.delete(id);
            status=dirty() ? "unsaved":"saved";error=null;failures=0;emit(true);schedule();return;
        }
        if(packet.type==="update" || packet.type==="sync_delta"){
            merge(packet);const shared=readSharedPage(doc,references);base={...base,title:shared.title,icon:shared.icon,version:Math.max(base.version,packet.version),...(packet.can_edit!==undefined ? {can_edit:packet.can_edit}:{})};
            if(packet.state)serverState=fromBase64(packet.state);
            if(packet.type==="sync_delta" && now()-openedAt>=30000)failures=0;
            emit(true);schedule();
        }
    }
    function armDeadline(){clearTimeout(deadline);deadline=setTimeout(()=>{if(pending && !closed)socket?.close();},15000);}
    function edit(value){
        if(closed || !ready || !base.can_edit || conflict)return;
        desiredDraft=clone(value);
        for(const [field,composition] of compositions){composition.value=field==="title" ? value.title:value.blocks.find(row=>row.id===field)?.text || "";}
        const before=generation,old=readSharedPage(doc,references);writeSharedPage(doc,value,{references,compositions});
        for(const row of value.blocks)if(JSON.stringify(row)!==JSON.stringify(old.blocks.find(previous=>previous.id===row.id)))touched.set(row.id,generation);
        if(before!==generation)status=status==="error" ? "error":pending ? "saving":"unsaved";
        if(compositions.size && status!=="error")status="unsaved";
        emit();schedule();
    }
    function flush(){
        clearTimeout(timer);if(closed || !ready || !base.can_edit || conflict || compositions.size)return;
        if(!socket || socket.readyState!==1){retry();return;}
        if(pending){send(pending.payload);armDeadline();return;}
        if(!dirty())return;
        try{
            const value=draft(),refs=Object.fromEntries(value.blocks.filter(row=>row.type==="task" && references.has(row.id)).map(row=>[row.id,references.get(row.id)]));
            pending={generation,payload:{type:"update",epoch,client_id:uuid(),update:toBase64(Y.encodeStateAsUpdate(doc,serverState)),state:toBase64(Y.encodeStateVector(doc)),references:refs}};
            send(pending.payload);status="saving";error=null;armDeadline();emit();
        }catch(err){pending=null;status="error";error={fields:{detail:err.message}};emit();}
    }
    async function start(){
        if(closed || running || socket?.readyState===1 || socket?.readyState===0)return;
        running=true;status=dirty() ? "unsaved":"connecting";emit();
        try{
            const next=await connect({signal:signal.signal});if(closed){next.close();return;}socket=next;openedAt=now();
            socket.onmessage=event=>{if(closed || socket!==next)return;try{readPacket(JSON.parse(event.data));}catch(err){error={fields:{detail:"No se pudo sincronizar la página. Conservamos tu borrador."}};status="error";emit();next.close();}};
            socket.onclose=event=>{
                if(closed || socket!==next)return;clearTimeout(deadline);transfers.clear();
                if([4401,4403].includes(event.code)){onDenied({status:403});dispose();return;}
                failures++;status="error";error={fields:{detail:"Conexión interrumpida. Conservamos tus cambios; la página se sincronizará al reconectar."}};emit();
                if(failures<=5 && event.code!==4400)reconnectTimer=setTimeout(start,Math.max(event.code===4429 ? 30000:0,Math.min(30000,1000*2**(failures-1))));
            };
            socket.onerror=()=>{};
        }catch(err){if(!closed && err.name!=="AbortError"){if([401,403,404].includes(err.status)){onDenied(err);dispose();return;}failures++;error=err;status="error";emit();if(failures<=5)reconnectTimer=setTimeout(start,Math.max(err.retryAfterMs || 0,Math.min(30000,1000*2**(failures-1))));}}
        finally{running=false;}
    }
    function retry(){clearTimeout(reconnectTimer);error=null;if(socket?.readyState===1){status=dirty() ? "unsaved":"saved";flush();}else {failures=0;start();}}
    function remote(value){if(closed)return; if(!ready){base={...base,...value};emit();return;}if(value.version>base.version){if(socket?.readyState===1)send({type:"sync",epoch,state:toBase64(Y.encodeStateVector(doc))});}else {base={...base,can_edit:value.can_edit,can_manage:value.can_manage,can_create_template:value.can_create_template};projectTasks(value.blocks);emit();}}
    function resolve(useMine){
        if(!conflict)return;
        const own=draft(),snapshot=conflict.collaboration;conflict=null;pending=null;generation=accepted=0;doc.destroy();doc=watch(new Y.Doc());references.clear();tasks.clear();epoch=null;receive(snapshot);
        if(useMine){edit(own);flush();}return own;
    }
    function bookmark(field,start,end){const text=fieldText(doc,field);if(!(text instanceof Y.Text))return null;return {field,anchor:toBase64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text,start))),head:toBase64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text,end)))};}
    function resolveRange(selection){try{if(!selection)return null;const anchor=Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(fromBase64(selection.anchor)),doc),head=Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(fromBase64(selection.head)),doc);return anchor && head ? {field:selection.field,start:anchor.index,end:head.index}:null;}catch{return null;}}
    function select(field,start,end){if(!ready || now()-lastSelection<180 || socket?.readyState!==1)return;lastSelection=now();send({type:"presence",selection:bookmark(field,start,end)});}
    function beginComposition(field){if(!ready || compositions.has(field))return;const text=fieldText(doc,field);if(!text)return;const snapshot=new Y.Doc();Y.applyUpdate(snapshot,Y.encodeStateAsUpdate(doc));compositions.set(field,{doc:snapshot,base:text.toString(),value:text.toString()});}
    function endComposition(field,value){
        const composition=compositions.get(field);if(!composition)return;
        const patch=textSplice(composition.base,value),text=fieldText(doc,field),old=fieldText(composition.doc,field);
        if(text){const start=Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromTypeIndex(old,patch.start),doc),end=Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromTypeIndex(old,patch.start+patch.remove),doc);
            doc.transact(()=>{if(start && end && end.index>start.index)text.delete(start.index,end.index-start.index);if(start && patch.insert)text.insert(start.index,patch.insert);},localOrigin);}
        compositions.delete(field);composition.doc.destroy();status="unsaved";emit();schedule();
    }
    function dispose(){if(closed)return;closed=true;clearTimers();signal.abort();socket?.close();doc.destroy();for(const composition of compositions.values())composition.doc.destroy();compositions.clear();tasks.clear();references.clear();peers.clear();transfers.clear();desiredDraft={};pending=null;conflict=null;}
    function recoverBlocks(){if(!recoveredBlocks.length)return;if(draft().blocks.length+recoveredBlocks.length>200){error={fields:{detail:"La página alcanzó 200 bloques. Copia el texto recuperado o quita algún bloque antes de añadirlo."}};status="error";emit();return;}const next=[...draft().blocks,...recoveredBlocks.map(row=>({...row,id:uuid()}))];recoveredBlocks=[];edit({...draft(),blocks:next});}
    emit();start();
    heartbeat=setInterval(()=>{if(!closed && ready && socket?.readyState===1)send({type:"ping",epoch,state:toBase64(Y.encodeStateVector(doc))});},30000);
    rosterTimer=setInterval(()=>{if(!closed && peers.size){for(const [id,peer] of peers)if(now()-peer.seen>=75000)peers.delete(id);emit();}},10000);
    return {edit,flush,retry,remote,resolve,dispose,bookmark,resolveRange,select,beginComposition,endComposition,recoverBlocks,dismissRecovery:()=>{recoveredBlocks=[];emit();},isComposing:field=>compositions.has(field)};
}
