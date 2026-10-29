// Only an explicit send waits here. No idle poll, new socket or background send.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATES=new Set(['queued','uploading','retry','failed','ready','attached','cancelled','expired']);
const abortError=()=>new DOMException('Espera detenida; el borrador se conserva.','AbortError');
function checked(row,clientId){
    if(!row || !UUID.test(row.id) || row.client_id!==clientId || !STATES.has(row.state))throw Error('Estado de subida no válido. Conservamos el intento original.');
    return row;
}
function stopped(row){
    const terminal=['cancelled','expired'].includes(row.state) || row.state==='failed' && !row.can_retry;
    const detail=terminal ? 'Esta preparación terminó. Conservamos el archivo; puedes iniciar un nuevo intento.' :
        row.error_code==='drive_reconnect' ? 'Drive necesita reconectarse. Conservamos el archivo; vuelve a enviar cuando se restablezca la conexión.' :
        row.error_code==='access_changed' ? 'Cambiaron la sesión, los permisos o el destino de Drive. Conservamos el archivo; revisa el acceso antes de reintentar.' :
        row.can_retry ? 'No se pudo completar la subida. Conservamos el intento; pulsa Enviar para reintentarlo.' :
        'Se agotaron los reintentos de esta preparación. Conservamos el archivo para un nuevo intento.';
    return Object.assign(Error(detail),{status:terminal ? 422:409,fields:{detail},uploadState:row.state,resetUploadAttempt:terminal});
}

export function uploadStageLabel(value){
    return {checking:'Comprobando el intento anterior…',preparing:'Protegiendo el archivo en la cola…',
        queued:'Archivo protegido. Esperando turno para subir a Drive…',uploading:'Subiendo el archivo a Drive…',
        retry:'Drive no respondió. El servidor conserva el archivo y reintentará…',ready:'Archivo listo en Drive…',
        publishing:'Publicando el mensaje…',attached:'Mensaje confirmado.'}[value?.state] || 'Comprobando la subida…';
}

export function createStagedMediaSender(client,{events=globalThis.window,setTimer=setTimeout,clearTimer=clearTimeout,
    now=Date.now,deadlineMs=120000,reconcileAt=[1500,6000,18000,45000,90000]}={}){
    function wait(collection,kind,container,initial,{signal,onStage}){
        return new Promise((resolve,reject)=>{
            const timers=new Set();let ended=false,busy=false,dirty=false,wakeTimer=null,lastRead=-Infinity;
            const timer=(fn,ms)=>{const key=setTimer(()=>{timers.delete(key);fn();},ms);timers.add(key);return key;};
            function finish(error,value){
                if(ended)return;ended=true;for(const key of timers)clearTimer(key);
                events?.removeEventListener('bold:upload-event',hint);events?.removeEventListener('bold:messaging-reconnect',recover);
                events?.removeEventListener('online',recover);signal?.removeEventListener('abort',aborted);
                error ? reject(error):resolve(value);
            }
            function accept(row){
                checked(row,initial.client_id);onStage?.({...row,kind,container_id:container});
                if(['ready','attached'].includes(row.state))finish(null,row);
                else if(['failed','cancelled','expired'].includes(row.state))finish(stopped(row));
            }
            async function read(){
                wakeTimer=null;if(ended)return;if(busy){dirty=true;return;}
                busy=true;lastRead=now();
                try{
                    const row=await client.request(collection+initial.id+'/',{signal,timeoutMs:20000});
                    if(!ended && !signal?.aborted)accept(row);
                }catch(error){if(!ended)finish(error);}
                finally{busy=false;if(dirty && !ended){dirty=false;schedule();}}
            }
            function schedule(){if(ended || wakeTimer!==null)return;wakeTimer=timer(read,Math.max(0,300-(now()-lastRead)));}
            function hint(event){
                const envelope=event.detail,p=envelope?.payload;
                if(envelope?.event_version===2 && envelope.event_type==='messaging.upload.changed' &&
                    p?.upload_id===initial.id && p.client_id===initial.client_id && p.kind===kind && p.container_id===container)schedule();
            }
            function recover(){schedule();}
            function aborted(){finish(abortError());}
            signal?.addEventListener('abort',aborted,{once:true});
            events?.addEventListener('bold:upload-event',hint);events?.addEventListener('bold:messaging-reconnect',recover);
            events?.addEventListener('online',recover);
            if(signal?.aborted){aborted();return;}
            timer(()=>finish(Object.assign(Error('La subida sigue sin confirmar. Conservamos el archivo y su intento; puedes reintentar sin volver a adjuntarlo.'),
                {status:409,fields:{detail:'La subida sigue sin confirmar. Conservamos el archivo y su intento; pulsa Enviar para comprobarlo de nuevo.'}})),deadlineMs);
            for(const delay of reconcileAt)if(delay<deadlineMs)timer(schedule,delay);
            try{accept(initial);if(!ended)schedule();}catch(error){finish(error);}
        });
    }
    return async function send(kind,container,values,file,options={}){
        values={...values}; // Never borrow mutable caption/task inputs after an await.
        const {signal,onStage}=options;
        if(!['chat','channel'].includes(kind) || !UUID.test(container) || !UUID.test(values.client_id))throw Error('Ámbito de subida no válido.');
        const base=`/api/v2/messaging/${kind==='chat' ? 'conversations':'channels'}/${container}/`,collection=base+'uploads/';
        const stage=(state,extra={})=>{signal?.throwIfAborted();onStage?.({state,filename:file.name,client_id:values.client_id,kind,container_id:container,...extra});};
        const request=(path,extra={})=>{signal?.throwIfAborted();return client.request(path,{signal,timeoutMs:20000,...extra});};
        async function confirmed(messageId){
            if(!UUID.test(messageId))throw Error('Confirmación de mensaje no válida.');
            const result=await request(base+'messages/'+messageId+'/');
            signal?.throwIfAborted();
            if(result?.message?.id!==messageId || result.message.client_id!==values.client_id)throw Error('El mensaje confirmado no coincide con este intento.');
            return result;
        }
        stage('checking');
        const lookup=await request(collection+'?'+new URLSearchParams({client_id:values.client_id}));
        signal?.throwIfAborted();
        if(lookup?.message_id)return confirmed(lookup.message_id);
        if(!Array.isArray(lookup?.results) || lookup.results.length>1)throw Error('Consulta de subida no válida.');
        let row=lookup.results[0];
        if(!row){
            stage('preparing');const data=new FormData();data.set('client_id',values.client_id);data.set('file',file,file.name || 'adjunto');
            row=await request(collection,{method:'POST',body:data,timeoutMs:45000});
        }else{
            checked(row,values.client_id);
            // Only a new explicit send authorizes another cycle, never a push/timer.
            if(row.state==='failed' && row.can_retry)row=await request(collection+row.id+'/',{method:'POST',body:{action:'retry'}});
        }
        signal?.throwIfAborted();checked(row,values.client_id);
        if(row.state==='failed' && !row.can_retry)throw stopped(row);
        row=await wait(collection,kind,container,row,{signal,onStage});
        signal?.throwIfAborted();
        if(row.state==='attached')return confirmed(row.message_id);
        stage('publishing',{id:row.id});
        const body={client_id:values.client_id,body:values.body,upload_id:row.id};
        if(kind==='channel')for(const key of ['parent_id','task_id'])if(values[key]!=null)body[key]=values[key];
        const result=await request(base+'messages/',{method:'POST',body});
        signal?.throwIfAborted();
        return result;
    };
}
