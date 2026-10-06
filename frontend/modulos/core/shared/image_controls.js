// Conversión HSV y límites del recorte usados por los controles compartidos.
export function hsvToHex(h, s, v) {
    const channel = n => {const k = (n + h / 60) % 6; return Math.round(255 * v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1)))).toString(16).padStart(2, "0");};
    return `#${channel(5)}${channel(3)}${channel(1)}`;
}
export function hexToHsv(hex) {
    const [r,g,b] = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255), max = Math.max(r,g,b), min = Math.min(r,g,b), d = max-min;
    const h = !d ? 0 : max === r ? ((g-b)/d+6)%6 : max === g ? (b-r)/d+2 : (r-g)/d+4;
    return [h*60, max ? d/max : 0, max];
}
export function avatarRect(width, height, {zoom = 1, x = 0, y = 0} = {}) {
    const side = Math.min(width,height) / Math.max(1, Math.min(4,zoom));
    return [(width-side)/2*(1+Math.max(-1,Math.min(1,x))), (height-side)/2*(1+Math.max(-1,Math.min(1,y))), side, side];
}
export function drawAvatar(canvas, image, options = {}) {
    const context = canvas.getContext("2d"), size = canvas.width;
    context.clearRect(0,0,size,size); context.save(); context.translate(size/2,size/2); context.rotate((options.rotation || 0)*Math.PI/180);
    context.drawImage(image,...avatarRect(image.naturalWidth,image.naturalHeight,options),-size/2,-size/2,size,size); context.restore();
}
