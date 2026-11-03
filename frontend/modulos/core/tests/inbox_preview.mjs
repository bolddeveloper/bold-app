import {createServer} from 'vite';
import path from 'node:path';
import os from 'node:os';
const server=await createServer({configFile:false,root:path.resolve('.'),logLevel:'error',define:{'import.meta.env.VITE_USE_REAL_BACKEND':'"false"'},resolve:{dedupe:['react','react-dom','lucide-react']},esbuild:{jsx:'automatic'},cacheDir:path.join(os.tmpdir(),'bold-inbox-preview'),optimizeDeps:{noDiscovery:true,include:['react','react-dom','react-dom/client','react/jsx-dev-runtime','react/jsx-runtime','lucide-react'],entries:[]},server:{port:5188,host:'127.0.0.1',strictPort:true,fs:{allow:[path.resolve('..')]}}});
await server.listen();console.log('Vista aislada: http://127.0.0.1:5188/tests/fixtures/inbox-preview.html (sin API).');
await new Promise(resolve=>{for(const signal of ['SIGINT','SIGTERM'])process.once(signal,resolve);});
await server.close();
