import {useEffect,useLayoutEffect,useRef} from "react";
import {channelApi} from "./channel_api.js";
import {createChannelReader} from "./channel_reader.js";

export function useChannelReader({channelId,parentId,messages,viewport,enabled,onRead,onError}) {
    const reader=useRef(null),callbacks=useRef({onRead,onError});callbacks.current={onRead,onError};
    useLayoutEffect(()=>{
        if(!enabled || !channelId) return;
        const queue=createChannelReader({mark:(message,options)=>channelApi.read(channelId,message,options),onRead:value=>callbacks.current.onRead(value),onError:error=>callbacks.current.onError(error)});
        reader.current=queue;return ()=>{queue.dispose();if(reader.current===queue)reader.current=null;};
    },[channelId,parentId,enabled]);
    useEffect(()=>{
        if(!enabled || !reader.current || !viewport.current || typeof IntersectionObserver==="undefined") return;
        const host=viewport.current,byId=new Map(messages.map(row=>[row.id,row]));
        const check=()=>{
            if(document.hidden || !document.hasFocus()) return;
            if(document.querySelector('dialog[open]') || [...document.querySelectorAll('[aria-modal="true"]')].some(node=>node.getClientRects().length>0)) return;
            const bounds=host.getBoundingClientRect();let latest=null;
            for(const node of host.querySelectorAll("[data-slack-message]")) {
                const box=node.getBoundingClientRect(),message=byId.get(node.dataset.slackMessage);
                if(message && box.height>0 && box.bottom>bounds.top && box.top<bounds.bottom && (!latest || message.sequence>latest.sequence)) latest=message;
            }
            if(latest) reader.current?.observe(latest);
        };
        const observer=new IntersectionObserver(check,{root:host,threshold:[0,.5,1]});
        host.querySelectorAll("[data-slack-message]").forEach(node=>observer.observe(node));
        window.addEventListener("focus",check);document.addEventListener("visibilitychange",check);document.addEventListener("focusin",check);check();
        return ()=>{observer.disconnect();window.removeEventListener("focus",check);document.removeEventListener("visibilitychange",check);document.removeEventListener("focusin",check);};
    },[channelId,parentId,enabled,messages]);
    return ()=>reader.current?.observe(messages.at(-1));
}
