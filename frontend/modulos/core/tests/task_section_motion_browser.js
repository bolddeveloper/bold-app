async page=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(8000);
 await page.route(/\/task_app\.jsx(?:\?|$)/,async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nexport {render_board_view};'});});
 await page.route(/\/core_provider\.jsx(?:\?|$)/,async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nexport {CoreContext};'});});
 await page.setViewportSize({width:1440,height:850});await page.goto('http://localhost:5174/tests/fixtures/task-section-motion.html');
 for(const scope of ['mine','project']){
  for(const destination of ['b','c']){
   const before=await page.evaluate(()=>window.moves||0);
   const card=page.locator('[data-task-id="task-1"]');const source=await card.boundingBox();
   const target=await page.locator(`[data-section-id="${destination}"]`).boundingBox();
   await page.mouse.move(source.x+8,source.y+8);await page.mouse.down();await page.mouse.move(source.x+20,source.y+20,{steps:4});
   await page.mouse.move(target.x+40,target.y+85,{steps:8});await page.mouse.move(target.x+42,target.y+87);
   const preview=page.locator(`[data-section-id="${destination}"] .board_drop_preview`);await preview.waitFor();
   if(await page.evaluate(()=>window.moves||0)!==before)throw new Error('Saved before drop');
   if(await preview.textContent()!=='Soltar aquíPreparar propuesta')throw new Error('Wrong preview');
   await page.screenshot({path:`output/playwright/task-drop-${scope}-${destination}.png`,animations:'disabled'});
   await page.mouse.up();await page.locator(`[data-section-id="${destination}"] [data-task-id="task-1"].board_card_just_moved`).waitFor();
   if(await page.locator('[data-task-id="task-1"]').count()!==1)throw new Error('Duplicated task');
   if(await page.locator('.board_drop_preview').count())throw new Error('Preview persists after drop');
   if(await page.evaluate(()=>window.moves||0)!==before+1)throw new Error('Wrong save count');
  }
  if(scope==='mine')await page.locator('#scope').click();
 }
 await page.locator('#readonly').click();if(await page.locator('[draggable=true]').count())throw new Error('Read-only drag enabled');
 for(const width of [1440,375,320]){await page.setViewportSize({width,height:800});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw new Error('Overflow '+width);}
 await page.emulateMedia({reducedMotion:'reduce'});
 if(await page.locator('.board_column').first().evaluate(node=>getComputedStyle(node).transitionDuration)!=='0s')throw new Error('Reduced motion ignored');
 if(errors.length)throw new Error(errors.join('\n'));return 'Task section preview, occupied/empty columns, personal/project moves, no duplicate saves, readonly and responsive layout OK';
}
