export const MAX_CHAT_FILE = 10 * 1024 * 1024;
export const AUDIO_RATES = [1, 1.5, 2];
export function audioTime(value) {
    const seconds = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
// Bounded sampling of decoded audio, not invented amplitudes. Silence stays flat.
export function waveformPeaks(samples, count = 32) {
    const peaks = Array.from({length: count}, (_, index) => {
        const start = Math.floor(index * samples.length / count), end = Math.floor((index + 1) * samples.length / count);
        let peak = 0;
        for (let i = start; i < end; i += Math.max(1, Math.floor((end - start) / 512))) peak = Math.max(peak, Math.abs(samples[i]));
        return peak;
    });
    const maximum = Math.max(...peaks, .001);
    return peaks.map(value => Math.max(.12, value / maximum));
}
export function recordingMime(recorder = globalThis.MediaRecorder) {
    return ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(type => recorder?.isTypeSupported?.(type)) || "";
}
export function imageFileError(file) {
    if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) return "Selecciona una imagen PNG, JPEG o WebP.";
    if (!file.size || file.size > MAX_CHAT_FILE) return "La imagen debe pesar como máximo 10 MB.";
    return "";
}
export function cropRect(width, height, crop) {
    const x = Math.max(0, Math.min(90, Number(crop.x) || 0)), y = Math.max(0, Math.min(90, Number(crop.y) || 0));
    return [width * x / 100, height * y / 100, width * Math.max(10, Math.min(100 - x, Number(crop.w) || 100)) / 100,
        height * Math.max(10, Math.min(100 - y, Number(crop.h) || 100)) / 100];
}
export function mediaPreview(row) {return row?.body || (row?.media?.kind === "audio" ? "Nota de voz" : row?.media ? "Imagen" : "");}
