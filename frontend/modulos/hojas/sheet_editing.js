import {canonical} from './sheets_model.js';

const sheetModels=new Set(['__casual_sheets_charts__','__casual_sheets_pivots__','__casual_sheets_sparklines__']);
export const withoutSheetModels=document=>({...document,resources:(document.resources || []).filter(item=>!sheetModels.has(item.name))});
export function applyRemoteSheetModels(casual, resources=[]) {
  const current=casual.getContent();
  const models=items=>items.filter(item=>sheetModels.has(item.name));
  const comparable=items=>canonical(models(items).map(item=>({...item,data:JSON.parse(item.data)})).sort((a,b)=>a.name.localeCompare(b.name)));
  if (JSON.stringify(comparable(current.resources || []))===JSON.stringify(comparable(resources))) return;
  casual.setContent({...current,resources:[...withoutSheetModels(current).resources,...models(resources)]});
}

export function finishSheetEdit(book, api, eventType) {
  if (!book.isCellEditing()) return;
  // Closing without Enter confirms the draft without moving to the next row.
  const confirmed = api.syncExecuteCommand('sheet.operation.set-cell-edit-visible', {
    visible: false, unitId: book.getId(), eventType
  });
  if (!confirmed) throw Error('No se pudo confirmar la celda. Conserva la edición e inténtalo de nuevo.');
}

export async function executeSheetCommand({commit, execute, onError}, id, params) {
  try {
    commit?.();
    return await execute(id, params);
  } catch (error) {onError(error); return false;}
}

export function applyRemoteSheetCells(api, unitId, subUnitId, cellValue) {
  const cleared = Object.fromEntries(Object.entries(cellValue).map(([row, cells]) => [row,
    Object.fromEntries(Object.keys(cells).map(column => [column, null]))]));
  // Mutations update the view without adding another person's edit to local undo history.
  for (const values of [cleared, cellValue]) if (!api.syncExecuteCommand('sheet.mutation.set-range-values', {
    unitId, subUnitId, cellValue:values
  })) throw Error('No se pudo aplicar la actualización. Los cambios siguen guardados.');
}

export function applyManagedValidations(api, unitId, before, after) {
  const rules = resources => JSON.parse(resources?.find(item => item.name === 'SHEET_DATA_VALIDATION_PLUGIN')?.data || '{}');
  const previous = rules(before), next = rules(after);
  for (const subUnitId of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    const managed = items => new Map((items || []).filter(rule => rule.uid?.startsWith('bold-validation-')).map(rule => [rule.uid,rule]));
    const oldRules = managed(previous[subUnitId]), newRules = managed(next[subUnitId]);
    for (const uid of new Set([...oldRules.keys(), ...newRules.keys()])) {
      if (JSON.stringify(oldRules.get(uid)) === JSON.stringify(newRules.get(uid))) continue;
      if (oldRules.has(uid) && !api.syncExecuteCommand('data-validation.mutation.removeRule', {unitId,subUnitId,ruleId:uid,source:'patched'})) throw Error('No se pudo actualizar el selector. Los datos siguen guardados.');
      if (newRules.has(uid) && !api.syncExecuteCommand('data-validation.mutation.addRule', {unitId,subUnitId,rule:newRules.get(uid),source:'patched'})) throw Error('No se pudo actualizar el selector. Los datos siguen guardados.');
    }
  }
}

export function applyRemoteSheetLayout(api, unitId, before, after) {
  for (const id of after.sheetOrder) for (const [field,mutation] of [['columnData','sheet.mutation.set-col-data'],['rowData','sheet.mutation.set-row-data']]) {
    const previous=before.sheets[id]?.[field] || {}, next=after.sheets[id][field] || {};
    const clean=value=>field==='rowData' && value?Object.fromEntries(Object.entries(value).filter(([key])=>key!=='ah')):value;
    const changed=[...new Set([...Object.keys(previous),...Object.keys(next)])].filter(index=>JSON.stringify(canonical(clean(previous[index]) || {}))!==JSON.stringify(canonical(clean(next[index]) || {})));
    if (!changed.length) continue;
    // Replace changed records without remounting or recording remote sizes in local undo.
    const records=Object.fromEntries(changed.map(index=>{
      const value=clean(next[index]);
      return [index,value?{...value,...(typeof value.s==='string'?{s:after.styles?.[value.s] || {}}:{})}:null];
    }));
    for (const data of [Object.fromEntries(changed.map(index=>[index,null])),records]) {
      if (!api.syncExecuteCommand(mutation,{unitId,subUnitId:id,[field]:data})) throw Error('No se pudo actualizar el tamaño. Los cambios siguen guardados.');
    }
  }
}
