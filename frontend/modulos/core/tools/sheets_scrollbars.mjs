export function patchSheetScrollbars(source) {
  source = source.replace(/\r\n/g, '\n');
  if (!source.includes('// BOLD: draw sheet scrollbars above frozen panes.')) {
    const before = 'for (const [_index, vp] of viewports.entries()) vp.render(mainCtx, objects, isMaxLayer);';
    if (source.split(before).length !== 2) throw Error('Cambió el orden de dibujo de Univer. Revisa el parche de barras.');
    source = source.replace(before, `// BOLD: draw sheet scrollbars above frozen panes.
        const fixedScrollbars = this._scene.getViewport(SHEET_VIEWPORT_KEY.VIEW_ROW_BOTTOM) && this._scene.getViewport(SHEET_VIEWPORT_KEY.VIEW_MAIN);
        for (const [_index, vp] of viewports.entries()) vp.render(mainCtx, objects, isMaxLayer && vp !== fixedScrollbars);
        if (isMaxLayer && fixedScrollbars) {
          mainCtx.save();
          mainCtx.transform(...fixedScrollbars.getScrollBarTransForm().getMatrix());
          fixedScrollbars._drawScrollbar(mainCtx);
          mainCtx.restore();
        }`);
  }
  if (source.includes('// BOLD: anchor sheet scrollbars to the canvas.')) return source;
  const sheet = 'this.viewportKey === SHEET_VIEWPORT_KEY.VIEW_MAIN && this._scene.getViewport(SHEET_VIEWPORT_KEY.VIEW_ROW_BOTTOM)';
  const barSheet = 'this._viewport.viewportKey === SHEET_VIEWPORT_KEY.VIEW_MAIN && this._viewport.scene.getViewport(SHEET_VIEWPORT_KEY.VIEW_ROW_BOTTOM)';
  const replacements = [
    ['resize(viewportWidth = 0, viewportHeight = 0, contentWidth = 0, contentHeight = 0) {',
      `resize(viewportWidth = 0, viewportHeight = 0, contentWidth = 0, contentHeight = 0) {
        // BOLD: anchor sheet scrollbars to the canvas.
        if (${barSheet}) {
          const parent = this._viewport.scene.getParent();
          const corner = this._viewport.scene.getViewport(SHEET_VIEWPORT_KEY.VIEW_LEFT_TOP);
          contentWidth += parent.width - corner.width - viewportWidth;
          contentHeight += parent.height - corner.height - viewportHeight;
          viewportWidth = parent.width - corner.width;
          viewportHeight = parent.height - corner.height;
        }`],
    ['getScrollBarTransForm() {\n\t\tconst composeResult = Transform.create();',
      `getScrollBarTransForm() {\n\t\tconst composeResult = Transform.create();\n\t\tif (${sheet}) {
          const corner = this._scene.getViewport(SHEET_VIEWPORT_KEY.VIEW_LEFT_TOP);
          return Transform.create([1,0,0,1,corner.width,corner.height]);
        }`],
    ['e.offsetY - this._viewport.top - this.verticalThumbSize / 2',
      'e.offsetY - this._viewport.getScrollBarTransForm().getMatrix()[5] - this.verticalThumbSize / 2'],
    ['e.offsetX - this._viewport.left - this.horizontalThumbSize / 2',
      'e.offsetX - this._viewport.getScrollBarTransForm().getMatrix()[4] - this.horizontalThumbSize / 2'],
    ['pick(coord) {\n\t\tlet pickedViewport = this.getActiveViewportByCoord(coord);',
      `pick(coord) {
        if (this.objectsEvented && this.getViewport(SHEET_VIEWPORT_KEY.VIEW_ROW_BOTTOM)) {
          const scrollbar = this.getViewport(SHEET_VIEWPORT_KEY.VIEW_MAIN)?.pickScrollBar(coord);
          if (scrollbar) return scrollbar;
        }
        let pickedViewport = this.getActiveViewportByCoord(coord);`],
  ];
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) throw Error('Cambió el motor de desplazamiento de Univer. Revisa el parche de barras.');
    source = source.replace(before, after);
  }
  return source;
}
