async page => {
 const results=[];await page.emulateMedia({reducedMotion:'reduce'});page.setDefaultTimeout(5000);
 async function nav(name){const toggle=page.getByRole('button',{name:'Abrir navegacion',exact:true});if(await toggle.isVisible())await toggle.click();await page.locator('.navigation_list').getByRole('button',{name,exact:true}).click();await page.waitForTimeout(50);}
 for(const width of [320,375,768,1024,1440]){
  await page.setViewportSize({width,height:850});
  for(const name of ['Inicio','Bandeja de entrada','Calendario','Docs','Drive','Sugerencias','Informes']){
   await nav(name);
   const metrics=await page.evaluate(()=>({page:document.documentElement.scrollWidth,viewport:innerWidth}));
   if(metrics.page>width+1)results.push({width,name,...metrics});
   if(name==='Inicio'){
    await page.getByRole('button',{name:'Agregar widget',exact:true}).click();
    const menu=page.locator('.home_widget_picker');
    if(await menu.count()){const r=await menu.boundingBox();if(r.x<0||r.x+r.width>width+1)results.push({width,name,menu:r});}
    await page.keyboard.press('Escape');
   }
  }
 }
 await page.evaluate(value=>document.body.dataset.uxPages=JSON.stringify(value),results);
 console.log(results);
}