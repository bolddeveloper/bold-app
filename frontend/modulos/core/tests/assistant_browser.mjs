import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
const require=createRequire(import.meta.url),{chromium}=require(path.join(process.env.LOCALAPPDATA,'BOLDApp/validation/runtime/node_modules/playwright'));
const server=await createServer({configFile:false,root:path.resolve('.'),plugins:[{name:'assistant-isolation',enforce:'pre',transform(_,id){const file=id.replaceAll('\\','/');if(file.endsWith('/core/core_provider.jsx'))return 'export const useCore=()=>globalThis.__assistantCore;';if(file.endsWith('/asistente/api.js'))return 'export const assistantApi=globalThis.__assistantApi;';if(file.endsWith('/core/shared/bold_dialog.js'))return 'export const confirmBold=async()=>true;';}},react()],resolve:{dedupe:['react','react-dom','lucide-react']},cacheDir:path.join(os.tmpdir(),'bold-assistant-browser'),optimizeDeps:{entries:['tests/fixtures/assistant-preview.html']},server:{host:'127.0.0.1',port:0,fs:{allow:[path.resolve('..')]}}});
let browser;
try{
    await server.listen();const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
    browser=await chromium.launch();const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin+'/tests/fixtures/assistant-preview.html');await page.getByRole('button',{name:'Abrir asistente',exact:true}).click();
    await page.getByLabel('¿Qué necesita hacer?').fill('Crear una tarea para revisar texto y otra para revisar diseño');
    await page.getByRole('button',{name:'Preparar resumen',exact:true}).click();
    await page.getByRole('button',{name:'Aprobar alcance y consultar'}).waitFor();
    assert.equal(await page.evaluate(()=>window.__assistantStore().writes),0);
    await page.getByRole('button',{name:'Aprobar alcance y consultar'}).click();
    await page.getByRole('button',{name:'Aprobar y ejecutar 2 acciones'}).waitFor();
    const title=page.getByLabel('Título',{exact:true}).first();await title.fill('Revisar texto ajustado');
    await page.getByRole('button',{name:'Guardar ajustes y revisar'}).click();
    assert.equal(await page.getByLabel('Título',{exact:true}).nth(1).inputValue(),'Revisar diseño');
    await page.getByRole('button',{name:'Simular cambios',exact:true}).click();
    await page.getByText('SIMULACIÓN · No se aplicaron cambios.').waitFor();
    assert.equal(await page.evaluate(()=>window.__assistantStore().writes),0);
    const output=path.join(process.env.LOCALAPPDATA,'BOLDApp/validation/assistant-visual');await mkdir(output,{recursive:true});
    for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
        await page.setViewportSize({width,height});
        for(const dark of [false,true]){
            await page.evaluate(value=>document.documentElement.classList.toggle('theme_dark',value),dark);
            assert.ok(await page.locator('.assistant_panel').evaluate(node=>node.scrollWidth<=node.clientWidth+1),'no horizontal overflow');
            await page.locator('.assistant_panel').screenshot({path:path.join(output,`${name}-${dark?'dark':'light'}.png`)});
        }
    }
    await page.reload();await page.getByRole('button',{name:'Abrir asistente',exact:true}).click();
    await page.getByRole('button',{name:'Aprobar y ejecutar 2 acciones'}).waitFor();
    assert.equal(await page.getByLabel('Título',{exact:true}).first().inputValue(),'Revisar texto ajustado');
    assert.equal(await page.evaluate(()=>window.__assistantStore().writes),0);
    await page.getByRole('button',{name:'Aprobar y ejecutar 2 acciones'}).click();
    await page.getByRole('heading',{name:'Comprobante de ejecución'}).waitFor();
    assert.equal(await page.evaluate(()=>window.__assistantStore().writes),1);
    await page.getByRole('button',{name:'Abrir registro',exact:true}).first().click();
    await page.getByRole('region',{name:'Registro afectado'}).waitFor();
    await page.getByRole('button',{name:'Cerrar registro'}).click();
    await page.evaluate(()=>window.__revokeAssistantSource());
    await page.getByText('El acceso a las fuentes cambió.',{exact:true}).waitFor();
    assert.equal(await page.getByRole('heading',{name:'Comprobante de ejecución'}).count(),0);
    assert.deepEqual(errors,[]);console.log('Assistant browser passed: two approvals, independent step edit, zero-write simulation, reload recovery, authorized receipt viewer, source revocation, desktop/mobile and light/dark.');
}finally{await browser?.close();await server.close();}
