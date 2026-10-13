export function patchSheetTableUI(source) {
  if (source.includes('className: "bold_table_theme"')) return source;
  const start = source.indexOf('const SheetTableThemePanel ='), end = source.indexOf('//#endregion', start);
  if (start < 0 || end < 0) throw Error('Cambió el panel de estilos de Univer. Revisa el parche antes de actualizarlo.');
  let panel = source.slice(start,end);
  const replace = (before, after) => {
    if (!panel.includes(before)) throw Error('Cambió un control de estilos de Univer. Revisa el parche.');
    panel = panel.replace(before,after);
  };
  replace('return /* @__PURE__ */ jsxs("div", { children: [', 'return /* @__PURE__ */ jsxs("div", { className: "bold_table_theme", children: [\n\t\tjsx("p", {className:"bold_table_style_help", children:localeService.t("sheets-table-ui.styleHelp")}),');
  for (const list of ['defaultRangeThemes', 'customRangeThemes']) replace(`${list}.map((item) => {`, `${list}.map((item, index) => {`);
  const action = 'onClick: () => handleThemeChange(item),';
  if (panel.split(action).length !== 3) throw Error('Cambió la selección de diseños de Univer.');
  panel = panel.replaceAll(action, `${action}\n\t\t\t\t\trole:"button", tabIndex:0, "data-bold-style":item, "aria-pressed":item===themeConfig.theme,\n\t\t\t\t\t"aria-label":localeService.t("sheets-table-ui.applyStyle")+" "+(index+1),\n\t\t\t\t\tonKeyDown:event=>{if(event.target===event.currentTarget && (event.key==="Enter" || event.key===" ")){event.preventDefault();handleThemeChange(item);}},`);
  replace('jsx("div", {\n\t\t\t\t\tclassName: clsx("univer-h-10 univer-w-8 univer-cursor-pointer univer-p-px univer-text-center univer-leading-10", borderClassName),', 'jsx("button", {\n\t\t\t\t\ttype:"button", className:"bold_table_style_add",');
  replace('children: "+"', 'children:localeService.t("sheets-table-ui.addStyle")');
  let next = source.slice(0,start) + panel + source.slice(end);
  const menuStart = next.indexOf('_drawMenu(ctx, tableId, left, top) {'), menuEnd = next.indexOf('_drawInsertButton(', menuStart);
  if (menuStart < 0 || menuEnd < 0) throw Error('Cambió el menú de tablas de Univer.');
  // The table menu is painted on canvas; CSS cannot apply its dark colors.
  const menu = next.slice(menuStart,menuEnd)
    .replace('const regions =', 'const dark = typeof document!=="undefined" && !!document.querySelector(".sheets_univer .univer-dark");\n\t\tconst regions =')
    .replace('fill: "#fff",', 'fill: dark ? "#22272f" : "#fff",')
    .replace('stroke: MENU_BORDER', 'stroke: dark ? "#3b4350" : MENU_BORDER')
    .replace('ctx.fillStyle = MENU_HOVER_BG;', 'ctx.fillStyle = dark ? "#303640" : MENU_HOVER_BG;')
    .replace('ctx.fillStyle = region.action === "delete" ? "#d92d20" : "#344054";', 'ctx.fillStyle = region.action === "delete" ? (dark ? "#ff6572" : "#d92d20") : (dark ? "#f3f4f6" : "#344054");');
  return next.slice(0,menuStart) + menu + next.slice(menuEnd);
}
