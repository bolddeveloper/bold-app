import { parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { init } from 'excelize-wasm';
import { nativeChart, nativePivot, readModels } from './native_models.mjs';

try {
  const excelize = await init(fileURLToPath(new URL('./node_modules/excelize-wasm/excelize.wasm.gz', import.meta.url)));
  const file = excelize.OpenReader(workerData.buffer, {UnzipSizeLimit:80_000_000, UnzipXMLSizeLimit:20_000_000});
  if (file.error) throw Error(file.error);
  const charts = readModels(workerData.document,'__casual_sheets_charts__','charts');
  for (const model of charts) {
    const {sheet,anchor,charts:types} = nativeChart(workerData.document,model,excelize);
    const result = types[1] ? file.AddChart(sheet,anchor,types[0],types[1]) : file.AddChart(sheet,anchor,types[0]);
    if (result.error) throw Error('No se pudo exportar el gráfico: ' + result.error);
  }
  for (const model of readModels(workerData.document,'__casual_sheets_pivots__','pivots')) {
    const result = file.AddPivotTable(nativePivot(workerData.document,model,excelize));
    if (result.error) throw Error('No se pudo exportar la tabla dinámica: ' + result.error);
  }
  const output = file.WriteToBuffer();
  if (output.error) throw Error(output.error);
  parentPort.postMessage({buffer:output.buffer});
} catch (error) {parentPort.postMessage({error:error.message});}
