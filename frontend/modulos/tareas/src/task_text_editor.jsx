import { useEffect, useRef, useState } from "react";
import { ArrowUp, Bold, ChevronDown, ImagePlus, Italic, Link, List, ListOrdered, Redo2, Strikethrough, Underline, Undo2 } from "lucide-react";
import { ImageGallery } from "./image_gallery.jsx";
import { VoiceNotes } from "./voice_notes.jsx";
import { editorDisplayHTML, inlineTextClasses, richTextPrefix, saveRichText, richImageSources } from "./rich_text.js";

const formats = [["Deshacer", "undo", Undo2], ["Rehacer", "redo", Redo2], ["Negrita", "bold", Bold], ["Cursiva", "italic", Italic], ["Tachado", "strikeThrough", Strikethrough], ["Subrayado", "underline", Underline], ["Lista", "insertUnorderedList", List], ["Lista numerada", "insertOrderedList", ListOrdered]];
const textStyles = [["3", "Texto normal"], ["5", "Título"], ["4", "Subtítulo"], ["2", "Cita"]];

export function TaskText({ value, className = "", imageTaskId, imageHistory = false, imageSection, imageProjectId }) {
    if (!value?.startsWith(richTextPrefix)) return <div className={`task_formatted_text ${className}`}>{value}</div>;
    const images = richImageSources(value);
    return <div className={`task_formatted_text ${className}`}>
        <ImageGallery images={images} taskId={imageTaskId} history={imageHistory} imageSection={imageSection} imageProjectId={imageProjectId}/>
        <div className="task_text_body" dangerouslySetInnerHTML={{__html: editorDisplayHTML(value)}}/>
    </div>;
}

export function TextEditorField({ name, defaultValue = "", value, onChange, maxLength, ...props }) {
    const [draft, setDraft] = useState(defaultValue);
    const current = value === undefined ? draft : value;
    return <div className="app_text_editor_field"><TaskTextEditor {...props} maxLength={maxLength} value={current} onChange={next => { setDraft(next); onChange?.(next); }} />{name && <input type="hidden" name={name} value={current} />}</div>;
}

export function TaskTextEditor({ value = "", onChange, label = "Descripción", placeholder = "Escribe una descripción…", notes = [], onNotesChange, onBusyChange, resource = "tasks", resourceId, disabled = false, onFiles, onSubmit, submitDisabled = false, compact = !!onSubmit, maxLength, allowImages = true }) {
    const editor = useRef(null), selection = useRef(null), lastValue = useRef(value), controls = useRef(null), styleMenu = useRef(null);
    const [linkOpen, setLinkOpen] = useState(false), [link, setLink] = useState("https://"), [linkError, setLinkError] = useState("");
    const [style, setStyle] = useState("Texto normal");
    const [limitReached, setLimitReached] = useState(false);
    const [imageError, setImageError] = useState("");
    const [imagesBusy, setImagesBusy] = useState(false);
    const images = richImageSources(value);
    useEffect(() => {
        const closeMenu = event => { if (styleMenu.current && !styleMenu.current.contains(event.target)) styleMenu.current.open = false; };
        document.addEventListener("pointerdown", closeMenu);
        return () => document.removeEventListener("pointerdown", closeMenu);
    }, []);
    useEffect(() => {
        if (editor.current && (lastValue.current !== value || !editor.current.dataset.ready)) {
            editor.current.innerHTML = editorDisplayHTML(value, true); editor.current.dataset.ready = "true"; lastValue.current = value; selection.current = null;
        }
    }, [value]);
    const remember = () => {
        const current = window.getSelection();
        if (current?.rangeCount && editor.current?.contains(current.anchorNode)) {
            selection.current = current.getRangeAt(0).cloneRange();
            const node = current.anchorNode.nodeType === Node.ELEMENT_NODE ? current.anchorNode : current.anchorNode.parentElement;
            const inline = node.closest("font, span[class]");
            const size = inline?.tagName === "FONT" ? inline.getAttribute("size") : Object.entries(inlineTextClasses).find(([, name]) => inline?.className === name)?.[0];
            setStyle(textStyles.find(([id]) => id === size)?.[1] || "Texto normal");
        }
    };
    const save = () => { const next = saveRichText(editor.current.innerHTML); if (maxLength && editor.current.textContent.length > maxLength) { editor.current.innerHTML = editorDisplayHTML(lastValue.current, true); selection.current = null; setLimitReached(true); return; } setLimitReached(false); lastValue.current = next; onChange(next); remember(); };
    const command = (name, argument) => {
        if (disabled) return;
        editor.current.focus();
        if (selection.current && editor.current.contains(selection.current.commonAncestorContainer)) { const current = window.getSelection(); current.removeAllRanges(); current.addRange(selection.current); }
        document.execCommand(name, false, argument); save();
    };
    const changeStyle = size => {
        command("fontSize", size);
        setStyle(textStyles.find(([id]) => id === size)[1]);
        styleMenu.current.open = false;
    };
    function insertLink() {
        let url;
        try { url = new URL(link); } catch { setLinkError("Introduce un enlace válido."); return; }
        if (!["http:", "https:"].includes(url.protocol)) { setLinkError("Usa http:// o https://."); return; }
        if (selection.current?.collapsed) command("insertText", url.href);
        else command("createLink", url.href);
        setLinkOpen(false); setLinkError("");
    }
    return <div className={`task_text_editor${compact ? " task_comment_editor" : ""}${disabled ? " is_disabled" : ""}`}>
        <div className="task_editor_toolbar" role="toolbar" aria-label={`Formato de ${label.toLowerCase()}`} onMouseDown={event => { remember(); if (!event.target.closest("summary")) event.preventDefault(); }}>
            <details className="task_editor_style task_select" ref={styleMenu} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; } }}><summary aria-label="Estilo de texto" aria-disabled={disabled} onClick={event => disabled && event.preventDefault()}>{style}<ChevronDown size={13} /></summary><div className="task_select_menu">{textStyles.map(([tag, name]) => <button type="button" className="task_select_option" aria-label={name} key={tag} disabled={disabled} onClick={() => changeStyle(tag)}>{name}</button>)}</div></details>
            <span className="task_editor_divider" />{formats.map(([name, action, Icon]) => <button type="button" key={action} title={name} aria-label={name} disabled={disabled} onClick={() => command(action)}><Icon size={15} /></button>)}<button type="button" title="Enlace" aria-label="Insertar enlace" disabled={disabled} onClick={() => { setLinkOpen(current => !current); setLinkError(""); }}><Link size={15} /></button>
        </div>
        {linkOpen && <div className="task_editor_link"><input type="url" aria-label="Dirección del enlace" value={link} onChange={event => setLink(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); insertLink(); } if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setLinkOpen(false); editor.current.focus(); } }} /><button type="button" disabled={disabled} onClick={insertLink}>Insertar</button><button type="button" onClick={() => setLinkOpen(false)}>Cancelar</button>{linkError && <small role="alert">{linkError}</small>}</div>}
        <ImageGallery images={images} disabled={disabled || imagesBusy} onRemove={index => {const image = editor.current?.querySelectorAll("img")[index]; if (image) {image.remove(); selection.current = null; save();}}}/>
        <div ref={editor} className="task_editor_content" role="textbox" aria-label={label} aria-multiline="true" aria-disabled={disabled} contentEditable={!disabled} suppressContentEditableWarning spellCheck data-placeholder={placeholder} onInput={save} onKeyUp={remember} onMouseUp={remember} onBlur={remember} onPaste={event => { event.preventDefault(); remember(); command("insertText", event.clipboardData.getData("text/plain")); }} onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter" && !event.shiftKey && onSubmit) { event.preventDefault(); event.stopPropagation(); if (!submitDisabled && !disabled && !imagesBusy && !event.repeat) onSubmit(); return; }
            if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && ["Título", "Subtítulo"].includes(style)) { event.preventDefault(); remember(); command("insertParagraph"); command("fontSize", "3"); }
            if ((event.ctrlKey || event.metaKey) && ["b", "i", "u"].includes(event.key.toLowerCase())) { event.preventDefault(); command(({ b: "bold", i: "italic", u: "underline" })[event.key.toLowerCase()]); }
        }} />
        {limitReached && <small className="task_editor_limit" role="alert">Se alcanzó el límite de texto de este campo.</small>}
        <VoiceNotes value={notes} onChange={onNotesChange} onBusyChange={onBusyChange} controlsRef={controls} resource={resource} resourceId={resourceId} disabled={disabled} />
        <div className="task_editor_footer"><div className="task_editor_insert" ref={controls}>
            {allowImages && <label className="detail_comment_image_button" title="Adjuntar imagen"><ImagePlus size={17} /><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple aria-label="Adjuntar imágenes" disabled={disabled || imagesBusy} onChange={async event => {
                const files = [...event.target.files]; remember(); setImageError(""); setImagesBusy(true); onBusyChange?.(true);
                try {
                    if (onFiles) {await onFiles(event); return;}
                    event.target.value = "";
                    const images = await Promise.all(files.map(file => new Promise((resolve, reject) => {
                        if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) return reject(new Error("Usa PNG, JPEG, GIF o WebP."));
                        const reader = new FileReader(); reader.onerror = () => reject(new Error("No se pudo leer la imagen.")); reader.onload = () => {const image = document.createElement("img"); image.setAttribute("data-bold-image", reader.result); resolve(image.outerHTML);}; reader.readAsDataURL(file);
                    })));
                    if (editor.current) command("insertHTML", images.join(""));
                } catch (error) {setImageError(error.message);}
                finally {setImagesBusy(false); onBusyChange?.(false);}
            }} /></label>}
        </div>{onSubmit ? <button type="button" className="task_editor_send" title="Enviar comentario (Enter). Nueva línea: Shift+Enter" aria-label="Enviar comentario" disabled={disabled || imagesBusy || submitDisabled} onClick={onSubmit}><ArrowUp size={16} /></button> : <small>{label}</small>}</div>
        {imageError && <small role="alert">{imageError}</small>}
    </div>;
}
