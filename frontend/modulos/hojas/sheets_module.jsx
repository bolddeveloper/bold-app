import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Download, Folder, Plus, Search, Sheet, Star, Trash2, Users, X, Copy, MoreHorizontal, RefreshCw, ExternalLink, Grid2X2, LayoutDashboard, GripVertical } from 'lucide-react';
import { useCore } from '../core/core_provider.jsx';
import { useShell } from '../core/app_shell.jsx';
import { BackgroundSyncNotice } from '../core/shared/background_sync_notice.jsx';
import { NoticeLayer } from '../core/shared/notice_layer.jsx';
import { confirmBold, promptBold } from '../core/shared/bold_dialog.js';
import { DriveFolderPicker } from '../docs/drive_module.jsx';
import { SheetDialog, NewFileDialog, ShareDialog, RichCellDialog, ConflictDialog, ImportDialog } from './sheets_dialogs.jsx';
import {BlockConfiguration} from './sheet_block_settings.jsx';
import { VisualSheet } from './sheets_visual.jsx';
import { blockTypes, gridAdapter, syncLabels, cell, richCellValue } from './sheets_model.js';
import { sheetsApi } from './sheets_api.js';
import { sheetsCache } from './sheets_cache.js';
import { useSheetFile } from './use_sheet_file.js';
import { bindSheetMenus } from './sheet_menus.js';
import './sheets.css';
const Grid = lazy(() => import('../core/sheets_grid.jsx'));
const emptyDirectory = {
  people: [],
  units: [],
  statuses: []
};
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
function SheetEditor({
  account,
  id,
  directory,
  back
}) {
  const shell = useShell(),
    state = useSheetFile(account, id, back),
    {
      file,
      busy,
      error,
      conflict,
      queue,
      replace
    } = state;
  const [mode, setMode] = useState('grid'),
    [selection, setSelection] = useState(null),
    [sheetId, setSheetId] = useState(''),
    [dialog, setDialog] = useState(null),
    [notice, setNotice] = useState(''),
    [actionBusy, setActionBusy] = useState(false),
    [filters, setFilters] = useState({}),
    [versions, setVersions] = useState([]),
    [dismissedWarning, setDismissedWarning] = useState(''),
    filterTimer = useRef(null),
    gridControls = useRef(null),
    menuRoot = useRef(null);
  useEffect(() => bindSheetMenus(menuRoot.current), []);
  useEffect(() => {
    if (file) {
      setSheetId(old => file.document.sheets[old] ? old : file.document.sheetOrder[0]);
    }
  }, [file?.revision, file?.id]);
  useEffect(() => {
    if (file) setFilters(file.filters || {});
  }, [file?.id]);
  useEffect(() => () => clearTimeout(filterTimer.current), []);
  const sheet = file?.document.sheets[sheetId];
  const selectedBlock = sheet?.__bold.blocks.find(block => selection?.sheet === sheet.id && selection.row >= block.startRow && selection.row <= block.startRow + block.rowIds.length);
  function openCellEditor(snapshot, sheetKey, rowIndex, columnIndex) {
    const current = snapshot.sheets[sheetKey],
      block = current.__bold.blocks.find(block => rowIndex > block.startRow && rowIndex <= block.startRow + block.rowIds.length),
      column = block?.columns[columnIndex - 1];
    if (!column || !(['description', 'note'].includes(column.id) || column.type === 'file')) return false;
    const row = block.rowIds[rowIndex - block.startRow - 1],
      item = cell(current, rowIndex, columnIndex);
    setDialog({
      kind: 'rich',
      sheet: current,
      block,
      row,
      column,
      initial: richCellValue(item) || '',
      save: value => queue([{
        kind: 'cell',
        sheet: sheetKey,
        block: block.id,
        row,
        column: column.id,
        before: item,
        after: {
          ...item,
          v: value,
          p: null,
          si: null,
          f: undefined
        }
      }])
    });
    return true;
  }
  const warning = notice || error || file?.calculation_error || (file?.sync_state === 'error' ? file.sync_error : '');
  const calculating = !!file && Number(file.calculated_revision) < Number(file.revision) && !file.calculation_error;
  async function run(action) {
    setDismissedWarning('');
    setActionBusy(true);
    setNotice('');
    try {
      return await action();
    } catch (problem) {
      setNotice(problem.message);
    } finally {
      setActionBusy(false);
    }
  }
  async function editSheet(kind, key = sheetId) {
    if (kind === 'sheet.remove' && file.document.sheetOrder.length <= 1) {
      setNotice('El archivo debe conservar al menos una hoja.');
      return;
    }
    if (kind === 'sheet.remove' && !(await confirmBold('¿Eliminar la hoja? Las tareas se conservan.'))) return;
    let name;
    if (['sheet.add', 'sheet.rename', 'sheet.copy'].includes(kind)) {
      name = await promptBold('Nombre de la hoja', kind === 'sheet.add' ? 'Nueva hoja' : file.document.sheets[key].name);
      if (!name?.trim()) return;
    }
    queue([{
      kind,
      sheet: key,
      ...(name ? {
        name
      } : {})
    }]);
  }
  function changeFilter(block, value) {
    const next = {
      ...filters,
      [block]: value
    };
    setFilters(next);
    clearTimeout(filterTimer.current);
    filterTimer.current = setTimeout(() => sheetsApi.preference(id, {
      filters: next
    }).catch(problem => setNotice(problem.message)), 500);
  }
  return <div ref={menuRoot} className="sheets_module sheets_editor"><BackgroundSyncNotice active={busy || actionBusy || calculating || ['pending', 'syncing', 'importing', 'external'].includes(file?.sync_state)} label={busy ? 'Guardando Sheets…' : actionBusy ? 'Procesando archivo…' : calculating ? 'Calculando fórmulas…' : syncLabels[file?.sync_state]} />{warning && warning !== dismissedWarning && <NoticeLayer><div className="sheets_notice" role="alert"><span>{warning}</span><button aria-label="Cerrar aviso" onClick={() => {
          setDismissedWarning(warning);
          setNotice('');
        }}><X size={14} /></button>{file?.sync_state === "error" && file.can.edit && <button disabled={busy} onClick={()=>setDialog({kind:"import"})}>Revisar actualización</button>}{file?.calculation_error && <button onClick={() => run(async () => replace(await sheetsApi.recalculate(id)))}>Recalcular</button>}{busy && !conflict && <><button onClick={state.retry}>Reintentar guardado</button><button onClick={async () => {
            if (await confirmBold("¿Descartar la primera operación pendiente? Descarga el borrador antes si deseas conservararlo.")) state.discard();
          }}>Descartar operación</button><button onClick={() => download(new Blob([JSON.stringify(state.pending(), null, 2)], {
            type: "application/json"
          }), "borrador-sheets.json")}>Borrador</button></>}</div></NoticeLayer>}<header className="sheets_editor_header"><button className="sheets_mobile_nav" aria-label="Abrir navegación" onClick={()=>shell.set_is_sidebar_open(true)}>☰</button><button aria-label="Volver a archivos" onClick={back}><ArrowLeft size={19} /></button><div><h1>{file?.name || 'Sheets'}</h1><small>{file?.is_template ? 'Plantilla' : syncLabels[file?.sync_state] || 'Copia local'}{busy ? ' · Borrador guardado localmente' : ''}</small></div>{file && <><div className="sheets_view_toggle"><button aria-pressed={mode === 'visual'} onClick={() => setMode('visual')}><LayoutDashboard size={16} />Bloques</button><button aria-pressed={mode === 'grid'} onClick={() => setMode('grid')}><Grid2X2 size={16} />Cuadrícula</button></div>{file.can_recreate_reference && <button disabled={busy||actionBusy} onClick={()=>run(async()=>replace(await sheetsApi.initialAgenda()))}>Recrear contenido de Agenda</button>}{file.can.share && <button onClick={() => setDialog({
          kind: 'share'
        })}><Users size={17} />Compartir</button>}{file.can.export && <button disabled={busy || actionBusy} onClick={() => run(async () => download(await sheetsApi.export(id), file.name + '.xlsx'))}><Download size={17} />Excel</button>}<details><summary aria-label="Más opciones"><MoreHorizontal size={20} /></summary><div className="sheets_context_menu">{file.can.edit && <><button onClick={() => setDialog({
                kind: 'drive'
              })}>Elegir / cambiar carpeta de Drive</button><button onClick={() => run(async () => {
                const name = await promptBold('Nombre del archivo', file.name);
                if (name?.trim()) replace(await sheetsApi.update(id, {
                  name
                }));
              })}>Renombrar archivo</button><button onClick={() => run(async () => replace(await sheetsApi.update(id, {
                is_template: !file.is_template
              })))}>{file.is_template ? 'Quitar de plantillas' : 'Guardar como plantilla'}</button><button onClick={() => run(async () => {
                setVersions(await sheetsApi.versions(id));
                setDialog({
                  kind: 'versions'
                });
              })}>Versiones recuperables</button></>}{file.drive_url && <a href={file.drive_url} target="_blank" rel="noopener noreferrer">Ver vista previa en Drive <ExternalLink size={14} /></a>}{file.can.edit && file.sync_state === 'error' && <button onClick={() => run(async () => replace(await sheetsApi.retry(id)))}>Reintentar Drive</button>}</div></details></>}</header>{file && sheet && <><nav className="sheets_tabs" aria-label="Hojas del archivo">{file.document.sheetOrder.map(key => <div key={key} className={key === sheetId ? 'is_active' : ''}><button aria-current={key === sheetId ? 'page' : undefined} onClick={() => setSheetId(key)}>{file.document.sheets[key].name}</button>{file.can.edit && <details><summary aria-label={`Opciones de ${file.document.sheets[key].name}`}><ChevronMenu /></summary><div className="sheets_context_menu"><button onClick={() => editSheet('sheet.rename', key)}>Renombrar</button><button onClick={() => editSheet('sheet.copy', key)}>Duplicar</button><button onClick={() => editSheet('sheet.remove', key)}>Eliminar</button><button disabled={file.document.sheetOrder.indexOf(key) === 0} onClick={() => {
                const order = [...file.document.sheetOrder],
                  index = order.indexOf(key);
                [order[index - 1], order[index]] = [order[index], order[index - 1]];
                queue([{
                  kind: 'sheet.move',
                  sheet: key,
                  order
                }]);
              }}>Mover a la izquierda</button></div></details>}</div>)}{file.can.edit && <button onClick={() => editSheet('sheet.add')}><Plus size={16} />Hoja</button>}</nav>{file.can.edit && mode === 'visual' && <div className="sheets_palette" aria-label="Insertar bloques">{blockTypes.map(block => <button key={block.id} draggable onDragStart={event => event.dataTransfer.setData('application/x-bold-sheet-block', block.id)} title={block.detail} onClick={() => queue([{
          kind: 'block.add',
          sheet: sheetId,
          type: block.id
        }])}><GripVertical size={13} />{block.label}<Plus size={13} /></button>)}</div>}{mode === 'grid' && <div className="sheets_spreadsheet_menu"><details><summary>Archivo</summary><div className="sheets_context_menu"><button disabled={!file.can.export || busy} onClick={() => run(async () => download(await sheetsApi.export(id), file.name + '.xlsx'))}>Descargar Excel</button><button disabled={!file.can.share} onClick={() => setDialog({
              kind: 'share'
            })}>Compartir</button><button disabled={!file.can.edit || file.owner !== account} onClick={() => setDialog({
              kind: 'drive'
            })}>Destino en Drive</button></div></details><details><summary>Editar</summary><div className="sheets_context_menu"><button disabled={!file.can.edit} onClick={() => gridControls.current?.undo()}>Deshacer</button><button disabled={!file.can.edit} onClick={() => gridControls.current?.redo()}>Rehacer</button></div></details><details><summary>Insertar</summary><div className="sheets_context_menu">{blockTypes.map(block => <button key={block.id} draggable={file.can.edit} onDragStart={event => event.dataTransfer.setData("application/x-bold-sheet-block", block.id)} disabled={!file.can.edit} onClick={() => queue([{
              kind: 'block.add',
              sheet: sheetId,
              type: block.id
            }])}>{block.label}</button>)}<button disabled={!file.can.edit} onClick={() => editSheet('sheet.add')}>Nueva hoja</button></div></details><details><summary>Tabla y tareas</summary><div className="sheets_context_menu"><button disabled={!file.can.edit || !selectedBlock} onClick={() => setDialog({
              kind: 'configure',
              sheet,
              block: selectedBlock
            })}>Configurar columnas, responsables y estados</button><button disabled={!file.can.edit || !selectedBlock} onClick={() => queue([{
              kind: 'row.add',
              sheet: sheetId,
              block: selectedBlock.id,
              index: Math.max(0, selection.row - selectedBlock.startRow)
            }])}>Añadir fila</button><button disabled={!file.can.edit || !selectedBlock || selection.row === selectedBlock?.startRow} onClick={() => run(async () => {
              if (await confirmBold('¿Eliminar la fila? La tarea se conserva.')) queue([{
                kind: 'row.remove',
                sheet: sheetId,
                block: selectedBlock.id,
                row: selectedBlock.rowIds[selection.row - selectedBlock.startRow - 1]
              }]);
            })}>Eliminar fila</button><button disabled={!selectedBlock} onClick={() => {
              const index = selectedBlock.columns.findIndex(column => column.id === 'note' || column.type === 'file');
              if (index >= 0) openCellEditor(file.document, sheetId, Math.max(selection.row, selectedBlock.startRow + 1), index + 1);
            }}>Descripción y comentarios</button></div></details><span>{selectedBlock?.title || 'Selecciona una celda para editar su tabla'}</span></div>}{mode === 'visual' ? <VisualSheet file={file} sheet={sheet} directory={directory} queue={queue} configure={data => setDialog({
        kind: 'configure',
        ...data
      })} openRich={data => setDialog({
        kind: 'rich',
        ...data
      })} filters={filters} setFilters={changeFilter} /> : <Suspense fallback={<p>Abriendo cuadrícula…</p>}><Grid openCellEditor={openCellEditor} onReady={controls => {
          gridControls.current = controls;
        }} onSelection={setSelection} onDropBlock={type => queue([{
          kind: 'block.add',
          sheet: sheetId,
          type
        }])} adapter={gridAdapter} document={file.document} revision={file.revision} activeSheet={sheetId} dark={shell.is_dark_mode} editable={file.can.edit} change={queue} people={directory.people} onError={problem => setNotice(problem.message)} /></Suspense>}</>}{dialog?.kind === 'share' && <ShareDialog file={file} directory={directory} close={() => setDialog(null)} />} {dialog?.kind === 'configure' && <BlockConfiguration {...dialog} directory={directory} canAssign={file.can.assign} close={() => setDialog(null)} save={change => queue([change])} />} {dialog?.kind === 'rich' && <RichCellDialog {...dialog} file={file} close={() => setDialog(null)} />} {dialog?.kind === 'drive' && <SheetDialog title="Destino fijo en Drive" close={() => setDialog(null)}><p>Se actualizará el mismo Excel. No se crearán copias al guardar.</p><DriveFolderPicker disabled={actionBusy} label="Guardar en esta carpeta" submit={folder => run(async () => {
        await replace(await sheetsApi.drive(id, folder));
        setDialog(null);
      })} /></SheetDialog>} {dialog?.kind === 'import' && <ImportDialog file={file} directory={directory} replace={replace} close={() => setDialog(null)} />} {dialog?.kind === 'versions' && <SheetDialog title="Versiones recuperables" close={() => setDialog(null)}>{versions.map(version => <div className="sheets_version" key={version.id}><span>{version.reason === 'drive_conflict' ? 'Cambios de Drive conservados' : version.reason === 'before_drive_import' ? 'BOLD antes de actualizar' : 'Revisión'} {version.revision} · {new Date(version.created_at).toLocaleString('es')}</span><button disabled={busy || actionBusy || !file.can.assign} onClick={() => run(async () => {
          if (await confirmBold('¿Restaurar esta versión? Se conservará una copia del estado actual.')) {
            await replace(await sheetsApi.restoreVersion(id, version.id));
            setDialog(null);
          }
        })}>Restaurar</button></div>)}{!versions.length && <p>Las importaciones y restauraciones guardan versiones recuperables.</p>}</SheetDialog>} {conflict && <ConflictDialog conflict={conflict} pending={state.pending} resolve={state.resolve} close={() => {}} />}</div>;
}
function ChevronMenu() {
  return <MoreHorizontal size={13} />;
}
export default function SheetsModule() {
  const core = useCore(),
    account = core.account?.id,
    [library, setLibrary] = useState({
      files: [],
      folders: [],
      templates: []
    }),
    [directory, setDirectory] = useState(emptyDirectory),
    [selected, setSelected] = useState(null),
    [tab, setTab] = useState('mine'),
    [folder, setFolder] = useState(null),
    [search, setSearch] = useState(''),
    [dialog, setDialog] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const alive = useRef(true),
    epoch = useRef(0),
    libraryRef = useRef(library),
    menuRoot = useRef(null);
  useEffect(() => {
    if (menuRoot.current) return bindSheetMenus(menuRoot.current);
  }, [selected]);
  libraryRef.current = library;
  async function load(generation = epoch.current) {
    setBusy(true);
    try {
      const next = await sheetsApi.library();
      if (alive.current && generation === epoch.current) {
        const available = new Set(next.files.filter(file => !file.deleted_at).map(file => file.id));
        await Promise.all(libraryRef.current.files.filter(file => !available.has(file.id)).map(file => sheetsCache.remove(account, file.id)));
        if (!alive.current || generation !== epoch.current) return;
        setLibrary(next);
        await sheetsCache.write(account, 'library', next);
        setError('');
      }
    } catch (problem) {
      if (!alive.current || generation !== epoch.current) return;
      setError(problem.message);
      if ([403, 404].includes(problem.status)) {
        setLibrary({
          files: [],
          folders: [],
          templates: []
        });
        setDirectory(emptyDirectory);
        setSelected(null);
        window.dispatchEvent(new CustomEvent('bold:sheets:revoked'));
        await sheetsCache.clear(account);
      }
    } finally {
      if (alive.current && generation === epoch.current) setBusy(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    const generation = ++epoch.current;
    setSelected(null);
    setLibrary({
      files: [],
      folders: [],
      templates: []
    });
    setDirectory(emptyDirectory);
    (async () => {
      try {
        const cache = await sheetsCache.read(account, 'library');
        if (alive.current && generation === epoch.current && cache) setLibrary(cache);
      } catch {}
      if (generation === epoch.current) await load(generation);
    })();
    (async () => {
      try {
        const cache = await sheetsCache.read(account, 'directory');
        if (alive.current && generation === epoch.current && cache) setDirectory(cache);
      } catch {}
      try {
        const next = await sheetsApi.directory();
        if (alive.current && generation === epoch.current) {
          setDirectory(next);
          await sheetsCache.write(account, 'directory', next);
        }
      } catch (problem) {
        if (alive.current && generation === epoch.current) setError(problem.message);
      }
    })();
    const invalidate = () => load();
    const openNotice = event => {
      const identity = event.detail || sessionStorage.getItem('bold:sheets:open');
      if (identity) {
        sessionStorage.removeItem('bold:sheets:open');
        setSelected(identity);
      }
    };
    openNotice({});
    window.addEventListener('bold:sheets:open', openNotice);
    window.addEventListener('bold:permissions-revision', invalidate);
    return () => {
      alive.current = false;
      ++epoch.current;
      window.removeEventListener('bold:sheets:open', openNotice);
      window.removeEventListener('bold:permissions-revision', invalidate);
    };
  }, [account, core.activeAssignment?.id]);
  async function run(action) {
    setBusy(true);
    setError('');
    try {
      await action();
      await load();
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  }
  function open(file) {
    setSelected(file.id);
  }
  async function editTemplate(template) {
    if (template.id === 'agenda') await run(async () => open(await sheetsApi.agendaTemplate()));
    else open(template);
  }
  async function removeTemplate(template) {
    await run(async () => {
      if (!await confirmBold(`¿Eliminar la plantilla «${template.name}»? Podrás recuperarla en Papelera. Los archivos creados con ella se conservarán.`)) return;
      if (template.id === 'agenda') await sheetsApi.agendaTemplate(true);
      else await sheetsApi.remove(template.id);
    });
  }
  const templates = [...library.templates, ...library.files.filter(file => file.is_template && !file.deleted_at)];
  const files = library.files.filter(file => (tab === 'trash' ? !!file.deleted_at : !file.deleted_at) && (tab === 'shared' ? file.owner !== account : tab === 'templates' ? file.is_template : tab === 'favorites' ? file.favorite : tab === 'mine' ? file.owner === account : true) && (!folder || file.folder === folder) && file.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  if (selected) return <SheetEditor key={selected} account={account} id={selected} directory={directory} back={() => {
    setSelected(null);
    load();
  }} />;
  return <div ref={menuRoot} className="sheets_module sheets_library"><BackgroundSyncNotice active={busy} label="Actualizando Sheets…" /><header><div><h1>Sheets</h1><p>Organiza ideas, costos y tareas en un mismo archivo.</p></div><button aria-label="Actualizar archivos" onClick={()=>load()} disabled={busy}><RefreshCw size={17} /></button>{library.can_create && <><button disabled={busy} onClick={()=>setDialog({kind:"new",uploading:true})}><Download size={17} />Subir Excel</button><button className="sheets_primary" disabled={busy} onClick={() => setDialog({
        kind: 'new', asTemplate: tab === 'templates'
      })}><Plus size={17} />{tab === 'templates' ? 'Nueva plantilla' : 'Nuevo archivo'}</button></>}</header><div className="sheets_library_body"><aside><nav>{[['mine', 'Mis archivos'], ['shared', 'Compartidos'], ['favorites', 'Favoritos'], ['templates', 'Plantillas'], ['trash', 'Papelera']].map(([key, label]) => <button key={key} aria-current={tab === key ? 'page' : undefined} onClick={() => {
            setTab(key);
            setFolder(null);
          }}>{label}</button>)}</nav><h3>Carpetas</h3>{library.folders.filter(item => !item.parent || item.parent === folder).map(item => <div className="sheets_folder_row" key={item.id}><button aria-current={folder === item.id ? 'page' : undefined} onClick={() => {
            setFolder(item.id);
            setTab('mine');
          }}><Folder size={16} />{item.name}</button><details><summary aria-label="Opciones de carpeta"><MoreHorizontal size={14} /></summary><div className="sheets_context_menu"><button onClick={() => run(async () => {
                const name = await promptBold('Nombre de carpeta', item.name);
                if (name?.trim()) await sheetsApi.folder(item.id, {
                  name
                });
              })}>Renombrar</button><button onClick={() => setDialog({
                kind: 'folderMove',
                item
              })}>Mover</button><button onClick={() => run(async () => {
                if (await confirmBold('¿Eliminar esta carpeta vacía?')) await sheetsApi.folder(item.id);
              })}>Eliminar</button></div></details></div>)}{library.can_create && <button onClick={() => run(async () => {
          const name = await promptBold('Nombre de carpeta');
          if (name?.trim()) await sheetsApi.folder(null, {
            name,
            parent: folder
          });
        })}><Plus size={15} />Nueva carpeta</button>}</aside><main><div className="sheets_library_tools"><div className="sheets_search"><Search size={17} /><input aria-label={tab === 'templates' ? 'Buscar plantilla' : 'Buscar archivo'} placeholder={tab === 'templates' ? 'Buscar plantilla' : 'Buscar archivo'} value={search} onChange={event => setSearch(event.target.value)} /></div>{folder && <button onClick={() => setFolder(library.folders.find(item => item.id === folder)?.parent || null)}><ArrowLeft size={15} />Carpeta anterior</button>}</div>{error && <p className="sheets_error" role="alert">{error}</p>}{library.can_initial_agenda && <div className="sheets_agenda_intro"><Sheet size={28} /><div><strong>Agenda de triunfos</strong><p>Seis hojas originales, nueva estética. Sin responsables ni tareas históricas.</p></div><button className="sheets_primary" disabled={busy} onClick={() => run(async () => open(await sheetsApi.initialAgenda()))}>Recrear Agenda local</button></div>}{tab === 'templates' && <><p className="sheets_template_help">Crea y edita plantillas reutilizables. Los cambios no afectan los archivos creados con ellas.</p><div className="sheets_file_grid">{templates.filter(template => template.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(template => <article key={template.id} className="sheets_file_card sheets_template_card"><span className="sheets_file_icon"><Sheet size={26} /></span><h3>{template.name}</h3><small>{template.sheets ? `${template.sheets.length} hojas` : 'Plantilla guardada'}</small><footer className="sheets_template_actions"><button className="sheets_primary" disabled={busy || !library.can_create} onClick={() => setDialog({kind: 'new', template: template.id})}>Usar plantilla</button>{template.can?.edit && <button disabled={busy} onClick={() => editTemplate(template)}>Editar</button>}{template.can?.delete && <button disabled={busy} aria-label={`Eliminar plantilla ${template.name}`} onClick={() => removeTemplate(template)}><Trash2 size={15} />Eliminar</button>}</footer></article>)}</div>{!templates.some(template => template.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())) && <p className="sheets_empty">No hay plantillas en esta vista.</p>}</>}<div className="sheets_file_grid">{(tab === 'templates' ? [] : files).map(file => <article key={file.id} className="sheets_file_card"><button className="sheets_file_open" disabled={!!file.deleted_at} onClick={() => open(file)}><span className="sheets_file_icon"><Sheet size={28} /></span><h3>{file.name}</h3><small>{file.is_template ? 'Plantilla' : syncLabels[file.sync_state]} · {file.role === 'reader' ? 'Lector' : file.role === 'editor' ? 'Editor' : 'Propietario'}</small></button><footer>{!file.deleted_at ? <><button aria-label={file.favorite ? 'Quitar favorito' : 'Marcar favorito'} onClick={() => run(() => sheetsApi.preference(file.id, {
                  favorite: !file.favorite
                }))}><Star size={16} fill={file.favorite ? 'currentColor' : 'none'} /></button><details><summary aria-label={`Opciones de ${file.name}`}><MoreHorizontal size={17} /></summary><div className="sheets_context_menu">{library.can_create && <button onClick={() => setDialog({
                      kind: 'new',
                      template: file.id
                    })}><Copy size={14} />Duplicar sin asignaciones</button>}{file.can.edit && file.owner === account && <button onClick={() => setDialog({
                      kind: 'move',
                      file
                    })}>Mover a carpeta</button>}{file.can.delete && <button onClick={() => run(async () => {
                      if (await confirmBold('¿Enviar a la papelera? Las tareas se conservan y se desvinculan.')) await sheetsApi.remove(file.id);
                    })}><Trash2 size={14} />Papelera</button>}</div></details></> : file.can.delete && <button onClick={() => run(() => sheetsApi.restore(file.id))}>Restaurar</button>}</footer></article>)}</div>{!files.length && tab !== 'templates' && <p className="sheets_empty">No hay archivos en esta vista.</p>}</main></div>{dialog?.kind === 'new' && <NewFileDialog templates={templates} template={dialog.template} uploading={!!dialog.uploading} asTemplate={!!dialog.asTemplate} folder={folder} close={() => setDialog(null)} created={file => {
      setDialog(null);
      open(file);
      load();
    }} />}{['move', 'folderMove'].includes(dialog?.kind) && <SheetDialog title="Mover a carpeta" close={() => setDialog(null)}><select aria-label="Carpeta de BOLD" defaultValue={dialog.file?.folder || dialog.item?.parent || ''} id="sheets-move-folder"><option value="">Mis archivos (raíz)</option>{library.folders.filter(item => item.id !== dialog.item?.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><footer><button onClick={() => setDialog(null)}>Cancelar</button><button className="sheets_primary" onClick={() => run(async () => {
          const value = document.getElementById('sheets-move-folder').value || null;
          if (dialog.file) await sheetsApi.update(dialog.file.id, {
            folder: value
          });else await sheetsApi.folder(dialog.item.id, {
            parent: value
          });
          setDialog(null);
        })}>Mover</button></footer></SheetDialog>}</div>;
}
