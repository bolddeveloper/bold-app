import {useRef} from "react";
const palette=["#4285b5","#a65392","#328b73","#b36d35","#7e68bd","#b54e64"];
export function peerColor(identity){let hash=0;for(const char of identity || "")hash=(hash*31+char.charCodeAt(0))>>>0;return palette[hash%palette.length];}
export default function CollaborativeField({as="textarea",field,peers=[],editorRef,onChange,...props}){
    const input=useRef(null),mirror=useRef(null);
    const value=String(props.value || ""),ranges=peers.filter(peer=>peer.range?.field===field);
    const points=[...new Set([0,value.length,...ranges.flatMap(peer=>[peer.range.start,peer.range.end].map(index=>Math.min(value.length,Math.max(0,index))))])].sort((a,b)=>a-b);
    const Control=as;
    const cursor=index=>ranges.filter(peer=>peer.range.end===index).map(peer=><span key={peer.connection} className="slack_collab_caret" style={{"--peer-color":peerColor(peer.person.employee_id)}} title={peer.person.name}><span>{peer.person.name.split(" ")[0]}</span></span>);
    return <div className={`slack_collab_field ${as==="input" ? "is_title":""}`}><Control {...props} ref={input} data-page-field={field} onChange={onChange}
        onSelect={event=>editorRef.current?.select?.(field,event.currentTarget.selectionStart,event.currentTarget.selectionEnd)}
        onCompositionStart={()=>editorRef.current?.beginComposition?.(field)} onCompositionEnd={event=>editorRef.current?.endComposition?.(field,event.currentTarget.value)}
        onScroll={event=>{if(mirror.current)mirror.current.style.transform=`translate(${-event.currentTarget.scrollLeft}px,${-event.currentTarget.scrollTop}px)`;}}/>
        {ranges.length>0 && <div className="slack_collab_mirror" aria-hidden="true"><div ref={mirror}>{points.map((start,index)=>{const end=points[index+1];const peer=ranges.find(peer=>Math.min(peer.range.start,peer.range.end)<=start && Math.max(peer.range.start,peer.range.end)>start);return <span key={start}>{cursor(start)}{end!==undefined && <span style={peer ? {backgroundColor:`${peerColor(peer.person.employee_id)}33`}:undefined}>{value.slice(start,end)}</span>}</span>;})}<span> </span></div></div>}
    </div>;
}
