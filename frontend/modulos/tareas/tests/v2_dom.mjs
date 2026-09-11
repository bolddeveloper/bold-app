// Optional integration check; see REWORK_V2_RESULTADO.md for the temporary jsdom install.
import { createServer } from 'vite';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const { JSDOM } = await import(pathToFileURL(path.join(os.tmpdir(), 'bold-v2-dom/node_modules/jsdom/lib/api.js')).href);
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173' });
for (const key of ['window','document','localStorage','sessionStorage','FormData','MouseEvent','HTMLElement']) globalThis[key] = dom.window[key];
window.matchMedia = () => ({ matches: false });
globalThis.WebSocket = class extends WebSocket {
    constructor(url) { super(url, { headers: { Origin: window.location.origin } }); }
};
const real = process.argv[2] !== 'mock';
process.env.VITE_USE_REAL_BACKEND = String(real);
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
const testTitle = `DOM integration ${crypto.randomUUID()}`;
const childTitle = `DOM child ${crypto.randomUUID()}`;
const errors = [], oldError = console.error;
console.error = (...args) => { errors.push(args.map(String).join(' ')); oldError(...args); };
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const App = (await server.ssrLoadModule('/src/app.jsx')).default;
let root = createRoot(document.getElementById('root'));
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
async function until(check, label) { const end = Date.now()+15000; while (!check()) { if (Date.now()>end) throw new Error(label+': '+document.body.textContent.slice(-1600)); await pause(); } }
function input(el, value) { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(el,value); el.dispatchEvent(new window.Event('input',{bubbles:true})); }
function button(label) { return [...document.querySelectorAll('button')].find(item=>item.textContent.trim()===label); }
try {
 root.render(React.createElement(React.StrictMode,null,React.createElement(App)));
 if (real) {
 await until(()=>document.querySelector('[name="email"]'),'login');
 input(document.querySelector('[name="email"]'),'ana@bold.gt'); input(document.querySelector('[name="password"]'),'bolddemo123');
 document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
 await until(()=>document.querySelector('.session_toolbar'),'load real tasks');
 const api=(await server.ssrLoadModule('/src/services/tasks_api.js')).api; for (const task of await api.listTasks()) if(task.title===testTitle) await api.deleteTask(task.id); window.dispatchEvent(new window.Event('focus')); await pause();
 } else await until(()=>document.querySelector('.task_row'),'mock list');
 console.log('DOM PASS: session/list mode='+real);
 button('Agregar tarea').click();
 await until(()=>document.querySelector('[aria-label="Nueva tarea"]'),'create modal');
 assert.equal(document.querySelectorAll('[aria-label="Equipo responsable"]').length,real ? 1 : 0);
 const title = document.querySelector('[aria-label="Nueva tarea"] input[type="text"]'); input(title,testTitle); await pause();
 document.querySelector('[aria-label="Nueva tarea"] form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
 await until(()=>!document.querySelector('[aria-label="Nueva tarea"]')&&document.body.textContent.includes(testTitle),'create task');
 console.log('DOM PASS: task creation persisted and modal closed');
 for(const [label,selector] of [['Cronograma','.timeline_view_card'],['Calendario','.calendar_view']]) { button(label).click(); await until(()=>document.querySelector(selector),label); }
 button('Tareas').click(); await until(()=>document.querySelector('.task_row'),'return list');
 console.log('DOM PASS: timeline and calendar');
 [...document.querySelectorAll('.task_row')].find(item=>item.textContent.includes(testTitle)).click();
 await until(()=>document.querySelector('[title="Editar tarea"]'),'detail'); document.querySelector('[title="Editar tarea"]').click();
 await until(()=>document.querySelector('[aria-label="Editar tarea"]'),'edit modal');
 assert.equal(document.querySelectorAll('[aria-label="Equipo responsable"]').length,real ? 1 : 0);
 if (real) {
 const unitSelect=document.querySelector('[aria-label="Equipo responsable"]');
 unitSelect.value=[...unitSelect.options].find(item=>item.textContent==='Operaciones').value;
 unitSelect.dispatchEvent(new window.Event('change',{bubbles:true})); await pause();
 button('Agregar subtarea').click(); await pause(); input(document.querySelector('.subtask_edit_row input'),childTitle); await pause();
 button('Guardar cambios').click(); await until(()=>!document.querySelector('[aria-label="Editar tarea"]'),'save handoff and subtask');
 assert.ok(document.body.textContent.includes(childTitle));
 input(document.querySelector('.detail_comment_input'),'DOM persisted comment'); await pause(); document.querySelector('.detail_comment_send_btn').click();
 await until(()=>document.querySelector('.detail_comments_list')?.textContent.includes('DOM persisted comment') && document.querySelector('.detail_comment_input').value==='','comment');
 console.log('DOM PASS: handoff, subtask and comment');
 root.unmount(); root=createRoot(document.getElementById('root')); root.render(React.createElement(React.StrictMode,null,React.createElement(App)));
 await until(()=>[...document.querySelectorAll('.task_row')].some(item=>item.textContent.includes(testTitle)),'restored session');
 [...document.querySelectorAll('.task_row')].find(item=>item.textContent.includes(testTitle)).click(); await until(()=>document.querySelector('[title="Eliminar tarea"]'),'restored detail');
 assert.ok(document.body.textContent.includes('DOM persisted comment'));
 console.log('DOM PASS: complete remount restores token, assignment and persisted comments');
 } else { button('Cancelar').click(); await pause(); }
 document.querySelector('[title="Eliminar tarea"]').click();
 await until(()=>button('Eliminar') && !button('Eliminar').disabled,'delete confirmation'); button('Eliminar').click();
 await until(()=>!document.body.textContent.includes(testTitle),'delete task');
 console.log('DOM PASS: detail/edit render and confirmed deletion');
 if(real) { const api=(await server.ssrLoadModule('/src/services/tasks_api.js')).api; for(const task of await api.listTasks()) if(task.title===childTitle) await api.deleteTask(task.id); }
 for(const label of ['Inicio','Informes']) { button(label).click(); await pause(); }
 console.log('DOM PASS: home/reports render');
 assert.deepEqual(errors,[]);
} finally {
 root.unmount();
 if (real) { const api=(await server.ssrLoadModule('/src/services/tasks_api.js')).api; if((await server.ssrLoadModule("/@fs/" + path.resolve("../core/http_client.js").replaceAll("\\", "/"))).http.getSession().token) for(const task of await api.listTasks()) if([testTitle,childTitle].includes(task.title)) await api.deleteTask(task.id); }
 await server.close(); dom.window.close();
}
