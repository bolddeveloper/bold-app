import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, Trash2, Plus } from 'lucide-react';
import { useDialog } from '../core/shared/use_dialog.js';
import { TaskText, TaskTextEditor } from '../tareas/src/task_text_editor.jsx';
import { DriveFolderPicker } from '../docs/drive_module.jsx';
import { sheetsApi } from './sheets_api.js';
import { samePerson } from './sheets_model.js';
export function SheetDialog({
  title,
  close,
  children,
  wide = false
}) {
  const id = useId().replace(/:/g, ''),
    reference = useRef(null);
  useDialog(true, `[data-sheet-dialog="${id}"]`, close);
  useEffect(() => {
    reference.current?.showModal();
    return () => reference.current?.close();
  }, []);
  useEffect(() => {
    const shell = document.documentElement;
    const update = () => reference.current?.classList.toggle('sheets_dark', shell.classList.contains('theme_dark'));
    update();
    const observer = new MutationObserver(update);
    if (shell) observer.observe(shell, {
      attributes: true,
      attributeFilter: ['class']
    });
    return () => observer.disconnect();
  }, []);
  return createPortal(<dialog ref={reference} data-sheet-dialog={id} className={`sheets_dialog ${wide ? 'is_wide' : ''}`} aria-labelledby={`${id}-title`} onCancel={event => {
    event.preventDefault();
    close();
  }}><header><h2 id={`${id}-title`}>{title}</h2><button type="button" aria-label="Cerrar" onClick={close}><X size={18} /></button></header>{children}</dialog>, document.body);
}
export function NewFileDialog({
  templates,
  template = '',
  folder,
  uploading = false,
  close,
  created
}) {
  const [title, setTitle] = useState(template === 'agenda' ? 'Agenda de triunfos' : 'Sin título'),
    [selected, setSelected] = useState(template),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [excel, setExcel] = useState(null);
  const identity = useRef(crypto.randomUUID());
  async function create(target) {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const data = {
        id: identity.current,
        name: title,
        template: selected || null,
        folder: folder || null,
        drive_folder: target
      };
      let body = data;
      if (uploading) {
        if (!excel) throw Error('Selecciona un archivo .xlsx de hasta 20 MB.');
        body = new FormData();
        for (const [key,value] of Object.entries(data)) if (value != null && key !== 'template') body.append(key,value);
        body.append('excel',excel);
      }
      const file = await sheetsApi.create(body);
      created(file);
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  }
  return <SheetDialog title={uploading ? 'Subir archivo Excel' : 'Crear archivo de Sheets'} close={close}>{uploading && <label>Archivo Excel<input type="file" accept=".xlsx" disabled={busy} onChange={event=>{
    const selectedFile = event.target.files?.[0];
    if (!selectedFile || !selectedFile.name.toLowerCase().endsWith('.xlsx') || selectedFile.size > 20000000) {setExcel(null);setError('Selecciona un archivo .xlsx de hasta 20 MB.');return;}
    setExcel(selectedFile);setTitle(selectedFile.name.replace(/\.xlsx$/i,''));setError('');
  }} /></label>}<label>Nombre<input autoFocus maxLength={160} value={title} onChange={event => setTitle(event.target.value)} disabled={busy} /></label>{!uploading && <label>Contenido inicial<select value={selected} onChange={event => setSelected(event.target.value)} disabled={busy}><option value="">En blanco</option>{templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<p>Elige dónde guardar el Excel. Los cambios actualizarán este mismo archivo.</p>{uploading && <p>El editor local conserva gráficos, imágenes y tablas dinámicas. La importación no crea tareas históricas.</p>}{error && <p className="sheets_error" role="alert">{error}</p>}<DriveFolderPicker label={busy ? 'Creando…' : uploading ? 'Importar aquí' : 'Crear aquí'} disabled={busy || !title.trim() || uploading && !excel} submit={create} /></SheetDialog>;
}
export function ShareDialog({
  file,
  directory,
  close
}) {
  const [members, setMembers] = useState([]),
    [query, setQuery] = useState(''),
    [role, setRole] = useState('reader'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    sheetsApi.members(file.id).then(rows => {
      if (alive) setMembers(rows);
    }).catch(problem => {
      if (alive) setError(problem.message);
    });
    return () => {
      alive = false;
    };
  }, [file.id]);
  async function change(person, remove = false) {
    setBusy(true);
    setError('');
    try {
      setMembers(await sheetsApi.members(file.id, {
        assignment: person.id,
        role
      }, remove));
      setQuery('');
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  }
  const people = samePerson(directory.people),
    displayed = people.filter(person => `${person.name} ${person.email}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && person.account !== file.owner);
  return <SheetDialog title="Personas del archivo" close={close}><p>Compartir el archivo conserva los permisos de tareas y departamentos.</p><div className="sheets_search"><Search size={17} /><input placeholder="Buscar por nombre o correo" value={query} onChange={event => setQuery(event.target.value)} /><select aria-label="Acceso" value={role} onChange={event => setRole(event.target.value)}><option value="reader">Lector</option><option value="editor">Editor</option></select></div>{error && <p role="alert" className="sheets_error">{error}</p>}<div className="sheets_people">{members.map(member => <div key={member.account}><span><strong>{member.name}</strong><small>{member.email}</small></span><select aria-label={`Acceso de ${member.name}`} value={member.role} disabled={busy} onChange={async event => {
          const person = people.find(person => person.email === member.email);
          if (!person) return;
          setBusy(true);
          try {
            setMembers(await sheetsApi.members(file.id, {
              assignment: person.id,
              role: event.target.value
            }));
          } catch (problem) {
            setError(problem.message);
          } finally {
            setBusy(false);
          }
        }}><option value="reader">Lector</option><option value="editor">Editor</option></select><button aria-label={`Retirar acceso de ${member.name}`} disabled={busy} onClick={() => {
          const person = people.find(person => person.email === member.email);
          if (person) change(person, true);
        }}><Trash2 size={16} /></button></div>)}{query && displayed.map(person => <button key={person.employee} disabled={busy || members.some(member => member.email === person.email)} onClick={() => change(person)}><span><strong>{person.name}</strong><small>{person.email} · {person.department}</small></span><Plus size={17} /></button>)}</div></SheetDialog>;
}
export function RichCellDialog({
  file,
  sheet,
  block,
  row,
  column,
  initial,
  close,
  save
}) {
  const [value, setValue] = useState(initial || ''),
    [comments, setComments] = useState([]),
    [error, setError] = useState(''),
    [imageBusy, setImageBusy] = useState(false);
  const link = file.links.find(link => link.row === row);
  useEffect(() => {
    if (column.id !== 'note' || !link) return;
    let alive = true;
    sheetsApi.comments(file.id, row).then(result => {
      if (alive) setComments(result);
    }).catch(problem => {
      if (alive) setError(problem.message);
    });
    return () => {
      alive = false;
    };
  }, []);
  return <SheetDialog title={column.id === 'note' ? 'Notas y comentarios' : column.name} close={close} wide>{column.id === 'note' && <><p>Cada nota nueva añade un comentario. El historial se conserva.</p><div className="sheets_comment_history">{comments.map(comment => <article key={comment.id}><strong>{comment.author_name}</strong><TaskText value={comment.body} imageTaskId={link?.task} imageHistory /><small>{new Date(comment.created_at).toLocaleString('es')}</small></article>)}</div></>}{error && <p role="alert" className="sheets_error">{error}</p>}<TaskTextEditor allowVoiceNotes={false} onBusyChange={setImageBusy} value={value} onChange={setValue} label={column.id === 'note' ? 'Nueva nota' : 'Descripción'} resourceId={link?.task} disabled={!file.can.edit} /><footer><button onClick={close}>Cancelar</button><button className="sheets_primary" disabled={!file.can.edit || imageBusy || column.id === 'note' && !value.trim()} onClick={() => {
        save(value);
        close();
      }}>{column.id === 'note' ? 'Añadir comentario' : 'Guardar'}</button></footer></SheetDialog>;
}
export function ConflictDialog({
  conflict,
  pending,
  resolve,
  close
}) {
  const [choices, setChoices] = useState({}),
    [error, setError] = useState('');
  const draft = pending()[0];
  return <SheetDialog title="Resolver cambios simultáneos" close={close} wide><p>Ambos valores siguen disponibles. El borrador permanece guardado localmente.</p>{conflict.structural ? <><p>Otra persona cambió la estructura. Revisa el borrador antes de reaplicar.</p><pre className="sheets_diff">{JSON.stringify(draft?.changes.map(change => ({
          ...change,
          document: change.document ? 'Cuadrícula completa conservada en el borrador' : undefined,
          baseDocument: undefined
        })), null, 2)}</pre><button onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], {
          type: 'application/json'
        }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'borrador-sheets.json';
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>Descargar borrador</button></> : conflict.conflicts.map((item, index) => <fieldset key={index}><legend>Hoja {item.sheet}, fila {item.row + 1}, columna {item.column + 1}</legend><label className="sheets_check"><input type="radio" name={`conflict-${index}`} checked={choices[index] === 'current'} onChange={() => setChoices(old => ({
          ...old,
          [index]: 'current'
        }))} />Valor del servidor: {String(item.current.v ?? item.current.f ?? 'Vacío')}</label><label className="sheets_check"><input type="radio" name={`conflict-${index}`} checked={choices[index] === 'incoming'} onChange={() => setChoices(old => ({
          ...old,
          [index]: 'incoming'
        }))} />Tu valor: {String(item.incoming.v ?? item.incoming.f ?? 'Vacío')}</label></fieldset>)}{error && <p role="alert">{error}</p>}<footer>{conflict.structural ? <><button onClick={async () => {
          if (await import('../core/shared/bold_dialog.js').then(module => module.confirmBold('¿Descartar esta operación? Descarga primero el borrador si quieres conservarlo.'))) resolve('discard');
        }}>Conservar servidor</button><button disabled={draft?.changes.some(change => change.kind === 'grid')} onClick={() => resolve('retry').catch(problem => setError(problem.message))}>Reaplicar operación</button></> : <button className="sheets_primary" disabled={Object.keys(choices).length !== conflict.conflicts.length} onClick={() => resolve(choices)}>Aplicar selección</button>}</footer></SheetDialog>;
}
export function ImportDialog({
  file,
  directory,
  replace,
  close
}) {
  const [review, setReview] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(true),
    [resolutions, setResolutions] = useState({});
  useEffect(() => {
    let alive = true;
    sheetsApi.review(file.id).then(next => {
      if (alive) setReview(next);
    }).catch(problem => {
      if (alive) setError(problem.message);
    }).finally(() => {
      if (alive) setBusy(false);
    });
    return () => {
      alive = false;
    };
  }, [file.id]);
  return <SheetDialog title="Actualizar desde Drive" close={close} wide><p>Se guardará una versión recuperable de BOLD antes de aplicar. Las tareas eliminadas del Excel se conservan.</p>{busy && <p>Preparando revisión…</p>}{error && <p className="sheets_error" role="alert">{error}</p>}{review && <><div className="sheets_import_changes"><table><thead><tr><th>Hoja</th><th>Columna</th><th>Antes</th><th>Después</th></tr></thead><tbody>{review.changes.map((item, index) => <tr key={index}><td>{item.sheet}</td><td>{item.column}</td><td>{String(item.before ?? '').slice(0, 160)}</td><td>{String(item.after ?? '').slice(0, 160)}</td></tr>)}</tbody></table></div>{review.issues.map(issue => <label key={issue.id}>{issue.message} ({issue.value})<select value={resolutions[issue.id] ?? 'unresolved'} onChange={event => setResolutions(old => ({
          ...old,
          [issue.id]: event.target.value
        }))}><option value="unresolved">Resolver…</option>{issue.type === 'identity' ? <><option value="new">Confirmar fila nueva</option>{issue.candidates.map(row => <option key={row} value={row}>Fila existente {row}</option>)}</> : issue.type === 'dropdown' ? issue.candidates.map(option => <option key={option.value} value={option.value}>{option.label}</option>) : <><option value="">Dejar sin asignar</option>{samePerson(directory.people, issue.unit || '').map(person => <option key={person.id} value={person.id}>{person.name} · {person.department}</option>)}</>}</select></label>)}<footer><button onClick={close}>Cancelar</button><button className="sheets_primary" disabled={busy || review.issues.some(issue => resolutions[issue.id] === undefined)} onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await replace(await sheetsApi.apply(file.id, review.id, resolutions));
            close();
          } catch (problem) {
            setError(problem.message);
          } finally {
            setBusy(false);
          }
        }}>Aplicar versión revisada</button></footer></>}</SheetDialog>;
}
