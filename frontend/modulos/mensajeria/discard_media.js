// Only an explicit user decision calls this. Unknown responses never authorize
// dropping or changing the immutable local attempt.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createMediaDiscarder(client){
    return async(kind,container,clientId,{signal}={})=>{
        if(!['chat','channel'].includes(kind) || !UUID.test(container) || !UUID.test(clientId))throw Error('Ámbito de descarte no válido.');
        const base=`/api/v2/messaging/${kind==='chat' ? 'conversations':'channels'}/${container}/`;
        signal?.throwIfAborted();
        const result=await client.request(base+'uploads/discard/',{method:'POST',body:{client_id:clientId},signal,timeoutMs:20000});
        signal?.throwIfAborted();
        if(result?.outcome==='cancelled' && UUID.test(result.upload?.id) && result.upload.client_id===clientId && ['cancelled','expired'].includes(result.upload.state))return result;
        if(result?.outcome==='published' && UUID.test(result.message_id)){
            const current=await client.request(base+'messages/'+result.message_id+'/',{signal,timeoutMs:20000});
            signal?.throwIfAborted();
            if(current?.message?.id===result.message_id && current.message.client_id===clientId)return {...current,outcome:'published'};
        }
        throw Error('No se pudo confirmar el descarte. Conservamos el archivo y su intento; vuelve a comprobarlo.');
    };
}
