async page => {
    await page.getByRole('button', { name: 'Agregar proyectos o tareas', exact: true }).click();
    const box = await page.getByRole('dialog').boundingBox();
    if (box.y < 0 || box.y + box.height > 845) throw new Error('Dialog outside mobile viewport');
    await page.screenshot({ path: 'output/playwright/folders-mobile-dialog.png' });
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.getByRole('button', { name: 'Workspaces', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: 'output/playwright/folders-desktop.png' });
    await page.reload();
    await page.getByRole('button', { name: 'Ver Workspaces', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir carpeta', exact: true }).click();
    if (!(await page.getByRole('button', { name: 'Matemáticas y trabajos relacionados', exact: true }).count())) throw new Error('Reload lost child folder');
}
