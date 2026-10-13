import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CasualSheets } from '@casualoffice/sheets/sheets';
import '@univerjs/sheets-data-validation/facade';
import { LocaleType } from '@univerjs/core';
import { DeviceInputEventType } from '@univerjs/engine-render';
import { finishSheetEdit, executeSheetCommand, applyRemoteSheetCells, applyManagedValidations, applyRemoteSheetLayout } from '../hojas/sheet_editing.js';
import {sheetLocales} from './sheets_locales.js';
import '@casualoffice/sheets/styles';
import '@univerjs/sheets-table-ui/lib/index.css';
import '@univerjs/sheets-filter-ui/lib/index.css';
import '@univerjs/sheets-sort-ui/lib/index.css';
import '@univerjs/sheets-conditional-formatting-ui/lib/index.css';
import '@univerjs/sheets-data-validation-ui/lib/index.css';
import '@univerjs/sheets-hyper-link-ui/lib/index.css';
import '@univerjs/sheets-note-ui/lib/index.css';
import '@univerjs/sheets-drawing-ui/lib/index.css';
import '@univerjs/drawing-ui/lib/index.css';
import '@univerjs/thread-comment-ui/lib/index.css';
import '@univerjs/sheets-thread-comment-ui/lib/index.css';
import '@univerjs/find-replace/lib/index.css';
import { SheetChartDialog } from '../hojas/sheet_charts.jsx';
import { SheetPivotDialog } from '../hojas/sheet_pivots.jsx';
const extensions = {dialogs: {'insert-chart': SheetChartDialog, 'insert-pivot': SheetPivotDialog}};
const features = {file:false, branding:false, sparklines:false};
export default function SheetsGrid({
  document,
  revision,
  activeSheet,
  editable,
  dark,
  change,
  onError,
  openCellEditor,
  onReady,
  onSelection,
  onDropBlock,
  people = [],
  adapter
}) {
  const {
    displayGrid,
    gridChanges,
    gridRowChanges,
    normalizeSnapshot
  } = adapter;
  const container = useRef(null),
    currentPeople = useRef(people),
    instance = useRef(null),
    callbacks = useRef({
      change,
      onError,
      openCellEditor,
      onReady,
      onSelection
    }),
    last = useRef(document),
    received = useRef(document),
    metadata = useRef(document),
    applying = useRef(false),
    [problem, setProblem] = useState(''),
    [editFinished, setEditFinished] = useState(0),
    [generation, setGeneration] = useState(0);
  callbacks.current = {
    change,
    onError,
    openCellEditor,
    onReady,
    onSelection
  };
  const initialize = async casual => {
    let disposed = false,
      timer,
      editTimer,
      listeners = [];
    try {
      const univerAPI = casual.univer;
      let book = univerAPI.getActiveWorkbook();
      book.setEditable(editable);
      book.setActiveSheet(activeSheet);
      if (!container.current || !univerAPI.getActiveWorkbook()) return;
      last.current = normalizeSnapshot(casual.getContent(), document, people);
      currentPeople.current = people;
      received.current = document;
      metadata.current = document;
      const capture = () => {
        book = univerAPI.getActiveWorkbook();
        const next = normalizeSnapshot(casual.getContent(), metadata.current, currentPeople.current),
          changes = gridChanges(last.current, next);
        if (changes.length) {
          last.current = next;
          if (editable) callbacks.current.change(changes);
        }
        return changes;
      };
      const commit = () => {
        book = univerAPI.getActiveWorkbook();
        finishSheetEdit(book, univerAPI, DeviceInputEventType.PointerDown);
        return capture();
      };
      const executeCommand = casual.executeCommand.bind(casual);
      const commands = {commit:editable ? commit : null, execute:executeCommand, onError:error => callbacks.current.onError(error)};
      casual.executeCommand = async (id, params) => disposed ? false : executeSheetCommand(commands, id, params);
      listeners.push({dispose:() => {casual.executeCommand = executeCommand;}});
      instance.current = {
        casual,
        univerAPI,
        get book() {return univerAPI.getActiveWorkbook();},
        capture,
        commit
      };
      callbacks.current.onReady?.({
        undo: () => executeSheetCommand({...commands, execute:() => univerAPI.getActiveWorkbook().undo()}, 'univer.command.undo'),
        redo: () => executeSheetCommand({...commands, execute:() => univerAPI.getActiveWorkbook().redo()}, 'univer.command.redo')
      });
      const offSelection = casual.on('selectionChange', selection => {
        const range = selection?.range;
        if (range) callbacks.current.onSelection?.({
          sheet: selection.sheetId,
          row: range.startRow,
          column: range.startColumn
        });
      });
      listeners.push({dispose:offSelection});
      const replaceContent = casual.setContent.bind(casual);
      casual.setContent = snapshot => {
        if (!editable) throw Error('Este archivo está en modo lector.');
        commit();
        const selected = book.getActiveSheet().getSheetId();
        replaceContent(snapshot);
        book = univerAPI.getActiveWorkbook();
        book.setEditable(editable);
        book.setActiveSheet(snapshot.sheets[selected] ? selected : activeSheet);
        casual.emit('change', casual.getContent());
        queueMicrotask(() => {
          if (disposed) return;
          try {capture();} catch(error) {callbacks.current.onError(error);}
        });
      };
      listeners.push({dispose:() => {casual.setContent = replaceContent;}});
      const editCell = params => callbacks.current.openCellEditor?.(normalizeSnapshot(casual.getContent(), metadata.current, currentPeople.current), params.worksheet.getSheetId(), params.row, params.column);
      listeners.push(univerAPI.addEvent(univerAPI.Event.BeforeSheetEditStart, params => {
        if (editCell(params)) params.cancel = true;
      }));
      listeners.push(univerAPI.addEvent(univerAPI.Event.SheetEditEnded, () => {
        clearTimeout(editTimer);
        editTimer = setTimeout(() => {
          if (disposed) return;
          try {capture();} catch (error) {callbacks.current.onError(error);}
          setEditFinished(old => old + 1);
        }, 0);
      }));
      const ownerDocument = container.current.ownerDocument;
      const outside = event => {
        if (disposed || container.current?.contains(event.target)) return;
        try {if (book.isCellEditing()) commit();} catch (error) {callbacks.current.onError(error);}
      };
      ownerDocument.addEventListener('pointerdown', outside, true);
      listeners.push({dispose: () => ownerDocument.removeEventListener('pointerdown', outside, true)});
      if (!editable) listeners.push(univerAPI.addEvent(univerAPI.Event.CellClicked, editCell));
      listeners.push(univerAPI.addEvent(univerAPI.Event.BeforeCommandExecute, command => {
        if (/insert-sheet|remove-sheet|set-worksheet-name|copy-sheet|move-sheet/.test(command.id)) {
          callbacks.current.onError(Error('Organiza las hojas desde las pestañas de BOLD.'));
          command.cancel = true;
          return;
        }
        if (['sheet.command.insert-row', 'sheet.command.insert-row-by-range', 'sheet.command.remove-row-by-range'].includes(command.id)) {
          try {
            const snapshot = normalizeSnapshot(casual.getContent(), metadata.current, currentPeople.current);
            const changes = gridRowChanges(snapshot, command.params.subUnitId, command.id, command.params.range);
            if (changes) {
              command.cancel = true;
              capture();
              callbacks.current.change(changes);
              return;
            }
          } catch (error) {
            command.cancel = true;
            callbacks.current.onError(error);
            return;
          }
        }
        if (/^sheet.command.(insert-col|remove-col)(-by-range)?$/.test(command.id) && command.params?.range) {
          const sheet = metadata.current.sheets[command.params.subUnitId || book.getActiveSheet().getSheetId()];
          if (sheet?.__bold.blocks.some(block => command.params.range.startColumn <= block.columns.length)) {
            command.cancel = true;
            callbacks.current.onError(Error('Configura las columnas de la tabla desde «Tabla y tareas». Se conservan los identificadores de cada campo.'));
            return;
          }
        }
        if (command.id === 'sheet.command.sort-range') {
          const params = command.params,
            sheet = metadata.current.sheets[params.subUnitId],
            range = params.range;
          const block = sheet?.__bold.blocks.find(block => range.startRow <= block.startRow + block.rowIds.length && range.endRow > block.startRow);
          if (block) {
            params.range = {
              ...range,
              startRow: block.startRow + 1,
              endRow: block.startRow + block.rowIds.length,
              startColumn: 0,
              endColumn: block.columns.length
            };
            params.hasTitle = false;
          }
        }
      }));
      listeners.push(univerAPI.addEvent(univerAPI.Event.CommandExecuted, command => {
        // Navigation commands do not edit data or belong in the save/undo flow.
        if (disposed || applying.current || !editable || !command.id.includes('.mutation.') || /formula.*result|set-formula-calculation-result/.test(command.id)) return;
        if (timer) return;
        timer = true;
        queueMicrotask(() => {
          timer = false;
          if (!disposed && !applying.current) {
            try {capture();} catch (error) {callbacks.current.onError(error);}
          }
        });
      }));
    } catch (error) {
      setProblem(error.message);
      callbacks.current.onError(error);
    }
    if (instance.current) instance.current.cleanup = () => {
      if (editable && instance.current) {
        try {instance.current.commit();} catch (error) {callbacks.current.onError(error);}
      }
      disposed = true;
      clearTimeout(editTimer);
      listeners.forEach(listener => listener.dispose());
      instance.current = null;
      callbacks.current.onReady?.(null);
    };
  };
  // Confirm pending cells before the child editor disposes its engine in a passive effect.
  useLayoutEffect(() => () => instance.current?.cleanup?.(), [document.id, generation, editable]);
  useEffect(() => {
    const runtime = instance.current;
    const directoryChanged = JSON.stringify(currentPeople.current) !== JSON.stringify(people);
    if (!runtime || received.current === document && !directoryChanged) return;
    try {
      if (runtime.book.isCellEditing()) return;
      if (runtime.capture().length && editable) return;
      // Compare the live snapshot, not the previous server state: own edits already exist here.
      const incoming = gridChanges(last.current, document, {layout:false});
      if (incoming.some(change => change.kind === 'grid')) {
        received.current = document;
        setGeneration(old => old + 1);
        return;
      }
      const visible = displayGrid(document, people);
      applying.current = true;
      applyRemoteSheetLayout(runtime.univerAPI, runtime.book.getId(), last.current, visible);
      applyManagedValidations(runtime.univerAPI, runtime.book.getId(), runtime.casual.getContent().resources, visible.resources);
      const cellsBySheet = new Map();
      if (directoryChanged) for (const sheet of Object.values(visible.sheets)) for (const block of sheet.__bold.blocks) for (let index=0; index<block.columns.length; index++) {
        if (!['responsible','collaborators'].includes(block.columns[index].type)) continue;
        if (!cellsBySheet.has(sheet.id)) cellsBySheet.set(sheet.id, {});
        const cells = cellsBySheet.get(sheet.id);
        for (let row=block.startRow+1; row<=block.startRow+block.rowIds.length; row++) {
          const value = sheet.cellData?.[row]?.[index+1];
          if (typeof value?.s === 'string') value.s = visible.styles?.[value.s] || {};
          (cells[row] ||= {})[index+1] = value || null;
        }
      }
      for (const change of incoming) {
        const sheet = document.sheets[change.sheet],
          block = change.block && sheet.__bold.blocks.find(block => block.id === change.block);
        const row = block ? block.startRow + block.rowIds.indexOf(change.row) + 1 : change.row,
          col = block ? block.columns.findIndex(col => col.id === change.column) + 1 : change.column;
        if (!cellsBySheet.has(change.sheet)) cellsBySheet.set(change.sheet, {});
        const cells = cellsBySheet.get(change.sheet);
        const value = visible.sheets[change.sheet].cellData?.[row]?.[col];
        if (typeof value?.s === 'string') value.s = visible.styles?.[value.s] || {};
        (cells[row] ||= {})[col] = value || null;
      }
      for (const [sheetId, cells] of cellsBySheet) applyRemoteSheetCells(runtime.univerAPI, runtime.book.getId(), sheetId, cells);
      received.current = document;
      metadata.current = document;
      currentPeople.current = people;
      last.current = normalizeSnapshot(runtime.casual.getContent(), document, people);
    } catch (error) {
      callbacks.current.onError(error);
    } finally {
      applying.current = false;
    }
  }, [document, revision, people, editFinished]);
  useEffect(() => {
    const runtime = instance.current;
    if (!runtime) return;
    try {
      if (runtime.book?.getActiveSheet()?.getSheetId() === activeSheet) return;
      runtime.commit();
      runtime.book.setActiveSheet(activeSheet);
    } catch (error) {callbacks.current.onError(error);}
  }, [activeSheet]);
  // Initial data is consumed only when the engine mounts; status refreshes keep the same input.
  const input = useMemo(() => {
    const snapshot=displayGrid(document, people);
    for (const sheet of Object.values(snapshot.sheets)) delete sheet.__bold;
    return snapshot;
  }, [document.id, generation, editable]);
  return <div className="sheets_grid" onDragOver={event => {
    if (event.dataTransfer.types.includes('application/x-bold-sheet-block')) event.preventDefault();
  }} onDrop={event => {
    const type = event.dataTransfer.getData('application/x-bold-sheet-block');
    if (type) {
      event.preventDefault();
      onDropBlock?.(type);
    }
  }}>{problem && <p role="alert">{problem}</p>}<div ref={container} className="sheets_univer" aria-label="Cuadrícula de Hojas"><CasualSheets
    key={`${document.id}:${generation}:${editable}`}
    initialData={input}
    onReady={api => {initialize(api).catch(error => {setProblem(error.message); callbacks.current.onError(error);});}}
    onChange={() => {queueMicrotask(() => {if (!applying.current && editable) {try {instance.current?.capture();} catch (error) {callbacks.current.onError(error);}}});}}
    onSave={() => {try {instance.current?.commit();} catch (error) {callbacks.current.onError(error);}}}
    onError={error => callbacks.current.onError(Error(error.message || 'No se pudo actualizar la cuadrícula.'))}
    documentMode={editable ? 'editing' : 'viewing'}
    appearance={dark ? 'dark' : 'light'}
    locale={LocaleType.ES_ES} locales={sheetLocales} chrome="full" extensions={extensions} features={features}
    style={{height:'100%', width:'100%', minHeight:0}}
  /></div></div>;
}
