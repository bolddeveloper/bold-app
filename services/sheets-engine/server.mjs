import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { calculate, exportExcel, importExcel, shiftRows, reorderBlocks, configureColumns, changeSheet, recreateAgenda } from './codec.mjs';

// Local development uses the same backend .env without copying credentials into a browser bundle.
const envPath = new URL('../../backend/.env', import.meta.url);
if (existsSync(envPath)) for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}
const debug = process.env.DJANGO_DEBUG ?? (/^(true|false|1|0)$/i.test(process.env.DEBUG || '') ? process.env.DEBUG : 'true');
const token = process.env.SHEETS_ENGINE_TOKEN || (/^(true|1)$/i.test(debug) ? process.env.SECRET_KEY || 'django-insecure-boldapp-dev-key' : '');
if (!token) throw Error('SHEETS_ENGINE_TOKEN es obligatorio.');
let active = 0;
const server = createServer(async (request, response) => {
  const supplied = Buffer.from(request.headers.authorization?.replace(/^Bearer /, '') || ''),
    expected = Buffer.from(token);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    response.writeHead(403);
    response.end();
    return;
  }
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
    response.end(JSON.stringify({status: 'ok'}));
    return;
  }
  if (request.method !== 'POST' || !['/calculate', '/export', '/import', '/shift', '/reorder', '/columns', '/sheet', '/recreate'].includes(request.url)) {
    response.writeHead(404);
    response.end();
    return;
  }
  if (active >= 2) {
    response.writeHead(503);
    response.end(JSON.stringify({
      detail: 'Motor ocupado. Reintenta.'
    }));
    return;
  }
  active++;
  try {
    let size = 0;
    const chunks = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 40_000_000) throw Error('Solicitud demasiado grande.');
      chunks.push(chunk);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (request.url === '/export') {
      const {
        buffer
      } = await exportExcel(data.document, data);
      response.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      response.end(buffer);
    } else {
      const result = request.url === '/recreate' ? await recreateAgenda(Buffer.from(data.file, 'base64')) : request.url === '/import' ? await importExcel(Buffer.from(data.file, 'base64'), data) : {
        document: request.url === '/shift' ? await shiftRows(data.document, data) : request.url === '/reorder' ? reorderBlocks(data.document, data) : request.url === '/columns' ? configureColumns(data.document, data) : request.url === '/sheet' ? changeSheet(data.document, data) : await calculate(data.document)
      };
      response.writeHead(200, {
        'Content-Type': 'application/json'
      });
      response.end(JSON.stringify(result));
    }
  } catch (error) {
    response.writeHead(422, {
      'Content-Type': 'application/json'
    });
    response.end(JSON.stringify({
      detail: error.message || 'No se pudo procesar el Excel.'
    }));
  } finally {
    active--;
  }
});
server.requestTimeout = 60000;
server.listen(Number(process.env.PORT || 8010), process.env.SHEETS_ENGINE_HOST || '127.0.0.1');
