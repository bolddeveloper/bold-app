import { useCallback, useEffect, useRef, useState } from 'react';
import { api_base_url } from '../core/http_client.js';
import { sheetsApi } from './sheets_api.js';
import { sheetsCache } from './sheets_cache.js';
import { advancePending, canonical, clone, newerFile, optimistic, repairRejectedDraft } from './sheets_model.js';
export function useSheetFile(account, id, onRevoked) {
  const [file, setFile] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [conflict, setConflict] = useState(null);
  const journal = useRef({
      file: null,
      pending: []
    }),
    running = useRef(false),
    alive = useRef(false),
    epoch = useRef(0),
    storageAllowed = useRef(true),
    conflicted = useRef(false),
    onRevokedRef = useRef(onRevoked),
    flushRef = useRef(null),
    persistChain = useRef(Promise.resolve());
  onRevokedRef.current = onRevoked;
  const persist = useCallback(() => {
    const snapshot = clone(journal.current);
    persistChain.current = persistChain.current.catch(() => {}).then(() => storageAllowed.current && sheetsCache.write(account, id, snapshot));
    return persistChain.current;
  }, [account, id]);
  const render = useCallback(() => {
    let view = journal.current.file;
    if (view) {
      view = clone(view);
      for (const operation of journal.current.pending) view.document = optimistic(view.document, operation.changes);
    }
    setFile(previous => previous && view && JSON.stringify(canonical(previous.document))===JSON.stringify(canonical(view.document)) ? {...view,document:previous.document} : view);
    setBusy(journal.current.pending.length > 0);
  }, []);
  const revoked = useCallback(async () => {
    storageAllowed.current = false;
    journal.current = {
      file: null,
      pending: []
    };
    if (alive.current) {
      setFile(null);
      setBusy(false);
      onRevokedRef.current();
    }
    await persistChain.current.catch(() => {});
    await sheetsCache.remove(account, id);
  }, [account, id]);
  const accept = useCallback(next => {
    if (alive.current && storageAllowed.current && newerFile(next, journal.current.file)) {
      journal.current.file = next;
      render();
      return persist();
    }
    return Promise.resolve();
  }, [persist, render]);
  const refresh = useCallback(async () => {
    const generation = epoch.current;
    try {
      const next = await sheetsApi.get(id);
      if (generation === epoch.current) await accept(next);
    } catch (problem) {
      if (generation !== epoch.current) return;
      if ([403, 404].includes(problem.status)) await revoked();else if (alive.current) setError(problem.message);
    }
  }, [id, accept, revoked]);
  const flush = useCallback(async () => {
    if (running.current || conflicted.current || !alive.current || !journal.current.file) return;
    running.current = true;
    const generation = epoch.current;
    try {
      while (alive.current && generation === epoch.current && journal.current.pending.length) {
        const operation = journal.current.pending[0];
        try {
          if (operation.rejected) {delete operation.rejected;await persist();}
          const next = await sheetsApi.operation(id, operation);
          if (!alive.current || !storageAllowed.current || generation !== epoch.current) return;
          journal.current.pending.shift();
          advancePending(journal.current.pending, operation, next, journal.current.file);
          if (newerFile(next, journal.current.file)) journal.current.file = next;
          render();
          await persist();
          setError('');
        } catch (problem) {
          if (!alive.current || generation !== epoch.current) return;
          if (problem.status===400 || problem.status===422) {
            operation.rejected=true;
            const repaired=journal.current.pending.length>1 && repairRejectedDraft(journal.current.pending,[]);
            if (repaired) {
              journal.current.pending=[{id:crypto.randomUUID(),...repaired}];
              await persist();
              continue;
            }
            await persist();
          }
          if ([403, 404].includes(problem.status)) {
            try {
              await sheetsApi.get(id);
            } catch (accessError) {
              if ([403, 404].includes(accessError.status)) {
                await revoked();
                break;
              }
            }
          }
          if (problem.status === 409 && problem.fields?.document) {
            conflicted.current = true;
            setConflict(problem.fields);
          }
          setError(problem.message);
          break;
        }
      }
    } finally {
      running.current = false;
      if (alive.current) {
        setBusy(journal.current.pending.length > 0);
        if (generation !== epoch.current) flushRef.current();
      }
    }
  }, [id, persist, render, revoked]);
  flushRef.current = flush;
  useEffect(() => {
    alive.current = true;
    const generation = ++epoch.current;
    storageAllowed.current = true;
    conflicted.current = false;
    setConflict(null);
    setFile(null);
    setError('');
    journal.current = {
      file: null,
      pending: []
    };
    let socket,
      reconnect,
      attempts = 0,
      connecting = false;
    (async () => {
      await persistChain.current.catch(() => {});
      try {
        const cached = await sheetsCache.read(account, id);
        if (alive.current && generation === epoch.current && cached) {
          journal.current = cached;
          render();
        }
      } catch (problem) {
        if (alive.current && generation === epoch.current) setError(problem.message);
      }
      if (generation !== epoch.current) return;
      await refresh();
      if (alive.current && generation === epoch.current) {
        flushRef.current();
        connect();
        checkDrive();
      }
    })();
    async function connect() {
      if (!alive.current || generation !== epoch.current || connecting || navigator.onLine === false) return;
      connecting = true;
      try {
        const {
          ticket
        } = await sheetsApi.ticket(id);
        if (!alive.current || generation !== epoch.current) return;
        const url = new URL(`/ws/sheets/${id}/`, api_base_url);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        url.searchParams.set('ticket', ticket);
        socket = new WebSocket(url);
        socket.onopen = () => {
          if (generation !== epoch.current) return;
          attempts = 0;
          refresh().then(() => flushRef.current());
        };
        socket.onmessage = event => {
          if (!alive.current || generation !== epoch.current) return;
          let message;
          try {
            message = JSON.parse(event.data);
          } catch {
            return;
          }
          if (message.revoked) revoked();else if (message.revision !== journal.current.file?.revision || message.sync_state || message.access_changed || message.calculated) refresh().then(()=>{
            if (message.source === 'drive' || message.source === 'task') window.dispatchEvent(new CustomEvent('bold:sheets:office-refresh',{detail:{id}}));
          });
        };
        socket.onclose = event => {
          if (!alive.current || generation !== epoch.current) return;
          if (event.code === 4403) {
            revoked();
            return;
          }
          if (event.code !== 4401) reconnect = setTimeout(connect, Math.min(30000, 1000 * 2 ** attempts++) + Math.random() * 500);
        };
      } catch (problem) {
        if (!alive.current || generation !== epoch.current) return;
        if ([403, 404].includes(problem.status)) revoked();else reconnect = setTimeout(connect, Math.min(30000, 1000 * 2 ** attempts++));
      } finally {
        connecting = false;
      }
    }
    const resume = () => {
      refresh().then(() => flushRef.current());
      if (!socket || socket.readyState > 1) connect();
    };
    const clear = () => revoked();
    const checkDrive = () => {
      if (document.visibilityState === 'visible' && journal.current.file?.drive_folder) sheetsApi.drive(id).then(next => generation === epoch.current && accept(next)).catch(problem => {
        if (!alive.current || generation !== epoch.current) return;
        if ([403, 404].includes(problem.status)) revoked();else setError(problem.message);
      });
    };
    const interval = setInterval(checkDrive, 60000);
    let refreshingJob = false;
    const jobInterval = setInterval(async () => {
      const current = journal.current.file;
      if (!alive.current || generation !== epoch.current || document.visibilityState !== 'visible' || refreshingJob || !current) return;
      if (!['pending', 'syncing', 'importing'].includes(current.sync_state) && (Number(current.calculated_revision) >= Number(current.revision) || current.calculation_error)) return;
      refreshingJob = true;
      try {
        await refresh();
      } finally {
        refreshingJob = false;
      }
    }, 5000);
    window.addEventListener('online', resume);
    window.addEventListener('bold:private-cache-clear', clear);
    window.addEventListener('bold:sheets:revoked', clear);
    window.addEventListener('bold:permissions-revision', resume);
    return () => {
      alive.current = false;
      epoch.current++;
      clearTimeout(reconnect);
      clearInterval(interval);
      clearInterval(jobInterval);
      socket?.close();
      window.removeEventListener('online', resume);
      window.removeEventListener('bold:sheets:revoked', clear);
      window.removeEventListener('bold:private-cache-clear', clear);
      window.removeEventListener('bold:permissions-revision', resume);
    };
  }, [account, id]);
  const queue = useCallback(async changes => {
    if (!storageAllowed.current || !journal.current.file?.can.edit || !changes.length) return;
    const repaired=!running.current && repairRejectedDraft(journal.current.pending,changes);
    const revision=repaired ? repaired.revision : journal.current.file.revision;
    if (repaired) {changes=repaired.changes;journal.current.pending=[];}
    for (let offset = 0; offset < changes.length; offset += 1000) journal.current.pending.push({
      id: crypto.randomUUID(),
      revision,
      changes: clone(changes.slice(offset, offset + 1000))
    });
    render();
    try {
      await persist();
      flushRef.current();
    } catch (problem) {
      setError('No se pudo guardar el borrador local: ' + problem.message);
    }
  }, [persist, render]);
  async function resolve(choices) {
    const pending = journal.current.pending[0];
    if (!pending || !conflict) return;
    journal.current.file = {
      ...journal.current.file,
      document: conflict.document,
      revision: Number(conflict.revision)
    };
    if (conflict.structural) {
      // Keep the draft until an explicit, reviewable resolution is chosen.
      if (choices === 'discard') journal.current.pending.shift();else {
        const payload = clone(pending.changes);
        if (payload.some(change => change.kind === 'grid')) throw Error('La cuadrícula requiere revisar y reconciliar la estructura. Descarga el borrador antes de sustituirlo.');
        journal.current.pending[0] = {
          id: crypto.randomUUID(),
          revision: Number(conflict.revision),
          changes: payload
        };
      }
    } else {
      const updated = clone(pending.changes);
      for (const [index, item] of conflict.conflicts.entries()) {
        const original = updated.find(change => JSON.stringify(change) === JSON.stringify(item.change));
        if (original) {
          original.before = item.current;
          original.after = choices[index] === 'current' ? item.current : item.incoming;
        }
      }
      journal.current.pending[0] = {
        id: crypto.randomUUID(),
        revision: Number(conflict.revision),
        changes: updated
      };
    }
    conflicted.current = false;
    setConflict(null);
    setError('');
    await persist();
    render();
    flushRef.current();
  }
  async function replace(next) {
    await accept(next);
  }
  async function discard() {
    journal.current.pending.shift();
    conflicted.current = false;
    setConflict(null);
    setError('');
    await persist();
    render();
    flushRef.current();
  }
  return {
    file,
    busy,
    error,
    conflict,
    queue,
    refresh,
    retry: flush,
    resolve,
    replace,
    discard,
    pending: () => clone(journal.current.pending)
  };
}
