import {useEffect,useRef,useState} from 'react';
import {ImagePlus} from 'lucide-react';
import {transferredFiles} from './file_transfer.js';
import './file_transfer.css';

// Each visible composer owns its files; never intercept another editor or a modal.
export function useFileTransfer({disabled,onFiles,field,context}) {
    const [dragging,setDragging]=useState(false),depth=useRef(0);
    function reset(){depth.current=0;setDragging(false);}
    useEffect(()=>{reset();},[disabled,context]);
    useEffect(()=>{
        if(!dragging)return;
        window.addEventListener('dragend',reset);window.addEventListener('drop',reset);window.addEventListener('blur',reset);
        return()=>{window.removeEventListener('dragend',reset);window.removeEventListener('drop',reset);window.removeEventListener('blur',reset);};
    },[dragging]);
    function blocked(event) {
        const target=event.target;
        const editable=target.closest?.('input,textarea,[contenteditable="true"]');
        const separate=target.closest?.('[inert],[role="dialog"],[popover]');
        return disabled || separate && event.currentTarget.contains(separate) || editable && editable!==field?.current;
    }
    const isFileDrag=event=>Array.from(event.dataTransfer?.types || []).includes('Files');
    return {dragging:dragging && !disabled,bindings:{
        onDropCapture:reset,
        onPaste(event){
            if(event.defaultPrevented || blocked(event))return;
            const files=transferredFiles(event.clipboardData);if(!files.length)return;
            event.preventDefault();event.stopPropagation();onFiles(files);
        },
        onDragEnter(event){if(event.defaultPrevented || !isFileDrag(event))return;event.preventDefault();if(!blocked(event)){depth.current++;setDragging(true);}},
        onDragOver(event){if(event.defaultPrevented || !isFileDrag(event))return;event.preventDefault();event.dataTransfer.dropEffect=blocked(event) ? 'none':'copy';},
        onDragLeave(event){if(!isFileDrag(event))return;if(--depth.current<=0)reset();},
        onDrop(event){
            reset();if(event.defaultPrevented)return;
            const files=transferredFiles(event.dataTransfer);if(!files.length)return;
            event.preventDefault();event.stopPropagation();if(!blocked(event))onFiles(files);
        }
    }};
}
export function FileDropHint({label='Suelta imágenes o archivos aquí'}) {
    return <div className="bold_file_drop_hint" role="status"><ImagePlus size={28} aria-hidden="true"/><strong>{label}</strong><span>Revisa el contenido antes de enviar</span></div>;
}
