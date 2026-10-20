import {imageFileError} from "./media_helpers.js";

export const MAX_QUEUED_IMAGES = 10;
export const MAX_IMAGE_QUEUE_BYTES = 50 * 1024 * 1024;

function validateQueue(items) {
    if (items.length > MAX_QUEUED_IMAGES) throw Error(`Puedes preparar hasta ${MAX_QUEUED_IMAGES} imágenes a la vez.`);
    if (items.reduce((total, item) => total + item.file.size, 0) > MAX_IMAGE_QUEUE_BYTES) throw Error("La cola no puede superar los 50 MB. Envía estas imágenes antes de añadir más.");
    for (const item of items) {const error = imageFileError(item.file); if (error) throw Error(error);}
    return items;
}

export function appendImages(current, files, makeId = () => crypto.randomUUID()) {
    const incoming = Array.from(files);
    // Validate the entire selection before creating IDs or changing any draft.
    validateQueue([...current, ...incoming.map(file => ({file}))]);
    return [...current, ...incoming.map(file => ({id: makeId(), file, caption: "", attempted: false}))];
}

export function replaceQueuedImage(items, id, file) {
    const item = items.find(row => row.id === id);
    if (!item || item.attempted) throw Error("Confirma primero el envío pendiente antes de editar esta imagen.");
    return validateQueue(items.map(row => row.id === id ? {...row, file} : row));
}

export function captionQueuedImage(items, id, caption) {
    return items.map(row => row.id === id && !row.attempted ? {...row, caption: caption.slice(0, 5000)} : row);
}

export function canReviseFailedImage(error) {
    // These responses definitively reject validation before committing a message.
    // Network errors, conflicts and server errors remain immutable on retry.
    return [400, 413, 415, 422].includes(error?.status);
}
