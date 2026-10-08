export const drawerMinWidth = 600;
export const drawerMaxWidth = 980;
export function clampDrawerWidth(width, viewport) {
    return viewport <= 760 ? viewport : Math.min(viewport, drawerMaxWidth, Math.max(drawerMinWidth, width));
}
