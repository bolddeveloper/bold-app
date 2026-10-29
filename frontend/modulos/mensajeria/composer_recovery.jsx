export default function ComposerRecovery({draft,disabled=false}){
    if(!draft)return null;
    return <>
        {draft.recovery && <section className="slack_page_problem" aria-label="Borrador de conversación conservado"><strong>Hay un borrador conservado en este dispositivo.</strong><p>Del {new Date(draft.recovery.updatedAt).toLocaleString("es")}. Recuperarlo no lo envía: revisa el texto y los adjuntos antes de pulsar Enviar.</p><button type="button" disabled={disabled} onClick={draft.recover}>Recuperar borrador de conversación</button><button type="button" disabled={disabled} onClick={draft.discard}>Descartar copia del borrador</button></section>}
        {draft.error && <p className="slack_page_problem" role="alert">No se pudo proteger o recuperar el borrador. No cierres esta vista sin guardar. <button type="button" disabled={disabled} onClick={draft.retry}>Reintentar protección del borrador</button></p>}
        {draft.status==="opening" && <p role="status">Comprobando si hay un borrador recuperable…</p>}
        {draft.status==="protected" && <p className="messaging_hint" role="status">Borrador cifrado protegido en este dispositivo.</p>}
    </>;
}
