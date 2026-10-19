export function patchSheetContextMenus(source) {
  if (source.includes('// BOLD: one active submenu per menu level.')) return source.replace('menuKey: menuSchema.key,\n','menuKey: menuSchema.key, activeSubmenuKey, onSubmenuActive: setActiveSubmenuKey,\n');
  source=source.replaceAll('if (!submenuVisible) setSubmenuPositionReady(false);','setSubmenuPositionReady(false);');
  const target=/setSubmenuPositionReady\(false\);\n(\s*)setSubmenuVisible\(true\);/g;
  if ([...source.matchAll(target)].length!==2) throw Error('Cambió la apertura de submenús de Univer. Revisa el parche.');
  // The positioning effect runs when visibility changes; reopening an open menu must not hide it.
  let next=source.replace(target,'if (!submenuVisible) setSubmenuPositionReady(false);\n$1setSubmenuVisible(true);');
  const start=next.indexOf('function ContextMenuMenu(props)'), end=next.indexOf('function ContextMenuMenuItem(props)',start);
  if (start<0 || end<0) throw Error('Cambió el nivel de menús de Univer.');
  const menu=next.slice(start,end).replace('const localeService =', 'const [activeSubmenuKey, setActiveSubmenuKey] = useState(null);\n\tconst localeService =').replaceAll('menuKey: childSchema.key,','menuKey: childSchema.key, activeSubmenuKey, onSubmenuActive: setActiveSubmenuKey,').replace('menuKey: menuSchema.key,\n','menuKey: menuSchema.key, activeSubmenuKey, onSubmenuActive: setActiveSubmenuKey,\n');
  next=next.slice(0,start)+menu+next.slice(end);
  next=next.replace('const { menuKey, menuItem,', 'const { activeSubmenuKey, onSubmenuActive, menuKey, menuItem,');
  next=next.replace('const scheduleSubmenuClose = useCallback(() => {', `useEffect(() => {
    if (activeSubmenuKey !== undefined && activeSubmenuKey !== menuKey) {
      clearSubmenuCloseTimer();
      setSubmenuVisible(false);
    }
  }, [activeSubmenuKey, menuKey, clearSubmenuCloseTimer]);
  const scheduleSubmenuClose = useCallback(() => {`);
  const itemStart=next.indexOf('function ContextMenuMenuItem(props)'), itemEnd=next.indexOf('function useContextGroupHiddenStates$1',itemStart);
  const item=next.slice(itemStart,itemEnd).replace('onMouseEnter: () => {','onMouseEnter: () => { onSubmenuActive?.(menuKey);').replace('onClick: () => {','onClick: () => { onSubmenuActive?.(menuKey);');
  return '// BOLD: one active submenu per menu level.\n'+next.slice(0,itemStart)+item+next.slice(itemEnd);
}
