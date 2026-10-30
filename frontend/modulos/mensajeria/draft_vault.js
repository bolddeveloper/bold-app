// Ciphertext only. Keys live in this editor's memory and come from a fresh
// resource ACL check, never from localStorage/IndexedDB or a cached grant.
const VERSION=1,MAX_ENTRY=64*1024*1024,MAX_TOTAL=128*1024*1024,MAX_RECORDS=100;
const encoder=new TextEncoder(),decoder=new TextDecoder();
const canonical=scope=>JSON.stringify(Object.fromEntries(Object.entries(scope).sort(([a],[b])=>a.localeCompare(b))));
const failure=message=>new Error(message);
export const draftIdentity=scope=>`v${VERSION}:${canonical(scope)}`;

export async function packDraft(payload,files=[]){
    if(files.length>30)throw failure("El borrador admite hasta 30 archivos. Conserva los demás antes de salir.");
    const metadata=encoder.encode(JSON.stringify({payload,files:files.map(file=>({name:file.name || "archivo",type:file.type || "",lastModified:file.lastModified || 0,size:file.size}))}));
    const size=4+metadata.length+files.reduce((sum,file)=>sum+file.size,0);
    if(!Number.isSafeInteger(size) || size>MAX_ENTRY-32)throw failure("El borrador supera 64 MB. No cierres esta vista: envía o retira archivos para poder conservarlo.");
    const bytes=new Uint8Array(size);new DataView(bytes.buffer).setUint32(0,metadata.length);bytes.set(metadata,4);
    let offset=4+metadata.length;
    for(const file of files){const contents=new Uint8Array(await file.arrayBuffer());if(contents.length!==file.size)throw failure("No se pudo conservar un archivo del borrador.");bytes.set(contents,offset);offset+=contents.length;}
    return bytes;
}
export function unpackDraft(bytes){
    if(bytes.length<4 || bytes.length>MAX_ENTRY)throw failure("El borrador no es válido.");
    const length=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(0);
    if(length>bytes.length-4)throw failure("El borrador no está completo.");
    const metadata=JSON.parse(decoder.decode(bytes.subarray(4,4+length)));
    if(!Array.isArray(metadata.files) || metadata.files.length>30)throw failure("El borrador no es válido.");
    let offset=4+length;const files=metadata.files.map(file=>{
        if(!Number.isSafeInteger(file.size) || file.size<0 || offset+file.size>bytes.length)throw failure("El archivo conservado no está completo.");
        const result=new File([bytes.subarray(offset,offset+file.size)],String(file.name),{type:String(file.type),lastModified:file.lastModified});offset+=file.size;return result;
    });
    if(offset!==bytes.length)throw failure("El borrador contiene datos no válidos.");
    return {payload:metadata.payload,files};
}

export function indexedDraftStorage(indexedDB=globalThis.indexedDB,databaseName="bold-private-drafts"){
    let opening;
    function database(){
        if(!indexedDB)throw failure("Este navegador no permite conservar borradores. No cierres la vista sin guardar.");
        return opening ||= new Promise((resolve,reject)=>{
            const request=indexedDB.open(databaseName,VERSION);
            request.onupgradeneeded=()=>request.result.createObjectStore("drafts",{keyPath:"id"});
            request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();opening=null;};resolve(db);};
            request.onerror=()=>{opening=null;reject(request.error);};request.onblocked=()=>{opening=null;reject(failure("Cierra otras versiones de BOLD para habilitar los borradores."));};
        });
    }
    async function transaction(mode,run){
        const db=await database();return new Promise((resolve,reject)=>{
            const tx=db.transaction("drafts",mode),store=tx.objectStore("drafts");let value,reason;
            tx.oncomplete=()=>resolve(value);tx.onabort=tx.onerror=()=>reject(reason || tx.error || failure("No se pudo conservar el borrador."));
            try{run(store,result=>{value=result;},error=>{reason=error;tx.abort();});}catch(error){reason=error;tx.abort();}
        });
    }
    return {
        get:id=>transaction("readonly",(store,done)=>{const query=store.get(id);query.onsuccess=()=>done(query.result);}),
        put:(record,now)=>transaction("readwrite",(store,done,abort)=>{
            const query=store.getAll();query.onsuccess=()=>{
                const retained=query.result.filter(row=>row.expiresAt>now && row.id!==record.id);
                if(retained.length>=MAX_RECORDS || retained.reduce((sum,row)=>sum+row.ciphertext.byteLength,0)+record.ciphertext.byteLength>MAX_TOTAL){abort(failure("El almacenamiento de borradores está lleno. Conserva o descarta otros borradores antes de salir."));return;}
                for(const row of query.result)if(row.expiresAt<=now)store.delete(row.id);
                store.put(record);done(true);
            };
        }),
        remove:id=>transaction("readwrite",store=>store.delete(id)),
        purge:predicate=>transaction("readwrite",store=>{const query=store.openCursor();query.onsuccess=()=>{const cursor=query.result;if(cursor){if(predicate(cursor.value))cursor.delete();cursor.continue();}};}),
    };
}

export function createDraftVault({storage=indexedDraftStorage(),crypto=globalThis.crypto,now=Date.now}={}){
    const handles=new Set();let generation=0;
    async function open(scope,authorize){
        const openingGeneration=generation;
        if(!crypto?.subtle)throw failure("Los borradores requieren una conexión HTTPS y cifrado del navegador.");
        const grant=await authorize();
        if(canonical(grant.scope)!==canonical(scope) || !/^[a-f0-9]{32}$/.test(grant.key_id || ""))throw failure("No se pudo verificar el acceso a este borrador.");
        const raw=Uint8Array.from(atob(grant.key),char=>char.charCodeAt(0));
        if(raw.length!==32)throw failure("No se pudo verificar la clave del borrador.");
        let key=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["encrypt","decrypt"]);raw.fill(0);delete grant.key;
        if(openingGeneration!==generation)throw new DOMException("Contexto cancelado","AbortError");
        const id=draftIdentity(scope),aad=encoder.encode(`${id}:${grant.key_id}`),retention=Math.min(7*86400000,Math.max(0,grant.retention_seconds*1000 || 0));
        let active=true,queue=Promise.resolve();
        const handle={
            canWrite:grant.can_write,
            // Serializing saves/removal prevents an older encryption operation
            // from overwriting a newer draft or recreating one after logout.
            save(payload,files=[]){
                const captured=structuredClone(payload),snapshot=[...files];
                queue=queue.catch(()=>{}).then(async()=>{
                    if(!active)return false;
                    const bytes=await packDraft(captured,snapshot),iv=crypto.getRandomValues(new Uint8Array(12));let ciphertext;
                    try{if(!active)return false;ciphertext=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:aad},key,bytes);}finally{bytes.fill(0);}
                    if(!active)return false;
                    await storage.put({id,scope:{...scope},version:VERSION,keyId:grant.key_id,iv,ciphertext,updatedAt:now(),expiresAt:now()+retention},now());
                    return active;
                });return queue;
            },
            async recover(){
                const record=await storage.get(id);if(!active || !record)return null;
                if(record.version!==VERSION || record.expiresAt<=now() || record.keyId!==grant.key_id){await storage.remove(id);return null;}
                const plain=new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM",iv:record.iv,additionalData:aad},key,record.ciphertext));
                try{return active ? {...unpackDraft(plain),updatedAt:record.updatedAt,canWrite:grant.can_write}:null;}finally{plain.fill(0);}
            },
            clear(){queue=queue.catch(()=>{}).then(()=>active ? storage.remove(id):false);return queue;},
            flush:()=>queue,
            isActive:()=>active,
            close(){active=false;key=null;handles.delete(handle);},
        };
        handles.add(handle);return handle;
    }
    return {open,suspend(){generation++;for(const handle of [...handles])handle.close();},async purge(accountId){
        generation++;
        for(const handle of [...handles])handle.close();
        await storage.purge(row=>!accountId || row.scope?.account_id===accountId);
    }};
}
