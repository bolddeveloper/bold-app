async page => {
 const findings=[];await page.emulateMedia({reducedMotion:'reduce'});
 const inspect=async(label, selector)=>{
  const result=await page.locator(selector).filter({visible:true}).evaluateAll(nodes=>nodes.map(node=>{
   const r=node.getBoundingClientRect();let clipped=[];
   for(let p=node.matches(':popover-open')?null:node.parentElement;p&&p!==document.body;p=p.parentElement){const c=getComputedStyle(p),b=p.getBoundingClientRect();if((/(auto|hidden|scroll|clip)/.test(c.overflowX)&& (r.left<b.left-1||r.right>b.right+1))||(/(auto|hidden|scroll|clip)/.test(c.overflowY)&&(r.top<b.top-1||r.bottom>b.bottom+1)))clipped.push(p.className);}
   return {name:node.className,left:r.left,right:r.right,top:r.top,bottom:r.bottom,clipped};
  }).filter(r=>r.left<0||r.right>innerWidth+1||r.top<0||r.bottom>innerHeight+1||r.clipped.length));
  if(result.length)findings.push({label,result});await page.evaluate(value=>document.body.dataset.uxFindings=JSON.stringify(value),findings);
 };
 for(const width of [1440,768,375,320]) {
  await page.setViewportSize({width,height:850});
  await inspect('page '+width,'.tasks_module');
  await page.getByRole('button',{name:'Agregar tarea',exact:true}).click();
  await page.getByRole('dialog',{name:'Nueva tarea',exact:true}).waitFor();
  await inspect('drawer '+width,'.task_drawer_panel');
  const selects=page.locator('.task_drawer_panel .task_select_trigger');
  for(let i=0;i<await selects.count();i++) {
   await selects.nth(i).click();
   await inspect('select '+width+' '+i,'.task_select_menu');
   await selects.nth(i).click();
  }
  await page.locator('.task_drawer_panel .bold_date_trigger_btn').first().click();
  await inspect('calendar '+width,'.custom_datepicker_popover');
  await page.getByRole('combobox',{name:'Año',exact:true}).click();
  await inspect('calendar year '+width,'.task_select_menu');
  await page.getByRole('combobox',{name:/A.o/,exact:true}).click();await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Cancelar',exact:true}).last().click();
 }
 console.log(JSON.stringify(findings));
 await page.evaluate(value=>document.body.dataset.uxFindings=JSON.stringify(value),findings);
}