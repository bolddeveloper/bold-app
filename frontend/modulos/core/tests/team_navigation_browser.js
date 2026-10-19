async (page) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/\/task_app\.jsx(?:\?|$)/, async route => {
        const response = await route.fetch();
        await route.fulfill({response, body: (await response.text()) + '\nexport {render_tasks_module, render_board_view, render_tasks_workspace_menu};'});
    });
    await page.route(/\/core_provider\.jsx(?:\?|$)/, async route => {
        const response = await route.fetch();
        await route.fulfill({response,body:(await response.text())+'\nexport {CoreContext};'});
    });
    const tasks = ['Campaña de lanzamiento con un título extenso para comprobar el diseño del tablero', 'Revisar entregables', 'Planificar siguientes pasos', 'URL-larga-' + 'contenido'.repeat(30)].map((title, i) => ({
        id: 'task-' + i, title, description: 'Seguimiento del trabajo compartido. Las tareas se consultan en modo lectura.',
        stage: ['pending', 'active', 'review'][i % 3],stage_name:['Pendiente','En curso','En revisión'][i % 3],stage_color:'#f59e0b', status_name: 'En curso', priority: ['high', 'medium', 'low'][i % 3],
        assignee_name: 'Samuel', due_date: '2026-10-20', collaborators: ['Carla Ruiz'], created_by_name: 'Samuel', subtasks: [], attachments: [],
    }));
    let shareCalendar = false;
    await page.route('**/api/v2/my-team/**', route => {
        const url = route.request().url();
        if (route.request().method() === 'PATCH') shareCalendar = route.request().postDataJSON().share_calendar;
        const value = url.endsWith('/self/') ? {employee_id: 'samuel', task_ids: [], inherited_ids: [], share_calendar: shareCalendar}
            : url.endsWith('/directory/') ? {departments: [
                {id: 'marketing', name: 'Marketing', people: [{id: 'samuel', name: 'Samuel'}, {id: 'carla', name: 'Carla Ruiz'}]},
                {id: 'operations', name: 'Operaciones', people: [{id: 'david', name: 'David Urbina'}]},
            ]}
            : url.includes('/meetings/') ? {state: 'shared', time_zone: 'America/Tegucigalpa', meetings: [{id: 'meeting', title: 'Planificación del equipo', start: '2026-10-17T09:00:00-06:00', end: '2026-10-17T10:00:00-06:00'}]}
            : url.endsWith('/board/') ? {board_name:'Personal',grouping:'stages',stages:[{id:'pending',label:'Pendiente',color:'#6b7280'},{id:'active',label:'En curso',color:'#3b82f6'},{id:'review',label:'En revisión',color:'#f59e0b'}],sections:[{id:'old',label:'Sin sección'}],tasks}
            : tasks.find(task => url.includes('/' + task.id + '/'));
        return route.fulfill({json: value});
    });
    await page.setViewportSize({width:1440,height:900});
    await page.goto('http://localhost:5174/tests/fixtures/team-navigation.html');
    await page.locator('.team_directory').waitFor();
    const navigation=page.locator('.tasks_submenu');
    const links=await navigation.locator(':scope>button').allTextContents();
    if(links.map(s=>s.trim()).join('|')!=='Mis tareas|Equipo')throw new Error('Sidebar order: '+links);
    if(await page.getByRole('tab',{name:'Equipo',exact:true}).count())throw new Error('Equipo remains a tab');
    if(await page.locator('.team_module .main_section_nav_tabs').count())throw new Error('Task tabs inside Equipo');
    await navigation.getByRole('button',{name:'Mis tareas',exact:true}).click();
    if((await page.getByRole('tab').allTextContents()).join('|')!=='Tareas|Cronograma|Estados')throw new Error('Personal tabs');
    await navigation.getByRole('button',{name:'Equipo',exact:true}).click();
    await page.locator('.team_directory summary').filter({hasText:'Marketing'}).click();
    await page.getByRole('button',{name:'Samuel',exact:true}).click();
    await page.locator('.team_named_board h3').waitFor();
    if((await page.locator('.team_panel .team_section_title').allTextContents()).join('|')!=='Pendiente|En curso|En revisión')throw new Error('Wrong shared stage names');
    if(await page.locator('.team_named_board h3').textContent()!=='Personal')throw new Error('Wrong pipeline name');
    if(await page.locator('.team_panel .board_card').count()!==4)throw new Error('Cards missing');
    if(await page.locator('.team_panel [draggable=true],.team_panel .board_quick_add_button,.team_panel .team_share_eye').count())throw new Error('Editing exposed');
    for(const width of [1440,768,375,320])for(const dark of [false,true]){
        await page.setViewportSize({width,height:800});
        await page.evaluate(value=>document.body.classList.toggle('theme_dark',value),dark);
        if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw new Error('Overflow '+width);
        if(width===1440||width===375)await page.screenshot({path:'output/playwright/team-sidebar-'+width+'-'+dark+'.png',fullPage:true,animations:'disabled'});
    }
    await page.getByRole('button',{name:'Reuniones',exact:true}).click();
    await page.locator('.team_meetings article').waitFor();
    if(errors.length)throw new Error(errors.join('\n'));
    return 'Equipo: sidebar, personal tabs, readonly, meetings, both themes and responsive layout OK';
}
