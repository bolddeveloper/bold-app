export function zoomImage(view, factor) {
    const scale = Math.min(4, Math.max(1, view.scale * factor));
    if (scale === 1) return {scale: 1, x: 0, y: 0};
    return {scale, x: view.x * scale / view.scale, y: view.y * scale / view.scale};
}
