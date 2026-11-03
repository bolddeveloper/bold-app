import {createServer} from "vite";
import path from "node:path";
import os from "node:os";
const replacements=[
 ["/core/core_provider.jsx","export const useCore=()=>globalThis.__homeCore;"],
 ["/core/app_shell.jsx","export const useShell=()=>globalThis.__homeShell;"],
 ["/calendario/calendar_api.js","export const calendarApi={connection:(...args)=>globalThis.__homeCalendar.connection(...args),events:(...args)=>globalThis.__homeCalendar.events(...args)};export const localCalendarsApi={agenda:(...args)=>globalThis.__homeLocal.agenda(...args)};"],
];
const server=await createServer({configFile:false,root:path.resolve("."),plugins:[{name:"home-preview-only",enforce:"pre",transform(_,file){return replacements.find(([suffix])=>file.replaceAll("\\","/").endsWith(suffix))?.[1];}}],resolve:{dedupe:["react","react-dom","lucide-react"]},esbuild:{jsx:"automatic"},cacheDir:path.join(os.tmpdir(),"bold-home-preview"),optimizeDeps:{noDiscovery:true,include:["react","react-dom","react-dom/client","react/jsx-dev-runtime","react/jsx-runtime","lucide-react"],entries:[]},server:{port:5189,host:"127.0.0.1",strictPort:true,fs:{allow:[path.resolve("..")]}}});
await server.listen();console.log("Inicio aislado: http://127.0.0.1:5189/tests/fixtures/home-preview.html (sin API).");
await new Promise(resolve=>{for(const signal of ["SIGINT","SIGTERM"])process.once(signal,resolve);});await server.close();
