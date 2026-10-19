import { useEffect, useRef, useState } from 'react';
import { ChevronDown, GripVertical, Plus, Settings, Trash2, ArrowUp, ArrowDown, Search } from 'lucide-react';
import { TaskText } from '../tareas/src/task_text_editor.jsx';
import { CalendarDateField } from '../tareas/src/task_app.jsx';
import { confirmBold } from '../core/shared/bold_dialog.js';
import { blockCell, costTotal, costRowTotal, groupedRows, samePerson, richCellValue } from './sheets_model.js';
function PersonCell({
  value,
  multiple,
  people,
  unit,
  disabled,
  save
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [position, setPosition] = useState({}),
    reference = useRef(null),
    menu = useRef(null);
  const selected = String(value || '').split(',').filter(Boolean),
    choices = samePerson(people, unit),
    names = selected.map(id => people.find(person => person.id === id)?.name || 'Persona no disponible');
  useEffect(() => {
    const outside = event => {
      if (!reference.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  useEffect(() => {
    if (!open) return;
    menu.current.showPopover();
    const hide = event => {
      if (!reference.current?.contains(event.target)) setOpen(false);
    };
    window.addEventListener('resize', hide);
    document.addEventListener('scroll', hide, true);
    return () => {
      window.removeEventListener('resize', hide);
      document.removeEventListener('scroll', hide, true);
    };
  }, [open]);
  return <div className="sheets_person_select" ref={reference}><button className="sheets_person_value" disabled={disabled} onClick={() => {
      const rect = reference.current.getBoundingClientRect();
      const width=Math.min(260, window.innerWidth-16), maxHeight=Math.min(300, window.innerHeight-16);
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth-width-8)),
        top: Math.max(8, Math.min(rect.bottom+4, window.innerHeight-maxHeight-8)),
        width,
        maxHeight
      });
      setOpen(old => !old);
    }} aria-expanded={open}>{names.length ? names.join(', ') : 'Sin asignar'}<ChevronDown size={13} /></button>{open && <div className="sheets_person_menu" popover="manual" ref={menu} style={position}><label><Search size={15} /><input autoFocus placeholder="Buscar persona" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            setOpen(false);
          }
        }} /></label><button onClick={() => {
        save('');
        if (!multiple) setOpen(false);
      }}>Sin asignar</button>{choices.filter(person => `${person.name} ${person.email}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(person => <button key={person.employee} onClick={() => {
        save(multiple ? (selected.includes(person.id) ? selected.filter(id => id !== person.id) : [...selected, person.id]).join(',') : person.id);
        if (!multiple) setOpen(false);
      }} aria-pressed={selected.includes(person.id)}><span className="sheets_person_option" title={`${person.name} · ${person.department || ''}`}>{person.name}</span>{selected.includes(person.id) && <span className="sheets_person_check" aria-hidden="true">✓</span>}</button>)}</div>}</div>;
}
function InputCell({
  value,
  type,
  save,
  disabled
}) {
  const [draft, setDraft] = useState(value ?? ''),
    focused = useRef(false),
    cancelled = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value ?? '');
  }, [value]);
  return <input className="sheets_cell_input" disabled={disabled} type={['number', 'currency'].includes(type) ? 'number' : 'text'} step={['number', 'currency'].includes(type) ? 'any' : undefined} value={draft} onFocus={() => {
    focused.current = true;
    cancelled.current = false;
  }} onChange={event => setDraft(event.target.value)} onBlur={() => {
    focused.current = false;
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const next = ['number', 'currency'].includes(type) && draft !== '' ? Number(draft) : draft;
    if (next !== (value ?? '')) save(next);
  }} onKeyDown={event => {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
    }
    if (event.key === 'Escape') {
      cancelled.current = true;
      setDraft(value ?? '');
      event.currentTarget.blur();
    }
  }} />;
}
function VisualCell({
  file,
  sheet,
  block,
  row,
  column,
  directory,
  queue,
  openRich
}) {
  const item = blockCell(sheet, block, row, column.id),
    value = item.v ?? '';
  const save = next => queue([{
    kind: 'cell',
    sheet: sheet.id,
    block: block.id,
    row,
    column: column.id,
    before: item,
    after: column.type === 'formula' ? {
      ...item,
      f: String(next).startsWith('=') ? String(next) : '=' + next,
      v: null
    } : {
      ...item,
      v: next,
      p: null,
      si: null,
      f: undefined
    }
  }]);
  const disabled = !file.can.edit || ['responsible', 'collaborators'].includes(column.type) && !file.can.assign;
  if (['responsible', 'collaborators'].includes(column.type)) return <PersonCell value={value} multiple={column.type === 'collaborators'} people={directory.people} unit={block.task.enabled && block.type !== 'tasks' ? block.task.unit : ''} disabled={disabled} save={save} />;
  if (column.type === 'dropdown') return <select className="sheets_cell_select" disabled={disabled} value={value} style={{
    color: column.options?.find(option => option.value === value)?.color
  }} onChange={event => save(event.target.value)}><option value="">Seleccionar</option>{(column.options || []).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
  if (column.type === 'checkbox') return <input type="checkbox" aria-label={column.name} disabled={disabled} checked={!!value} onChange={event => save(event.target.checked)} />;
  if (column.type === 'date') return <CalendarDateField ariaLabel={`Elegir ${column.name}`} value={value} disabled={disabled} onChange={next => {if (next !== value) save(next);}} />;
  if (['description', 'note'].includes(column.id) || column.type === 'file') return <button className="sheets_rich_cell" onClick={() => openRich({
    sheet,
    block,
    row,
    column,
    initial: richCellValue(item),
    save
  })}><TaskText value={richCellValue(item)} />{!value && (column.id === 'note' ? 'Añadir nota' : 'Descripción / archivo')}</button>;
  if (column.type === 'formula' && ['costs', 'comparison'].includes(block.type)) {
    const result = costRowTotal(sheet, block, row, column.id);
    return <output className="sheets_money">{new Intl.NumberFormat('es', {
        style: 'currency',
        currency: block.currency
      }).format(result)}</output>;
  }
  if (column.type === 'formula') return <><InputCell value={item.f || ''} type="text" save={save} disabled={disabled} /><small className="sheets_formula_result">{value}</small></>;
  return <InputCell value={value} type={column.type} save={save} disabled={disabled} />;
}
export function VisualSheet({
  file,
  sheet,
  directory,
  queue,
  configure,
  openRich,
  filters,
  setFilters
}) {
  const [drag, setDrag] = useState(null),
    [over, setOver] = useState(null),
    [folded, setFolded] = useState({});
  const blocks = sheet.__bold.blocks;
  async function moveBlock(id, target) {
    if (id === target) return;
    const order = blocks.map(block => block.id);
    order.splice(order.indexOf(id), 1);
    order.splice(order.indexOf(target), 0, id);
    await queue([{
      kind: 'block.move',
      sheet: sheet.id,
      block: id,
      order
    }]);
  }
  async function moveRow(block, row, target) {
    if (row === target) return;
    const order = [...block.rowIds];
    order.splice(order.indexOf(row), 1);
    order.splice(order.indexOf(target), 0, row);
    await queue([{
      kind: 'row.move',
      sheet: sheet.id,
      block: block.id,
      order
    }]);
  }
  const totals = blocks.filter(block => ['costs', 'comparison'].includes(block.type)).reduce((result, block) => ({
    ...result,
    [block.conversion?.currency || block.currency]: (result[block.conversion?.currency || block.currency] || 0) + costTotal(sheet, block)
  }), {});
  return <div className="sheets_visual" onDragOver={event => {
    if (event.dataTransfer.types.includes('application/x-bold-sheet-block')) event.preventDefault();
  }} onDrop={event => {
    const type = event.dataTransfer.getData('application/x-bold-sheet-block');
    if (type) {
      event.preventDefault();
      queue([{
        kind: 'block.add',
        sheet: sheet.id,
        type
      }]);
    }
  }}>{!blocks.length && <div className="sheets_empty">Arrastra un bloque o agrégalo desde la barra. La cuadrícula también permite empezar desde cero.</div>}{blocks.map((block, index) => {
      const filter = filters[block.id] || {},
        groups = groupedRows(sheet, block, filter, directory.people);
      return <section key={block.id} className={`sheets_block ${over === block.id ? 'is_drop_target' : ''}`} onDragOver={event => {
        if (drag?.kind === 'block') {
          event.preventDefault();
          setOver(block.id);
        }
      }} onDragLeave={() => setOver(null)} onDrop={event => {
        if (drag?.kind === 'block') {
          event.preventDefault();
          event.stopPropagation();
          moveBlock(drag.id, block.id);
          setDrag(null);
          setOver(null);
        }
      }}><header><button className="sheets_grip" aria-label={`Mover bloque ${block.title}`} disabled={!file.can.edit} draggable={file.can.edit} onDragStart={event => {
            event.dataTransfer.setData('text/plain', block.id);
            setDrag({
              kind: 'block',
              id: block.id
            });
          }} onDragEnd={() => {
            setDrag(null);
            setOver(null);
          }} onKeyDown={event => {
            if (event.key === 'ArrowUp' && index) {
              event.preventDefault();
              moveBlock(block.id, blocks[index - 1].id);
            }
            if (event.key === 'ArrowDown' && index < blocks.length - 1) {
              event.preventDefault();
              moveBlock(block.id, blocks[index + 1].id);
            }
          }}><GripVertical size={17} /></button><h3>{block.title}</h3><span className="sheets_block_badge">{block.type === 'tasks' ? 'Tareas automáticas' : block.task.enabled ? 'Tareas conectadas' : block.type === 'costs' || block.type === 'comparison' ? block.currency : 'Bloque'}</span>{file.can.edit && <><button aria-label={`Configurar ${block.title}`} onClick={() => configure({
              sheet,
              block
            })}><Settings size={16} /></button><button aria-label={`Eliminar bloque ${block.title}`} onClick={async () => {
              if (await confirmBold('¿Eliminar el bloque y sus tareas relacionadas? Las tareas se enviarán a la papelera.')) queue([{
                kind: 'block.remove',
                sheet: sheet.id,
                block: block.id
              }]);
            }}><Trash2 size={16} /></button></>}</header><div className="sheets_block_filters"><input aria-label={`Buscar en ${block.title}`} placeholder="Buscar en este bloque" value={filter.search || ''} onChange={event => setFilters(block.id, {
            ...filter,
            search: event.target.value
          })} /><select aria-label="Agrupar filas" value={filter.group || ''} onChange={event => setFilters(block.id, {
            ...filter,
            group: event.target.value
          })}><option value="">Sin agrupar</option><option value="department">Departamento</option><option value="responsible">Responsable</option><option value="status">Estado</option></select>{block.columns.some(col => col.id === 'status') && <select aria-label="Filtrar estado" value={filter.status || ''} onChange={event => setFilters(block.id, {
            ...filter,
            status: event.target.value
          })}><option value="">Todos los estados</option>{block.columns.find(col => col.id === 'status').options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>}</div><div className="sheets_table_scroll"><table><thead><tr><th className="sheets_row_controls" /><>{block.columns.map(col => <th key={col.id}><button onClick={() => {
                      const order = [...block.rowIds].sort((a, b) => String(blockCell(sheet, block, a, col.id).v || '').localeCompare(String(blockCell(sheet, block, b, col.id).v || ''), 'es', {
                        numeric: true
                      }));
                      queue([{
                        kind: 'row.move',
                        sheet: sheet.id,
                        block: block.id,
                        order
                      }]);
                    }} disabled={!file.can.edit}>{col.name}<ChevronDown size={12} /></button></th>)}</><th className="sheets_row_controls" /></tr></thead>{groups.map(([group, rows]) => <tbody key={group}>{filter.group && <tr className="sheets_group"><td colSpan={block.columns.length + 2}><button onClick={() => setFolded(old => ({
                    ...old,
                    [block.id + group]: !old[block.id + group]
                  }))}><ChevronDown size={14} />{group} · {rows.length}</button></td></tr>}{!folded[block.id + group] && rows.map(row => <tr key={row} className={over === row ? 'is_drop_target' : ''} onDragOver={event => {
                if (drag?.kind === 'row' && drag.block === block.id) {
                  event.preventDefault();
                  event.stopPropagation();
                  setOver(row);
                }
              }} onDrop={event => {
                if (drag?.kind === 'row' && drag.block === block.id) {
                  event.preventDefault();
                  event.stopPropagation();
                  moveRow(block, drag.id, row);
                  setDrag(null);
                  setOver(null);
                }
              }}><td><button className="sheets_grip" aria-label="Mover fila; usa flechas arriba o abajo" disabled={!file.can.edit} draggable={file.can.edit} onDragStart={event => {
                    event.dataTransfer.setData('text/plain', row);
                    setDrag({
                      kind: 'row',
                      id: row,
                      block: block.id
                    });
                  }} onDragEnd={() => {
                    setDrag(null);
                    setOver(null);
                  }} onKeyDown={event => {
                    const index = block.rowIds.indexOf(row),
                      target = block.rowIds[index + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0)];
                    if (target && target !== row) {
                      event.preventDefault();
                      moveRow(block, row, target);
                    }
                  }}><GripVertical size={14} /></button></td>{block.columns.map(column => <td key={column.id} aria-label={column.name}><VisualCell file={file} sheet={sheet} block={block} row={row} column={column} directory={directory} queue={queue} openRich={openRich} /></td>)}<td><button aria-label="Eliminar fila" disabled={!file.can.edit} onClick={async () => {
                    if (await confirmBold('¿Eliminar la fila? La tarea se conserva en Mis tareas.')) queue([{
                      kind: 'row.remove',
                      sheet: sheet.id,
                      block: block.id,
                      row
                    }]);
                  }}><Trash2 size={14} /></button></td></tr>)}</tbody>)}</table></div><footer>{file.can.edit && <button onClick={() => queue([{
            kind: 'row.add',
            sheet: sheet.id,
            block: block.id
          }])}><Plus size={15} />Añadir fila</button>}{['costs', 'comparison'].includes(block.type) && <strong>Subtotal {new Intl.NumberFormat('es', {
              style: 'currency',
              currency: block.conversion?.currency || block.currency
            }).format(costTotal(sheet, block))}</strong>}</footer></section>;
    })}{Object.keys(totals).length > 0 && <div className="sheets_cost_summary"><strong>Total por moneda</strong>{Object.entries(totals).map(([currency, total]) => <span key={currency}>{new Intl.NumberFormat('es', {
          style: 'currency',
          currency
        }).format(total)}</span>)}</div>}</div>;
}
