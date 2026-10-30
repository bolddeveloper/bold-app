import {taskCreationTime} from "./task_created_at.js";

export function TaskCreatedAt({value}) {
    const created = taskCreationTime(value);
    return <><span className="meta_label">Creada el</span><span className="meta_value">
        {created ? <time dateTime={created.iso} title="Fecha y hora originales · zona horaria de este dispositivo">{created.label}</time> : "Fecha de creación no disponible"}
    </span></>;
}
