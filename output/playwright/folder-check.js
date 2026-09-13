async page => {
    await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill('Estudio');
    await page.getByRole('textbox', { name: 'Descripción', exact: true }).fill('Proyectos y tareas relacionados con la universidad');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir carpeta', exact: true }).click();
    await page.getByRole('button', { name: 'Crear subcarpeta', exact: true }).click();
    await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill('Matemáticas y trabajos relacionados');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByRole('button', { name: 'Agregar proyectos o tareas', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Seleccionar Lanzamiento Q4', exact: true }).check();
    await page.getByRole('button', { name: 'Aplicar (1)', exact: true }).click();
    if (!(await page.getByText('Del proyecto', { exact: true }).count())) throw new Error('Inherited tasks missing');
    await page.getByRole('checkbox', { name: 'Seleccionar Lanzamiento Q4', exact: true }).check();
    await page.getByRole('button', { name: 'Mover a carpeta', exact: true }).click();
    await page.getByLabel('Carpeta destino').selectOption({ label: 'Estudio / Matemáticas y trabajos relacionados' });
    await page.getByRole('button', { name: 'Aplicar (1)', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: 'output/playwright/folders-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Abrir carpeta', exact: true }).click();
    if (!(await page.getByText('Del proyecto', { exact: true }).count())) throw new Error('Moved project tasks missing');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'output/playwright/folders-mobile.png', fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) throw new Error('Mobile horizontal overflow');
    await page.getByRole('button', { name: 'Agregar proyectos o tareas', exact: true }).click();
    await page.screenshot({ path: 'output/playwright/folders-mobile-dialog.png', fullPage: true });
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    console.log('Folder create, nesting, association, inherited tasks, move and mobile layout passed');
}
