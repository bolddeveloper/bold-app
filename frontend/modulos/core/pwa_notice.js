import {confirmBold} from './shared/bold_dialog.js';
import {protectPrivateWork} from './shared/private_work.js';

// A flow notice, never a fixed overlay above Login/Send. Features own their
// private contents, protection and exit guards; this UI never reads draft keys.
export function showPwaUpdate(apply,{page=document,protect=protectPrivateWork,confirm=confirmBold}={}){
    if(page.getElementById('bold-pwa-update'))return;
    const previous=page.activeElement,banner=page.createElement('aside'),text=page.createElement('p'),actions=page.createElement('div');
    const update=page.createElement('button'),later=page.createElement('button');
    banner.id='bold-pwa-update';banner.setAttribute('aria-label','Actualización de BOLD');
    text.setAttribute('role','status');text.setAttribute('aria-atomic','true');
    const available='Hay una nueva versión de BOLD. No necesitas reinstalar la aplicación.';
    text.textContent=available;update.type='button';update.textContent='Actualizar BOLD';later.type='button';later.textContent='Más tarde';later.className='pwa_update_later';
    let busy=false;
    const reset=message=>{busy=false;update.disabled=false;later.disabled=false;update.textContent='Actualizar BOLD';text.textContent=message || available;};
    update.addEventListener('click',async()=>{
        if(busy)return;busy=true;update.disabled=true;later.disabled=true;update.textContent='Comprobando…';
        try{
            const protectedWork=await protect();
            const message=protectedWork
                ? '¿Recargar BOLD para aplicar la actualización? Tus borradores protegidos podrán recuperarse al volver, después de comprobar tus permisos.'
                : 'No se pudo confirmar la protección de todos los cambios. Actualizar ahora podría perderlos. Cancela para guardar o reintentar. ¿Recargar BOLD de todos modos?';
            if(!await confirm(message)){reset();return;}
            update.textContent='Actualizando…';text.textContent='Aplicando la actualización. No se enviarán los borradores automáticamente.';
            const accepted=apply({onRetry:reason=>reset(reason==='activation_timeout'
                ? 'La actualización aún no está lista. Puedes seguir trabajando y volver a intentarlo.'
                : 'La recarga no se completó. Tus controles vuelven a estar disponibles; guarda o revisa los cambios y reintenta cuando quieras.')});
            if(accepted===false)reset('La actualización ya está en curso. Si no recarga, podrás reintentar.');
        }catch{reset('No se pudo preparar la actualización. Guarda los cambios y vuelve a intentarlo; no se ha forzado una recarga.');}
    });
    later.addEventListener('click',()=>{
        if(busy)return;banner.remove();
        const target=previous?.isConnected && previous!==page.body ? previous:page.querySelector('#root :is(button,a[href],input,select,textarea,[tabindex])');
        target?.focus?.();
    });
    actions.className='pwa_update_actions';actions.append(update,later);banner.append(text,actions);
    const root=page.getElementById('root');page.body.insertBefore(banner,root || page.body.firstChild);
}
