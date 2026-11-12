// Browser acceptance of actual components with synthetic APIs. All external
// network requests are blocked; backend permissions have separate API tests.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
const require=createRequire(import.meta.url),{chromium}=require(path.join(process.env.LOCALAPPDATA,'BOLDApp/validation/runtime/node_modules/playwright'));
const server=await createServer({configFile:false,root:path.resolve('.'),plugins:[{name:'reports-isolation',enforce:'pre',transform(_,id){const file=id.replaceAll('\\','/');if(file.endsWith('/core/core_provider.jsx'))return 'export const useCore=()=>globalThis.__reportsCore;';if(file.endsWith('/tareas/src/reports_api.js'))return 'export const reportsApi=globalThis.__reportsApi;';if(file.endsWith('/tareas/src/execution_api.js'))return 'export const executionApi=globalThis.__executionApi;';if(file.endsWith('/core/shared/bold_dialog.js'))return 'export const confirmBold=async()=>true;';}},react()],define:{'import.meta.env.VITE_USE_REAL_BACKEND':'"true"'},resolve:{dedupe:['react','react-dom','lucide-react','sweetalert2']},cacheDir:path.join(os.tmpdir(),'bold-reports-browser'),optimizeDeps:{entries:['tests/fixtures/reports-preview.html']},server:{host:'127.0.0.1',port:0,fs:{allow:[path.resolve('..')]}}});
let browser;const output=path.join(process.env.LOCALAPPDATA,'BOLDApp/validation/informes-visual');await mkdir(output,{recursive:true});
try{
    await server.listen();const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
    browser=await chromium.launch();const context=await browser.newContext({reducedMotion:'reduce',viewport:{width:1440,height:1000}});
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    const base=`${origin}/tests/fixtures/reports-preview.html`;
    await page.goto(base);await page.getByRole('heading',{name:'Registros de origen'}).waitFor();
    await page.locator('.report_bars button').last().focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('.report_bars button:last-child')?.getAttribute('aria-pressed')==='true');
    await page.getByRole('button',{name:'Crear informe',exact:true}).click();await page.getByLabel('Nombre del informe').fill('Entregas del equipo');
    await page.getByRole('button',{name:'Aplicar y calcular'}).click();await page.getByRole('button',{name:'Guardar informe',exact:true}).click();await page.getByRole('button',{name:'Editar',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.__fixture.calls.filter(row=>row.kind==='save-report').length),1);
    await page.getByRole('button',{name:'Editar',exact:true}).click();
    const before=await page.evaluate(()=>window.__fixture.calls.filter(row=>row.kind==='report').length);
    await page.getByRole('button',{name:'Métrica del informe',exact:true}).click();await page.getByRole('option',{name:'Tareas del período',exact:true}).click();
    await page.evaluate(()=>{for(let i=0;i<25;i++)window.dispatchEvent(new CustomEvent('bold:reports-changed',{detail:{scope:'work',allowed:true}}));});
    await page.waitForFunction(count=>window.__fixture.calls.filter(row=>row.kind==='report').length>count,before);
    const last=await page.evaluate(()=>window.__fixture.calls.filter(row=>row.kind==='report').at(-1).body);assert.ok(last.id,'live refresh uses the confirmed saved query instead of draft filters');
    await page.getByRole('button',{name:'Aplicar y calcular'}).click();
    const applied=await page.evaluate(()=>window.__fixture.calls.filter(row=>row.kind==='report').at(-1).body);assert.equal(applied.definition.metric,'tasks.total');
    await page.getByRole('button',{name:'Salir de la vista de prueba'}).click();await page.getByRole('button',{name:'Volver a la vista de prueba'}).click();await page.getByRole('button',{name:'Métrica del informe',exact:true}).waitFor();
    assert.match(await page.getByRole('button',{name:'Métrica del informe',exact:true}).innerText(),/Tareas del período/);
    for(const dark of [false,true])for(const mobile of [false,true]){
        await page.setViewportSize(mobile?{width:390,height:844}:{width:1440,height:1000});await page.evaluate(value=>document.documentElement.classList.toggle('theme_dark',value),dark);
        const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('body *')].filter(node=>node.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(node=>({tag:node.tagName,class:node.className,width:node.getBoundingClientRect().width}))}));
        assert.ok(layout.scroll<=layout.width+1,`no page-level horizontal overflow: ${JSON.stringify(layout)}`);
        if(!process.argv.includes('--functional-only'))await page.locator('.bold_v3').screenshot({path:path.join(output,`reports-${dark?'dark':'light'}-${mobile?'mobile':'desktop'}.png`)});
    }
    await page.getByRole('button',{name:'Cerrar panel de filtros',exact:true}).click();await page.locator('.report_configuration').waitFor({state:'detached'});await page.waitForFunction(()=>document.activeElement?.closest('.report_toolbar')&&document.activeElement.getAttribute('aria-expanded')==='false');await page.keyboard.press('Enter');assert.match(await page.getByRole('button',{name:'Métrica del informe',exact:true}).innerText(),/Tareas del período/);await page.getByRole('button',{name:'Aplicar y calcular'}).click();await page.locator('.report_configuration').waitFor({state:'detached'});
    await page.setViewportSize({width:1440,height:1000});await page.goto(base+'?phase');await page.getByRole('button',{name:'Comenzar',exact:true}).waitFor();const phaseReads=await page.evaluate(()=>window.__fixture.calls.filter(row=>row.kind==='read-phase').length);assert.equal(await page.evaluate(()=>window.__fixture.subscriptions),0);await page.evaluate(()=>{for(let i=0;i<25;i++){window.dispatchEvent(new CustomEvent('bold:reports-changed',{detail:{scope:'work'}}));window.dispatchEvent(new CustomEvent('bold:task-resource-event',{detail:{taskId:'another-task'}}));}});await page.waitForTimeout(700);assert.equal(await page.evaluate(()=>window.__fixture.calls.filter(row=>row.kind==='read-phase').length),phaseReads,'unrelated work does not reload the open execution panel');await page.getByRole('button',{name:'Comenzar',exact:true}).click();await page.getByRole('button',{name:'Completar etapa',exact:true}).click();await page.getByRole('button',{name:'Comenzar',exact:true}).waitFor();
    await page.getByRole('button',{name:'Configurar',exact:true}).click();await page.getByRole('textbox',{name:'Nombre',exact:true}).first().fill('Revisión ajustada');
    await page.evaluate(()=>window.__fixture.remotePhaseChange());await page.getByText('Revisión de cambios concurrentes',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Guardar etapas',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'He revisado los cambios; conservar mi preparación',exact:true}).click();await page.getByRole('button',{name:'Guardar etapas',exact:true}).click();await page.getByRole('button',{name:'Configurar',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.__fixture.calls.filter(row=>row.kind==='define').at(-1).body.version),4);
    for(const dark of [false,true])for(const mobile of [false,true]){
        await page.setViewportSize(mobile?{width:390,height:844}:{width:1440,height:1000});await page.evaluate(value=>document.documentElement.classList.toggle('theme_dark',value),dark);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'phase panel does not overflow');
        if(!process.argv.includes('--functional-only'))await page.locator('.bold_v3').screenshot({path:path.join(output,`phases-${dark?'dark':'light'}-${mobile?'mobile':'desktop'}.png`)});
    }
    await page.getByRole('button',{name:'Configurar',exact:true}).click();await page.getByRole('textbox',{name:'Nombre',exact:true}).first().fill('Preparación conservada');
    await page.getByRole('button',{name:'Salir de la vista de prueba'}).click();await page.getByRole('button',{name:'Volver a la vista de prueba'}).click();await page.getByRole('button',{name:'Continuar preparación',exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'Nombre',exact:true}).first().inputValue(),'Preparación conservada');
    await page.getByText('Plantillas de proceso',{exact:true}).click();await page.getByLabel('Nombre de la plantilla',{exact:true}).fill('Flujo de prueba');
    await page.locator('.execution_templates').getByText('Compartir con 0 personas',{exact:true}).click();await page.locator('.execution_templates').getByRole('checkbox',{name:/Diseño de prueba/}).check();await page.getByRole('button',{name:'Guardar plantilla',exact:true}).click();
    await page.waitForFunction(()=>window.__fixture.calls.some(row=>row.kind==='save-template'));
    const template=await page.evaluate(()=>window.__fixture.calls.find(row=>row.kind==='save-template').body);assert.equal(template.shared_with.length,1);assert.ok(!('status' in template.definition[0]));
    for(const mobile of [false,true]){await page.setViewportSize(mobile?{width:390,height:844}:{width:1440,height:1000});await page.evaluate(value=>document.documentElement.classList.toggle('theme_dark',value),mobile);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'editor does not overflow');if(!process.argv.includes('--functional-only'))await page.locator('.bold_v3').screenshot({path:path.join(output,`phases-editor-${mobile?'dark-mobile':'light-desktop'}.png`)});}
    assert.deepEqual(errors,[]);console.log(`Reports browser passed: saved definitions, keyboard/focus, scoped live refresh, phase handoff, concurrent-edit review, template sharing, navigation recovery; ${process.argv.includes('--functional-only')?'no new captures':'ten desktop/mobile/theme captures'}.`);
}finally{await browser?.close();await server.close();}
