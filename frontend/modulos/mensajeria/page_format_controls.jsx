import {useEffect,useState} from 'react';
import {Bold,Italic,Strikethrough,Code,Link,Unlink,RemoveFormatting,X} from 'lucide-react';
import {useDialog} from '../core/shared/use_dialog.js';
import {registerPrivateWork} from '../core/shared/private_work.js';
import {rangeHasFormat,safePageHref} from './page_formats.js';
import {codeLanguages} from './page_formats.js';
import CollaborativeField from './collaborative_field.jsx';
import {RichPageText} from './page_rich_text.jsx';

export function FormatControls({row,index,disabled,onAction}){
    const [open,setOpen]=useState(false),[range,setRange]=useState({start:0,end:0});
    useEffect(()=>{
        if(!open)return;
        const read=()=>{const field=document.querySelector(`[data-page-field="${row.id}"]`);if(field)setRange({start:field.selectionStart,end:field.selectionEnd});};
        read();document.addEventListener('selectionchange',read);return()=>document.removeEventListener('selectionchange',read);
    },[open,row.id]);
    const styles=[['bold','Negrita',Bold],['italic','Cursiva',Italic],['strike','Tachado',Strikethrough],['code','Código en línea',Code]];
    return <details className="slack_page_format_controls" onToggle={event=>setOpen(event.currentTarget.open)}><summary>Formato del bloque {index+1}</summary><div role="group" aria-label={`Formato del bloque ${index+1}`}>
        {styles.map(([kind,label,Icon])=><button key={kind} type="button" disabled={disabled} aria-label={label} title={label} aria-pressed={rangeHasFormat(row.text,row.formats,range.start,range.end,kind)} onClick={()=>onAction(row,kind)}><Icon size={17} aria-hidden="true"/></button>)}
        <button type="button" disabled={disabled} aria-label="Enlace externo con alias" title="Enlace externo con alias" onClick={()=>onAction(row,'link')}><Link size={17} aria-hidden="true"/></button>
        <button type="button" disabled={disabled} aria-label="Quitar enlace del texto" title="Quitar enlace del texto" onClick={()=>onAction(row,'unlink')}><Unlink size={17} aria-hidden="true"/></button>
        <button type="button" disabled={disabled} aria-label="Quitar formato del texto" title="Quitar formato del texto" onClick={()=>onAction(row,'clear')}><RemoveFormatting size={17} aria-hidden="true"/></button>
    </div><small>Selecciona texto para darle formato. Enlace también permite insertar un nombre en el cursor. Vista previa muestra el resultado completo.</small></details>;
}

export function ExternalPageLink({selected,url='',onClose,onConfirm}){
    const [href,setHref]=useState(url),[alias,setAlias]=useState(selected),[error,setError]=useState('');
    const dirty=href!==url || alias!==selected;
    useEffect(()=>{if(!dirty)return;const guard=registerPrivateWork(()=>false),leave=event=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',leave);return()=>{guard();window.removeEventListener('beforeunload',leave);};},[dirty]);
    useDialog(true,'.slack_page_external_link',onClose);
    function submit(event){event.preventDefault();setError('');try{const value=safePageHref(href.trim());if(alias && !alias.trim())throw Error('El nombre del enlace no puede ser solo espacios.');onConfirm(value,alias || value);}catch(error){setError(error.message);}}
    return <div className="slack_editor_scrim"><section className="slack_editor slack_page_external_link" role="dialog" aria-modal="true" aria-labelledby="external_page_link_title"><header><h2 id="external_page_link_title">Enlace externo</h2><button type="button" aria-label="Cerrar enlace externo" onClick={onClose}><X size={20} aria-hidden="true"/></button></header>
        <p>El enlace y su nombre serán visibles para quienes puedan leer esta página. No se copia el contenido del sitio ni se amplían permisos de BOLD.</p>
        <form onSubmit={submit}><label>Dirección del enlace<input type="url" maxLength={2048} required value={href} onChange={event=>setHref(event.target.value)} autoComplete="off"/></label><label>Nombre del enlace (opcional)<input maxLength={4000} value={alias} onChange={event=>setAlias(event.target.value)}/></label><small>Si lo dejas vacío, se mostrará la dirección completa. Para quitarlo, selecciona su texto y usa Quitar enlace.</small>
        {error && <p role="alert">{error}</p>}<footer><button type="button" onClick={onClose}>Cancelar</button><button type="submit" className="slack_primary">Aplicar enlace</button></footer></form>
    </section></div>;
}

export function TextBlockContent({row,index,label,editable,peers,editorRef,onChange,onFormat,mentions}){
    return <>{row.type==='check' && <input type="checkbox" aria-label={`Completar bloque ${index+1}`} checked={!!row.checked} disabled={!editable} onChange={event=>onChange({checked:event.target.checked})}/>}
        <div className="slack_page_text_block"><label><span>{label} {index+1}</span><CollaborativeField field={row.id} peers={peers} editorRef={editorRef} aria-label={`${label} ${index+1}`} rows={row.type==='heading' ? 1:row.type==='code' ? 5:2} maxLength={4000} spellCheck={row.type==='code' ? false:undefined} value={row.text} disabled={!editable} onChange={event=>onChange({text:event.target.value})}/></label>
            {row.type==='code' ? <label className="slack_page_code_language">Lenguaje del bloque {index+1}<select disabled={!editable} value={row.language || 'text'} onChange={event=>onChange({language:event.target.value})}>{Object.entries(codeLanguages).map(([value,name])=><option key={value} value={value}>{name}</option>)}</select><small>Se guarda como texto. No se ejecuta ni envía avisos por menciones.</small></label>:<FormatControls row={row} index={index} disabled={!editable} onAction={onFormat}/>}
            {row.formats?.length>0 && <section className="slack_page_formatted_preview" aria-label={`Vista formateada del bloque ${index+1}`}><small>Vista formateada</small><div><RichPageText text={row.text} formats={row.formats} mentions={mentions}/></div></section>}
        </div></>;
}
