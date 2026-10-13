import { Worker } from 'node:worker_threads';
import path from 'node:path';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { readModels } from './native_models.mjs';

const manifestPath = 'bold/native-objects.json';
const ownedPart = name => /^xl\/(?:charts|pivotTables|pivotCache)\/[\w./-]+\.xml(?:\.rels)?$/.test(name);
const parse = value => new DOMParser().parseFromString(value,'application/xml');
const serialize = value => new XMLSerializer().serializeToString(value);
const children = node => [...node.childNodes].filter(item=>item.nodeType===1);
const linkedPart = (owner,target) => target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(owner),target));

// Remove only generated objects, leaving original charts, drawings, relationships and cell changes intact.
export async function clearNativeObjects(buffer,chartParts=[],pivotParts=[]) {
  const zip = await JSZip.loadAsync(buffer), entry = zip.file(manifestPath);
  if (!entry && !chartParts.length && !pivotParts.length) return buffer;
  const manifest = entry ? JSON.parse(await entry.async('string')) : {parts:[]};
  if (chartParts.some(name=>!/^xl\/charts\/chart\d+\.xml$/.test(name))) throw Error('Referencia de gráfico importado inválida.');
  if (pivotParts.some(name=>!/^xl\/pivotTables\/pivotTable\d+\.xml$/.test(name))) throw Error('Referencia de tabla dinámica importada inválida.');
  manifest.parts.push(...chartParts,...pivotParts);
  if (!Array.isArray(manifest.parts) || manifest.parts.length > 1000 || manifest.parts.some(name=>!ownedPart(name))) throw Error('Registro de objetos de Excel inválido.');
  const owned = new Set(manifest.parts);
  for (const name of Object.keys(zip.files).filter(name=>name.endsWith('.rels'))) {
    const match = name.match(/^(.*\/)?_rels\/(.+)\.rels$/);
    if (!match) continue;
    const owner = (match[1] || '') + match[2], rels = parse(await zip.file(name).async('string')), removed = new Set();
    for (const relation of children(rels.documentElement)) if (owned.has(linkedPart(owner,relation.getAttribute('Target')))) {
      removed.add(relation.getAttribute('Id')); relation.parentNode.removeChild(relation);
    }
    if (!removed.size) continue;
    zip.file(name,serialize(rels));
    if (!zip.file(owner)) continue;
    const xml = parse(await zip.file(owner).async('string'));
    for (const element of [...xml.getElementsByTagName('*')]) if (removed.has(element.getAttribute('r:id'))) {
      if (element.localName === 'chart') {
        let anchor = element;
        while (anchor.parentNode !== xml.documentElement && anchor.parentNode) anchor = anchor.parentNode;
        anchor.parentNode.removeChild(anchor);
      } else if (['pivotCache','pivotTablePart'].includes(element.localName)) element.parentNode.removeChild(element);
    }
    for (const element of [...xml.getElementsByTagName('*')]) if (element.localName === 'pivotTableParts') {
      const count = children(element).length;
      if (count) element.setAttribute('count',count); else element.parentNode.removeChild(element);
    }
    zip.file(owner,serialize(xml));
  }
  for (const name of owned) zip.remove(name);
  const types = parse(await zip.file('[Content_Types].xml').async('string'));
  for (const item of children(types.documentElement)) {
    const part = item.getAttribute('PartName');
    if (part && (owned.has(part.replace(/^\//,'')) || part === '/' + manifestPath)) item.parentNode.removeChild(item);
  }
  zip.file('[Content_Types].xml',serialize(types));
  zip.remove(manifestPath);
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
const render = (buffer,document) => new Promise((resolve,reject) => {
  const worker = new Worker(new URL('./native_excel_worker.mjs',import.meta.url), {workerData:{buffer,document}});
  let settled = false;
  const finish = (error,value) => {
    if (settled) return;
    settled = true; clearTimeout(timer); void worker.terminate();
    if (error) reject(error); else resolve(Buffer.from(value));
  };
  const timer = setTimeout(()=>finish(Error('El exportador de gráficos tardó demasiado. Los cambios siguen guardados en BOLD.')),20000);
  worker.once('message', result=>finish(result.error ? Error(result.error) : null,result.buffer));
  worker.once('error',error=>finish(error));
  worker.once('exit',()=>{if (!settled) finish(Error('El exportador de Excel se cerró sin guardar.'));});
});
export async function addNativeObjects(buffer,document) {
  const charts = readModels(document,'__casual_sheets_charts__','charts'), pivots = readModels(document,'__casual_sheets_pivots__','pivots');
  const clean = await clearNativeObjects(buffer,charts.map(item=>item.excelPart).filter(Boolean),pivots.map(item=>item.excelPart).filter(Boolean));
  if (!charts.length && !pivots.length) return clean;
  const before = await JSZip.loadAsync(clean), after = await JSZip.loadAsync(await render(clean,document));
  const added = Object.keys(after.files).filter(name=>!before.file(name) && ownedPart(name));
  const newCharts = added.filter(name=>/^xl\/charts\/chart\d+\.xml$/.test(name)).sort((left,right)=>Number(left.match(/\d+/)[0])-Number(right.match(/\d+/)[0]));
  // Excelize supports native trendlines via OOXML even though its WASM API omits the option.
  for (let index=0;index<charts.length;index++) if (charts[index].format?.trendline) {
    const name = newCharts[index];
    if (!name) throw Error('No se pudo asociar la tendencia al gráfico exportado.');
    const xml = parse(await after.file(name).async('string'));
    for (const series of [...xml.getElementsByTagName('*')].filter(item=>item.localName==='ser')) {
      const trend = xml.createElementNS('http://schemas.openxmlformats.org/drawingml/2006/chart','c:trendline');
      const type = xml.createElementNS('http://schemas.openxmlformats.org/drawingml/2006/chart','c:trendlineType');
      type.setAttribute('val','linear'); trend.appendChild(type); series.appendChild(trend);
    }
    after.file(name,serialize(xml));
  }
  const newPivots=added.filter(name=>/^xl\/pivotTables\/pivotTable\d+\.xml$/.test(name)).sort((left,right)=>Number(left.match(/\d+/)[0])-Number(right.match(/\d+/)[0]));
  after.file(manifestPath,JSON.stringify({version:1,parts:added,charts:charts.map((item,index)=>({id:item.id,part:newCharts[index]})),pivots:pivots.map((item,index)=>({id:item.id,part:newPivots[index]}))}));
  const types = parse(await after.file('[Content_Types].xml').async('string'));
  const part = types.createElementNS(types.documentElement.namespaceURI,'Override');
  part.setAttribute('PartName','/'+manifestPath); part.setAttribute('ContentType','application/json'); types.documentElement.appendChild(part);
  after.file('[Content_Types].xml',serialize(types));
  return after.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
