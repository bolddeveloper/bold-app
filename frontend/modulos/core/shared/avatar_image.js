import {drawAvatar} from "./image_controls.js";
// Fotos de perfiles y proyectos: recorte cuadrado, WebP y límites compartidos.
export function cropAvatar(file, options = {}) {
    return new Promise((resolve, reject) => {
        if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) return reject(new Error("Selecciona una imagen PNG, JPEG o WebP."));
        if (file.size > 10 * 1024 * 1024) return reject(new Error("La imagen no puede superar 10 MB."));
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
        reader.onload = () => {
            const image = new Image();
            image.onerror = () => reject(new Error("La imagen está dañada o no es compatible."));
            image.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = 256; canvas.height = 256;
                drawAvatar(canvas, image, options);
                const data_url = canvas.toDataURL("image/webp", .82);
                if (Math.ceil((data_url.length - data_url.indexOf(",") - 1) * .75) > 300 * 1024) return reject(new Error("La imagen comprimida supera 300 KB."));
                resolve(data_url);
            };
            image.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}
