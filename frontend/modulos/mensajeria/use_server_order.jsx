import {useEffect,useRef,useState} from 'react';
import {channelApi,channelError} from './channel_api.js';
import {moveServer,orderedServers} from './server_order.js';

export function useServerOrder({rows,identity,disabled,list,onContext}){
    const [order,setOrder]=useState(null),[preview,setPreview]=useState(null),[dragging,setDragging]=useState(null);
    const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
    const operation=useRef(null),loading=useRef(null),gesture=useRef(null),suppress=useRef(0),suppressNode=useRef(null),alive=useRef(true),current=useRef(null);
    const ordered=orderedServers(rows,preview || order || []);
    current.current={rows:ordered,order,disabled,busy,onContext};
    function stop(){
        const value=gesture.current;gesture.current=null;
        if(value){clearTimeout(value.timer);clearInterval(value.scroll);try{value.node.releasePointerCapture?.(value.pointerId);}catch{}}
        return value;
    }
    async function load(){
        loading.current?.abort();const controller=new AbortController();loading.current=controller;setError('');
        try{
            const value=await channelApi.serverOrder({signal:controller.signal});
            if(!Array.isArray(value) || value.some(id=>typeof id!=='string'))throw Error('Orden de servidores no válido.');
            if(!controller.signal.aborted)setOrder(value);
        }catch(err){if(!controller.signal.aborted)setError(channelError(err));}
    }
    useEffect(()=>{alive.current=true;load();return()=>{alive.current=false;stop();loading.current?.abort();operation.current?.abort();};},[identity]);
    async function save(next){
        const state=current.current;
        if(state.disabled || state.order===null || operation.current || JSON.stringify(next)===JSON.stringify(state.order))return;
        const previous=state.order,controller=new AbortController();operation.current=controller;
        setOrder(next);setBusy(true);setError('');setNotice('Guardando tu orden de servidores…');
        try{
            await channelApi.saveServerOrder(next,{signal:controller.signal});
            if(alive.current && !controller.signal.aborted)setNotice('Orden guardado solo para tu cuenta.');
        }catch(err){if(alive.current && !controller.signal.aborted){setOrder(previous);setNotice('');setError('No se guardó el orden. '+channelError(err));}}
        finally{if(operation.current===controller)operation.current=null;if(alive.current && !controller.signal.aborted)setBusy(false);}
    }
    function hover(value){
        const host=list.current;if(!host || !value.active)return;
        const rect=host.getBoundingClientRect();
        if(value.y<rect.top+24)host.scrollTop-=10;
        else if(value.y>rect.bottom-24)host.scrollTop+=10;
        const target=document.elementFromPoint?.(value.x,value.y)?.closest('[data-server-id]');
        if(!target || !host.contains(target))return;
        const id=target.dataset.serverId;if(id===value.id)return;
        const box=target.getBoundingClientRect();
        value.next=moveServer(value.next,value.ids,value.id,id,value.y>box.top+box.height/2);value.moved=true;
        setPreview(previous=>JSON.stringify(previous)===JSON.stringify(value.next) ? previous:value.next);
    }
    function activate(value){
        if(gesture.current!==value || current.current.disabled)return;
        clearTimeout(value.timer);value.active=true;suppress.current=Infinity;suppressNode.current=value.node;
        try{value.node.setPointerCapture?.(value.pointerId);}catch{}
        setDragging(value.id);setNotice('Arrastra el servidor. Suelta para guardar; Escape cancela.');
        value.scroll=setInterval(()=>hover(value),50);
    }
    function start(event,id){
        const state=current.current;
        if(event.button!==0 || event.isPrimary===false || state.disabled || state.busy || state.order===null)return;
        stop();const value={id,node:event.currentTarget,pointerId:event.pointerId,pointerType:event.pointerType,
            x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,ids:state.rows.map(row=>row.id),
            next:[...new Set([...state.order,...state.rows.map(row=>row.id)])],active:false};
        gesture.current=value;value.timer=setTimeout(()=>activate(value),event.pointerType==='touch' ? 350:160);
    }
    useEffect(()=>{
        function move(event){
            const value=gesture.current;if(!value || event.pointerId!==value.pointerId)return;
            value.x=event.clientX;value.y=event.clientY;
            if(!value.active && Math.hypot(value.x-value.startX,value.y-value.startY)>7){
                if(value.pointerType==='touch'){stop();return;}
                activate(value);
            }
            if(value.active){event.preventDefault();hover(value);}
        }
        function finish(event){
            const value=gesture.current;if(!value || event.pointerId!==value.pointerId)return;
            stop();setPreview(null);setDragging(null);
            if(!value.active)return;
            suppress.current=Date.now()+400;
            if(event.type==='pointercancel'){setNotice('Movimiento cancelado.');return;}
            const box=list.current?.getBoundingClientRect();
            if(!box || value.x<box.left || value.x>box.right || value.y<box.top || value.y>box.bottom){setNotice('Movimiento cancelado.');return;}
            if(value.moved)save(value.next);
            else if(value.pointerType==='touch'){
                const state=current.current,row=state.rows.find(row=>row.id===value.id),box=value.node.getBoundingClientRect();
                setNotice('Opciones para ordenar este servidor.');if(row)state.onContext(row,value.node,box.right,box.top);
            }else setNotice('Sin cambios de orden.');
        }
        function escape(event){if(event.key==='Escape' && gesture.current){event.preventDefault();stop();setPreview(null);setDragging(null);suppress.current=Date.now()+400;setNotice('Movimiento cancelado.');}}
        const touch=event=>{if(gesture.current?.active)event.preventDefault();};
        window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',finish);
        window.addEventListener('keydown',escape);list.current?.addEventListener('touchmove',touch,{passive:false});
        const host=list.current;
        return()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',finish);window.removeEventListener('keydown',escape);host?.removeEventListener('touchmove',touch);};
    },[]);
    useEffect(()=>{if(disabled){const value=stop();setPreview(null);setDragging(null);if(value?.active)suppress.current=Date.now()+400;}},[disabled]);
    function step(id,direction){
        const state=current.current,ids=state.rows.map(row=>row.id),index=ids.indexOf(id),target=ids[index+direction];
        if(target)save(moveServer(state.order || [],ids,id,target,direction>0));
    }
    return {rows:ordered,dragging,busy,error,notice,ready:order!==null,reload:load,start,step,
        context:(row,anchor,x,y)=>{if(!gesture.current?.active)onContext(row,anchor,x,y);},
        click:event=>{if(Date.now()<suppress.current && event.target.closest('[data-server-id]')===suppressNode.current){event.preventDefault();event.stopPropagation();suppress.current=0;}},
        key:(event,id)=>{if(event.altKey && ['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();event.stopPropagation();step(id,event.key==='ArrowUp' ? -1:1);}}};
}
