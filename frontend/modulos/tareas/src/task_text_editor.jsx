import { useEffect, useLayoutEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { AtSign, ArrowUp, Bold, ChevronDown, ImagePlus, Italic, Link, List, ListOrdered, Redo2, Strikethrough, Underline, Undo2 } from "lucide-react";
import { ImageGallery } from "./image_gallery.jsx";
import { VoiceNotes } from "./voice_notes.jsx";
import { editorDisplayHTML, inlineTextClasses, saveRichText, richImageSources } from "./rich_text.js";
import {linkifyEditor, linkMarkup, normalizedLink} from "./editor_links.js";
import {transferredFiles, validateEditorImages} from "./editor_media.js";

import {getCoreState, subscribeCore} from "../../core/core_store.js";
import {mentionAtCaret, mentionPeople} from "./mentions.js";

const formats = [["Deshacer", "undo", Undo2], ["Rehacer", "redo", Redo2], ["Negrita", "bold", Bold], ["Cursiva", "italic", Italic], ["Tachado", "strikeThrough", Strikethrough], ["Subrayado", "underline", Underline], ["Lista", "insertUnorderedList", List], ["Lista numerada", "insertOrderedList", ListOrdered]];
const textStyles = [["3", "Texto normal"], ["5", "Título"], ["4", "Subtítulo"], ["2", "Cita"]];

export function TaskText({ value, className = "", imageTaskId, imageHistory = false, imageSection, imageProjectId }) {
    const images = richImageSources(value || "");
    return <div className={`task_formatted_text ${className}`}>
        <ImageGallery images={images} taskId={imageTaskId} history={imageHistory} imageSection={imageSection} imageProjectId={imageProjectId}/>
        <div className="task_text_body" dangerouslySetInnerHTML={{__html: editorDisplayHTML(value || "")}}/>
    </div>;
}

export function TextEditorField({ name, defaultValue = "", value, onChange, maxLength, ...props }) {
    const [draft, setDraft] = useState(defaultValue);
    const current = value === undefined ? draft : value;
    return <div className="app_text_editor_field"><TaskTextEditor {...props} maxLength={maxLength} value={current} onChange={next => { setDraft(next); onChange?.(next); }} />{name && <input type="hidden" name={name} value={current} />}</div>;
}

export function TaskTextEditor({ value = "", onChange, label = "Descripción", placeholder = "Escribe una descripción…", notes = [], onNotesChange, onBusyChange, resource = "tasks", resourceId, disabled = false, onFiles, onSubmit, submitDisabled = false, compact = !!onSubmit, maxLength, allowImages = true, allowVoiceNotes = true, changeDelay = 0, draftRef }) {
    const editor = useRef(null), selection = useRef(null), lastValue = useRef(value), controls = useRef(null), styleMenu = useRef(null);
    const commitTimer = useRef(null), dirty = useRef(false), commit = useRef(null);
    const [linkOpen, setLinkOpen] = useState(false), [link, setLink] = useState("https://"), [linkError, setLinkError] = useState("");
    const [linkAlias, setLinkAlias] = useState("");
    const imagesInFlight = useRef(false);
    const [style, setStyle] = useState("Texto normal");
    const [limitReached, setLimitReached] = useState(false);
    const [imageError, setImageError] = useState("");
    const [imagesBusy, setImagesBusy] = useState(false);
    const images = richImageSources(value);
    const core = useSyncExternalStore(subscribeCore, getCoreState, getCoreState);
    const mentionId = useId();
    const [mention, setMention] = useState(null), [mentionIndex, setMentionIndex] = useState(0);
    const mentionRange = useRef(null);
    const candidates = mention && !core.securityUncertain ? mentionPeople(core.directory || [], mention.query) : [];
    function findMention() {
        if (!compact || disabled) return;
        const range = window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0) : null;
        const match = range?.collapsed && editor.current?.contains(range.endContainer) && range.endContainer.nodeType === Node.TEXT_NODE ? mentionAtCaret(range.endContainer.textContent.slice(0, range.endOffset)) : null;
        mentionRange.current = match ? range.cloneRange() : null;
        if (match) mentionRange.current.setStart(range.endContainer, range.endOffset - match.length);
        setMention(match); setMentionIndex(0);
    }
    function insertMention(person) {
        if (!mentionRange.current || disabled) return;
        editor.current.focus();
        const current = window.getSelection(); current.removeAllRanges(); current.addRange(mentionRange.current);
        document.execCommand("insertText", false, `@${person.email} `);
        setMention(null); mentionRange.current = null; save();
    }
    useEffect(() => {
        const closeMenu = event => { if (styleMenu.current && !styleMenu.current.contains(event.target)) styleMenu.current.open = false; };
        document.addEventListener("pointerdown", closeMenu);
        return () => document.removeEventListener("pointerdown", closeMenu);
    }, []);
    useEffect(() => {
        if (editor.current && (lastValue.current !== value || !editor.current.dataset.ready)) {
            clearTimeout(commitTimer.current); dirty.current = false;
            editor.current.innerHTML = editorDisplayHTML(value, true); editor.current.dataset.ready = "true"; lastValue.current = value; selection.current = null;
        }
    }, [value]);
    useLayoutEffect(() => {
        const handle = {flush: () => commit.current()};
        if (draftRef) draftRef.current = handle;
        const onHidden = () => { if (document.visibilityState === "hidden") handle.flush(); };
        document.addEventListener("visibilitychange", onHidden);
        window.addEventListener("pagehide", handle.flush);
        return () => {
            handle.flush();
            document.removeEventListener("visibilitychange", onHidden);
            window.removeEventListener("pagehide", handle.flush);
            if (draftRef?.current === handle) draftRef.current = null;
        };
    }, [draftRef]);
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
    const flush = () => {
        clearTimeout(commitTimer.current); commitTimer.current = null;
        if (dirty.current && editor.current) {
            const next = saveRichText(editor.current.innerHTML);
            dirty.current = false; lastValue.current = next; onChange(next);
        }
        return lastValue.current;
    };
    commit.current = flush;
    const save = (wholeDocument = false, deferred = false) => {
        if (maxLength && editor.current.textContent.length > maxLength) {
            clearTimeout(commitTimer.current); dirty.current = false;
            editor.current.innerHTML = editorDisplayHTML(lastValue.current, true); selection.current = null; setLimitReached(true); return;
        }
        linkifyEditor(editor.current, {wholeDocument}); dirty.current = true; setLimitReached(false); remember();
        if (deferred && changeDelay > 0) {
            clearTimeout(commitTimer.current);
            commitTimer.current = setTimeout(() => commit.current(), Math.min(changeDelay, 250));
        } else flush();
    };
    const command = (name, argument) => {
        if (disabled) return;
        editor.current.focus();
        if (selection.current && editor.current.contains(selection.current.commonAncestorContainer)) { const current = window.getSelection(); current.removeAllRanges(); current.addRange(selection.current); }
        document.execCommand(name, false, argument); save(true);
    };
    const changeStyle = size => {
        command("fontSize", size);
        setStyle(textStyles.find(([id]) => id === size)[1]);
        styleMenu.current.open = false;
    };
    function insertLink() {
        if (disabled) return;
        let url;
        try { url = normalizedLink(link.trim()); } catch { setLinkError("Introduce un enlace válido con http:// o https://."); return; }
        const node = selection.current?.commonAncestorContainer;
        const existing = (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement)?.closest("a");
        if (existing && editor.current.contains(existing)) {
            existing.href = url; existing.textContent = linkAlias.trim() || url; delete existing.dataset.boldAutolink;
            editor.current.focus(); const range = document.createRange(); range.setStartAfter(existing); range.collapse(true);
            const current = window.getSelection(); current.removeAllRanges(); current.addRange(range); save();
        }
        else if (linkAlias.trim() || !selection.current || selection.current.collapsed) command("insertHTML", linkMarkup(url, linkAlias));
        else command("createLink", url);
        setLinkOpen(false); setLinkError(""); setLinkAlias("");
    }
    async function insertImages(files) {
        if (disabled || !allowImages || imagesInFlight.current) return;
        remember(); setImageError("");
        try { validateEditorImages(files); } catch (error) { setImageError(error.message); return; }
        imagesInFlight.current = true; setImagesBusy(true); onBusyChange?.(true);
        try {
            if (onFiles) { await onFiles({target: {files, value: ""}}); return; }
            const images = await Promise.all(files.map(file => new Promise((resolve, reject) => {
                const reader = new FileReader(); reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
                reader.onload = () => { const image = document.createElement("img"); image.setAttribute("data-bold-image", reader.result); resolve(image.outerHTML); }; reader.readAsDataURL(file);
            })));
            if (editor.current) command("insertHTML", images.join(""));
        } catch (error) { setImageError(error.message); }
        finally { imagesInFlight.current = false; setImagesBusy(false); onBusyChange?.(false); }
    }
    return <div className={`task_text_editor${compact ? " task_comment_editor" : ""}${disabled ? " is_disabled" : ""}`}>
        <div className="task_editor_toolbar" role="toolbar" aria-label={`Formato de ${label.toLowerCase()}`} onMouseDown={event => { remember(); if (!event.target.closest("summary")) event.preventDefault(); }}>
            <details className="task_editor_style task_select" ref={styleMenu} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; } }}><summary aria-label="Estilo de texto" aria-disabled={disabled} onClick={event => disabled && event.preventDefault()}>{style}<ChevronDown size={13} /></summary><div className="task_select_menu">{textStyles.map(([tag, name]) => <button type="button" className="task_select_option" aria-label={name} key={tag} disabled={disabled} onClick={() => changeStyle(tag)}>{name}</button>)}</div></details>
            <span className="task_editor_divider" />{formats.map(([name, action, Icon]) => <button type="button" key={action} title={name} aria-label={name} disabled={disabled} onClick={() => command(action)}><Icon size={15} /></button>)}<button type="button" title="Enlace" aria-label="Insertar enlace" disabled={disabled} onClick={() => { setLinkAlias(selection.current?.toString() || ""); setLinkOpen(current => !current); setLinkError(""); }}><Link size={15} /></button>
        </div>
        {linkOpen && <div className="task_editor_link"><input type="url" aria-label="Dirección del enlace" value={link} onChange={event => setLink(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); insertLink(); } if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setLinkOpen(false); editor.current.focus(); } }} /><input type="text" aria-label="Alias del enlace" placeholder="Alias (opcional)" maxLength={120} value={linkAlias} onChange={event => setLinkAlias(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); insertLink(); } }} /><button type="button" disabled={disabled} onClick={insertLink}>Insertar</button><button type="button" onClick={() => setLinkOpen(false)}>Cancelar</button>{linkError && <small role="alert">{linkError}</small>}</div>}
        <ImageGallery images={images} disabled={disabled || imagesBusy} onRemove={index => {const image = editor.current?.querySelectorAll("img")[index]; if (image) {image.remove(); selection.current = null; save();}}}/>
        <div ref={editor} className="task_editor_content" role="textbox" aria-label={label} aria-multiline="true" aria-controls={mention ? mentionId : undefined} aria-activedescendant={mention && candidates.length ? `${mentionId}-${mentionIndex}` : undefined} aria-disabled={disabled} contentEditable={!disabled} suppressContentEditableWarning spellCheck data-placeholder={placeholder}
        onInput={event => { if (!event.nativeEvent.isComposing) {save(false, true); findMention();} }}
        onCompositionEnd={() => {save(); findMention();}}
        onKeyUp={event => {remember(); if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) findMention();}}
        onMouseUp={() => {remember(); findMention();}}
        onBlur={event => {flush(); remember(); if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) setMention(null);}}
        onPaste={event => { event.preventDefault(); if (disabled) return; const files = transferredFiles(event.clipboardData); if (files.length) { void insertImages(files); return; } remember(); command("insertText", event.clipboardData.getData("text/plain")); }}
        onDragOver={event => { if (Array.from(event.dataTransfer.types).includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = !disabled && allowImages && !imagesBusy ? "copy" : "none"; } }}
        onDrop={event => { const files = transferredFiles(event.dataTransfer); if (files.length) { event.preventDefault(); event.stopPropagation(); void insertImages(files); } else { const text = event.dataTransfer.getData("text/plain") || event.dataTransfer.getData("text/uri-list"); if (text) { event.preventDefault(); event.stopPropagation(); remember(); command("insertText", text); } } }} onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if (mention && ["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) {
                event.preventDefault(); event.stopPropagation();
                if (event.key === "Escape") setMention(null);
                else if (event.key === "Enter" && candidates.length) insertMention(candidates[mentionIndex % candidates.length]);
                else if (candidates.length) setMentionIndex(index => (index + (event.key === "ArrowUp" ? -1 : 1) + candidates.length) % candidates.length);
                return;
            }
            if (event.key === "Enter" && !event.shiftKey && onSubmit) { event.preventDefault(); event.stopPropagation(); if (!submitDisabled && !disabled && !imagesBusy && !event.repeat) {flush(); onSubmit();} return; }
            if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && ["Título", "Subtítulo"].includes(style)) { event.preventDefault(); remember(); command("insertParagraph"); command("fontSize", "3"); }
            if ((event.ctrlKey || event.metaKey) && ["b", "i", "u"].includes(event.key.toLowerCase())) { event.preventDefault(); command(({ b: "bold", i: "italic", u: "underline" })[event.key.toLowerCase()]); }
        }} />
        {mention && <div id={mentionId} className="task_mention_menu" role="listbox" aria-label="Personas para mencionar">{candidates.length ? candidates.map((person, index) => <button id={`${mentionId}-${index}`} type="button" role="option" aria-selected={index === mentionIndex} key={person.email} onMouseDown={event => event.preventDefault()} onClick={() => insertMention(person)}><AtSign size={15}/><span><strong>{person.name}</strong><small>{person.email}</small></span></button>) : <small>No hay coincidencias. Busca por nombre o correo.</small>}</div>}
        {limitReached && <small className="task_editor_limit" role="alert">Se alcanzó el límite de texto de este campo.</small>}
        {allowVoiceNotes && <VoiceNotes value={notes} onChange={onNotesChange} onBusyChange={onBusyChange} controlsRef={controls} resource={resource} resourceId={resourceId} disabled={disabled} />}
        <div className="task_editor_footer"><div className="task_editor_insert" ref={controls}>
            {allowImages && <label className="detail_comment_image_button" title="Adjuntar imagen"><ImagePlus size={17} /><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple aria-label="Adjuntar imágenes" disabled={disabled || imagesBusy} onChange={event => { const files = Array.from(event.target.files); event.target.value = ""; void insertImages(files); }} /></label>}
            {compact && <button type="button" aria-label="Mencionar persona" title="Mencionar persona (@)" disabled={disabled} onMouseDown={event => {event.preventDefault(); remember();}} onClick={() => {command("insertText", " @"); findMention();}}><AtSign size={17}/></button>}
        </div>{onSubmit ? <button type="button" className="task_editor_send" title="Enviar comentario (Enter). Nueva línea: Shift+Enter" aria-label="Enviar comentario" disabled={disabled || imagesBusy || submitDisabled} onClick={onSubmit}><ArrowUp size={16} /></button> : <small>{label}</small>}</div>
        {imageError && <small role="alert">{imageError}</small>}
    </div>;
}
