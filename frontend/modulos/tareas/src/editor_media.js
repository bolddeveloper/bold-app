export const editorImageTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export {transferredFiles} from '../../core/shared/file_transfer.js';
export function validateEditorImages(files) {
    if (!files.length || files.some(file => !editorImageTypes.includes(file.type))) throw new Error("Usa imágenes PNG, JPEG, GIF o WebP.");
}
