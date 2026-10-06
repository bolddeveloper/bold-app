import "./module_notice.css";

// Bloqueo temporal: retirar este contenedor para habilitar los módulos Google.
export default function ModuleNotice({name, children}) {
    return <div className="module_notice">
        <div className="module_notice_content" inert aria-hidden="true">{children}</div>
        <div className="module_notice_overlay">
            <section className="module_notice_dialog" role="status" aria-labelledby="module-notice-title" aria-describedby="module-notice-description">
                <p>{name}</p>
                <h2 id="module-notice-title">Actualmente no disponible</h2>
                <p id="module-notice-description">Estamos trabajando en este módulo.</p>
                <img src="/bold-loader.svg" alt="" aria-hidden="true" width="170" height="99"/>
            </section>
        </div>
    </div>;
}
