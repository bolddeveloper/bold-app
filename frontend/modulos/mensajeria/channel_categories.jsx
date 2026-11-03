import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Archive,ArrowDown,ArrowUp,Bell,ChevronDown,FolderPlus,GripVertical,Hash,LockKeyhole,MoreHorizontal,Pencil,Plus,Trash2,X} from 'lucide-react';
import {channelApi,channelError,createChannelRefresh} from './channel_api.js';
import {channelColor,channelServerFilters} from './channel_discovery.js';
import {ReadingScopeBadge} from './reading_reminder.jsx';
import {confirmBold,promptBold} from '../core/shared/bold_dialog.js';
import './channel_categories.css';

export default function ChannelCategories({server,channels,selectedId,loading,query,disabled,unreadFor,onSelect,onCreateChannel,onChannelChanged,onDenied}){
    const [catalog,setCatalog]=useState({results:[],can_manage:false}),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
    const [creating,setCreating]=useState(false),[name,setName]=useState(''),[collapsed,setCollapsed]=useState({}),[context,setContext]=useState(null),[dragging,setDragging]=useState(null),[over,setOver]=useState(undefined);
    const menu=useRef(null),field=useRef(null),createButton=useRef(null),active=useRef(true),request=useRef(null),pending=useRef(false),attempt=useRef(null),drag=useRef(null),refresh=useRef(null);
    const callbacks=useRef({});callbacks.current={onDenied,onChannelChanged};
    const scope=channelServerFilters(server.id),categories=catalog.results,canManage=ready && catalog.can_manage;
    const selectedCategory=channels.find(row=>row.id===selectedId)?.category_id;
    const locked=disabled || busy;
    function fail(err){if(!active.current || err.name==='AbortError')return;if([401,403,404].includes(err.status))callbacks.current.onDenied(err);else setError(channelError(err));}
    useEffect(()=>{
        active.current=true;
        const queue=createChannelRefresh(async signal=>{const result=await channelApi.categories(scope,{signal});if(!signal.aborted && active.current){setCatalog(result);setReady(true);}},fail);refresh.current=queue;queue.request();
        const changed=event=>{const payload=event.detail?.payload;if(!payload || payload.kind==='channel.categories_changed' && payload.scope===server.id)queue.request();};
        window.addEventListener('bold:slack-event',changed);window.addEventListener('bold:messaging-reconnect',changed);
        return()=>{active.current=false;request.current?.abort();queue.dispose();window.removeEventListener('bold:slack-event',changed);window.removeEventListener('bold:messaging-reconnect',changed);};
    },[server.id]);
    useEffect(()=>{if(creating)field.current?.focus();},[creating]);
    useEffect(()=>{if(selectedCategory)setCollapsed(value=>value[selectedCategory] ? {...value,[selectedCategory]:false}:value);},[selectedId,selectedCategory]);
    useLayoutEffect(()=>{
        if(!context || !menu.current)return;const node=menu.current;node.showPopover?.();
        node.style.left=`${Math.max(12,Math.min(context.x,window.innerWidth-node.offsetWidth-12))}px`;
        node.style.top=`${Math.max(12,Math.min(context.y,window.innerHeight-node.offsetHeight-12))}px`;
        (node.querySelector('select') || node.querySelector('button:not(:disabled)'))?.focus();
        return()=>node.hidePopover?.();
    },[context]);
    function openMenu(kind,event,row=null){event.preventDefault();event.stopPropagation();const rect=event.currentTarget.getBoundingClientRect();setContext({kind,row,anchor:event.currentTarget,x:event.clientX || rect.left,y:event.clientY || rect.bottom});}
    function closeMenu(){setContext(null);context?.anchor?.focus();}
    async function create(event){
        event.preventDefault();if(pending.current || locked || !name.trim())return;
        pending.current=true;setBusy(true);setError('');setNotice('');const controller=new AbortController();request.current=controller;
        const values=attempt.current || {name:name.trim(),client_id:crypto.randomUUID()};attempt.current=values;
        try{const result=await channelApi.createCategory(scope,values,{signal:controller.signal});if(active.current && !controller.signal.aborted){setCatalog(result);attempt.current=null;setName('');setCreating(false);setNotice('Categoría creada. Puedes arrastrar canales a ella.');createButton.current?.focus();}}
        catch(err){if(!controller.signal.aborted){if([400,401,403,404,409].includes(err.status))attempt.current=null;fail(err);}}
        finally{pending.current=false;if(active.current && !controller.signal.aborted)setBusy(false);}
    }
    async function changeCategory(row,deleting=false){
        if(pending.current || locked || !canManage)return;
        closeMenu();
        const value=deleting ? await confirmBold(`¿Eliminar «${row.name}»? Sus canales quedarán sin categoría. No se eliminarán canales, mensajes ni permisos.`,{title:'Eliminar categoría'}):await promptBold('Nombre de la categoría',row.name);
        if(value===null || value===false || !active.current || pending.current)return;
        const name=deleting ? null:value.trim();
        if(!deleting && (!name || name.length>80)){setError('El nombre debe tener entre 1 y 80 caracteres.');return;}
        pending.current=true;setBusy(true);setError('');setNotice('');
        const controller=new AbortController();request.current=controller;
        try{
            const result=deleting ? await channelApi.deleteCategory(scope,row.id,{version:row.version},{signal:controller.signal}):await channelApi.updateCategory(scope,row.id,{name,version:row.version},{signal:controller.signal});
            if(active.current && !controller.signal.aborted){
                setCatalog(result);setNotice(deleting ? 'Categoría eliminada. Sus canales siguen disponibles sin categoría.':'Nombre de categoría actualizado.');
                if(deleting){createButton.current?.focus();window.dispatchEvent(new CustomEvent('bold:slack-event',{detail:{payload:{kind:'channel.categories_changed',scope:server.id}}}));}
            }
        }catch(err){if(!controller.signal.aborted){fail(err);refresh.current?.request();}}
        finally{pending.current=false;if(active.current && !controller.signal.aborted)setBusy(false);}
    }
    async function moveCategory(row,beforeId){
        if(pending.current || locked || !canManage || row.id===beforeId)return;
        pending.current=true;setBusy(true);setError('');setNotice('');closeMenu();
        const controller=new AbortController();request.current=controller;
        const ordered=categories.filter(item=>item.id!==row.id),index=ordered.findIndex(item=>item.id===beforeId);ordered.splice(index<0 ? ordered.length:index,0,row);setCatalog(value=>({...value,results:ordered}));
        try{const result=await channelApi.moveCategory(scope,row.id,{version:row.version,before_id:beforeId},{signal:controller.signal});if(active.current && !controller.signal.aborted){setCatalog(result);setNotice(`${row.name} se movió con sus canales.`);}}
        catch(err){if(!controller.signal.aborted){fail(err);refresh.current?.request();}}
        finally{pending.current=false;if(active.current && !controller.signal.aborted)setBusy(false);}
    }
    async function moveChannel(row,categoryId){
        if(pending.current || locked || !row.can_manage || (row.category_id || null)===categoryId)return;
        pending.current=true;setBusy(true);setError('');setNotice('');closeMenu();
        const controller=new AbortController();request.current=controller;
        try{const result=await channelApi.moveChannelCategory(scope,row.id,{version:row.version,category_id:categoryId},{signal:controller.signal});if(active.current && !controller.signal.aborted){callbacks.current.onChannelChanged(result.channel);if(categoryId)setCollapsed(value=>({...value,[categoryId]:false}));setNotice(`Canal movido a ${categories.find(item=>item.id===categoryId)?.name || 'Canales de texto'}.`);}}
        catch(err){if(!controller.signal.aborted){fail(err);refresh.current?.request();window.dispatchEvent(new CustomEvent('bold:slack-event',{detail:{payload:{kind:'channel.categories_changed',scope:server.id}}}));}}
        finally{pending.current=false;if(active.current && !controller.signal.aborted)setBusy(false);}
    }
    function begin(event,kind,row){
        if(locked || event.target.closest('[data-no-drag]')){event.preventDefault();return;}
        const value={kind,id:row.id};drag.current=value;setDragging(value);setContext(null);
        event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-bold-slack-organization',JSON.stringify({...value,scope:server.id}));
    }
    function finish(){drag.current=null;setDragging(null);setOver(undefined);}
    function hover(event,categoryId){if(!drag.current || locked)return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';setOver(categoryId);}
    function drop(event,categoryId){
        if(!drag.current || locked)return;event.preventDefault();event.stopPropagation();const value=drag.current;finish();
        if(value.kind==='channel'){const row=channels.find(item=>item.id===value.id);if(row)moveChannel(row,categoryId);}
        else{const row=categories.find(item=>item.id===value.id);if(row)moveCategory(row,categoryId);}
    }
    function channelRow(row){const count=unreadFor(row);return <div key={row.id} className={`slack_channel_item ${dragging?.kind==='channel' && dragging.id===row.id ? 'is_dragging':''}`} draggable={!locked && row.can_manage} onDragStart={event=>begin(event,'channel',row)} onDragEnd={finish} onContextMenu={event=>{if(row.can_manage && ready)openMenu('channel',event,row);}}>
        <button type="button" draggable={!locked && row.can_manage} style={{'--channel-color':channelColor(row)}} aria-current={selectedId===row.id ? 'page':undefined} aria-label={count>0 ? `${row.name}, ${count} ${count===1 ? 'mensaje':'mensajes'} sin leer`:undefined} disabled={locked} onClick={()=>onSelect(row)}><Hash className="slack_channel_hash" size={17} aria-hidden="true"/><span>{row.name}<ReadingScopeBadge channelId={row.id}/></span>{row.visibility==='private' && <LockKeyhole size={12} aria-label="Privado"/>}{row.following && <Bell size={14} aria-label="Siguiendo"/>}{count>0 && <strong className="slack_unread_badge" aria-hidden="true">{count>99 ? '99+':count}</strong>}{row.archived_at && <Archive size={15} aria-label="Archivado"/>}</button>
        {row.can_manage && ready && <button type="button" className="slack_channel_move" aria-label={`Mover canal ${row.name}`} title="Mover a una categoría" disabled={locked} onClick={event=>openMenu('channel',event,row)}><MoreHorizontal size={14}/></button>}
    </div>;}
    const known=new Set(categories.map(row=>row.id)),loose=channels.filter(row=>!row.category_id || !known.has(row.category_id));
    return <>
        <div className={`slack_channel_group_title ${over===null && dragging?.kind==='channel' ? 'slack_organization_drop':''}`} onDragOver={event=>{if(drag.current?.kind==='channel')hover(event,null);}} onDrop={event=>{if(drag.current?.kind==='channel')drop(event,null);}}><span>Canales de texto</span>{server.can_create && <button type="button" aria-label="Crear canal" title="Crear canal en este servidor" disabled={locked} onClick={()=>onCreateChannel(null)}><Plus size={16}/></button>}</div>
        {canManage && <button ref={createButton} type="button" className="slack_create_category" disabled={locked} onClick={()=>setCreating(value=>!value)}><FolderPlus size={15}/>Crear categoría</button>}
        {creating && <form className="slack_category_form" aria-label="Crear categoría" onSubmit={create} onKeyDown={event=>{if(event.key==='Escape' && !busy){event.preventDefault();event.stopPropagation();setCreating(false);createButton.current?.focus();}}}><header><span><FolderPlus size={14} aria-hidden="true"/>Nueva categoría</span><button type="button" aria-label="Cancelar categoría" disabled={busy} onClick={()=>{setCreating(false);createButton.current?.focus();}}><X size={15}/></button></header><label>Nombre de la categoría<input ref={field} value={name} maxLength={80} required placeholder="Ej. App BOLD" disabled={busy || !!attempt.current} onChange={event=>setName(event.target.value)}/></label><footer><small>Agrupa tus canales.</small><button type="submit" className="slack_primary" disabled={busy || !name.trim()}>{busy ? 'Creando…':attempt.current ? 'Reintentar':'Crear'}</button></footer></form>}
        {error && <p className="slack_categories_error" role="alert">{error}<button type="button" disabled={locked} onClick={()=>refresh.current?.request()}>Actualizar categorías</button></p>}
        <nav className="slack_categorized_channels" aria-label="Canales" aria-busy={loading || busy} tabIndex={0} onContextMenu={event=>{if(!event.target.closest('.slack_channel_item,.slack_category_header'))openMenu('blank',event);}} onKeyDown={event=>{if(event.key==='Escape'){finish();if(context){event.stopPropagation();closeMenu();}}else if(event.target===event.currentTarget && (event.key==='ContextMenu' || event.key==='F10' && event.shiftKey))openMenu('blank',event);}} onDragOver={event=>{if(event.target===event.currentTarget)hover(event,null);}} onDrop={event=>drop(event,null)}>
            <div className="slack_uncategorized" onDragOver={event=>{if(drag.current?.kind==='channel')hover(event,null);}} onDrop={event=>{if(drag.current?.kind==='channel')drop(event,null);}}>{loose.map(channelRow)}{dragging?.kind==='channel' && !loose.length && <small>Soltar sin categoría</small>}</div>
            {categories.map(category=>{const items=channels.filter(row=>row.category_id===category.id),folded=!!collapsed[category.id] && !query;if(query && !items.length)return null;return <section key={category.id} className={`slack_category ${over===category.id ? 'slack_organization_drop':''} ${dragging?.kind==='category' && dragging.id===category.id ? 'is_dragging':''}`} data-category={category.id} onDragOver={event=>hover(event,category.id)} onDrop={event=>drop(event,category.id)}>
                <div className="slack_category_header" draggable={canManage && !locked} onDragStart={event=>begin(event,'category',category)} onDragEnd={finish} onContextMenu={event=>{if(canManage && !locked)openMenu('category',event,category);}}>
                    {canManage && <GripVertical size={12} className="slack_category_grip" aria-hidden="true"/>}<button type="button" draggable={canManage && !locked} className="slack_category_toggle" aria-expanded={!folded} disabled={locked} onClick={()=>setCollapsed(value=>({...value,[category.id]:!folded}))}><ChevronDown size={13} aria-hidden="true"/><span>{category.name}</span></button>
                    {server.can_create && <button type="button" data-no-drag aria-label={`Crear canal en ${category.name}`} disabled={locked} onClick={()=>onCreateChannel(category.id)}><Plus size={15}/></button>}
                    {canManage && <button type="button" data-no-drag aria-label={`Opciones de categoría ${category.name}`} disabled={locked} onClick={event=>openMenu('category',event,category)}><MoreHorizontal size={14}/></button>}
                </div>
                <div className="slack_category_content" hidden={folded}>{items.map(channelRow)}{!items.length && !loading && <p className="slack_category_empty">{dragging?.kind==='channel' ? 'Soltar canal aquí':'Sin canales en esta categoría'}</p>}</div>
            </section>;})}
            {dragging?.kind==='category' && <div className={`slack_category_last ${over===null ? 'slack_organization_drop':''}`} onDragOver={event=>hover(event,null)} onDrop={event=>drop(event,null)}>Mover categoría al final</div>}
            {!channels.length && !categories.length && <p className="slack_search_empty" role="status">{loading ? 'Buscando canales…':query ? 'No hay coincidencias en este servidor.':'Este servidor todavía no tiene canales disponibles con tu acceso.'}</p>}
        </nav>
        <span role="status" className="slack_organization_status">{busy ? 'Guardando organización…':notice}</span>
        {context && <div ref={menu} popover="auto" className="slack_organization_menu" role="group" aria-label="Organizar canales" onToggle={event=>{if(event.newState==='closed')setContext(null);}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeMenu();}}}>
            <header><strong>{context.kind==='blank' ? server.name:context.row.name}</strong><button type="button" aria-label="Cerrar opciones de organización" onClick={closeMenu}><X size={15}/></button></header>
            {context.kind==='blank' && <>{server.can_create && <button type="button" disabled={locked} onClick={()=>{closeMenu();onCreateChannel(null);}}><Plus size={16}/>Crear canal</button>}{canManage && <button type="button" disabled={locked} onClick={()=>{closeMenu();setCreating(true);}}><FolderPlus size={16}/>Crear categoría</button>}{!server.can_create && !canManage && <p>Organización de solo lectura.</p>}</>}
            {context.kind==='category' && <><button type="button" disabled={locked || !canManage} onClick={()=>changeCategory(context.row)}><Pencil size={15}/>Editar nombre</button><button type="button" disabled={locked || categories[0]?.id===context.row.id} onClick={()=>moveCategory(context.row,categories[categories.findIndex(row=>row.id===context.row.id)-1]?.id || null)}><ArrowUp size={15}/>Subir categoría</button><button type="button" disabled={locked || categories.at(-1)?.id===context.row.id} onClick={()=>moveCategory(context.row,categories[categories.findIndex(row=>row.id===context.row.id)+2]?.id || null)}><ArrowDown size={15}/>Bajar categoría</button><button type="button" className="slack_category_delete" disabled={locked || !canManage} onClick={()=>changeCategory(context.row,true)}><Trash2 size={15}/>Eliminar categoría</button></>}
            {context.kind==='channel' && <label>Mover a categoría<select aria-label="Categoría de destino" value={context.row.category_id || ''} disabled={locked} onChange={event=>moveChannel(context.row,event.target.value || null)}><option value="">Sin categoría</option>{categories.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select><small>Conserva las personas y los permisos del canal.</small></label>}
        </div>}
    </>;
}
