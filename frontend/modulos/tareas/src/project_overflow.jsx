import {useRef} from 'react';
import {createPortal} from 'react-dom';
import {useAnchoredPopover} from '../../core/shared/use_anchored_popover.js';
import './project_overflow.css';

export default function ProjectOverflow({open,anchorRef,onClose,label,actions,className=''}) {
    const panel=useRef(null);
    useAnchoredPopover(open,anchorRef,panel,{minWidth:210,maxWidth:240,maxHeight:260,gap:6});
    function close(){panel.current?.hidePopover?.();onClose();anchorRef.current?.focus({preventScroll:true});}
    return open && createPortal(<div ref={panel} popover="auto" role="dialog" aria-label={label} className={`bold_project_overflow ${className}`} onToggle={event=>{if(event.newState==='closed')onClose();}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}}}>
        {actions.map(({label,icon:Icon,run,danger})=><button key={label} type="button" className={danger?'danger_menu_item':''} onClick={()=>{close();run();}}>{Icon&&<Icon size={15} aria-hidden="true"/>}<span>{label}</span></button>)}
    </div>,document.body);
}
