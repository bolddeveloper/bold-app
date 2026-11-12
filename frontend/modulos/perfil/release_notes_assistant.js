// Piloto operativo del 12 de noviembre. Visibilidad por asignación, separada de las notas públicas.
export const assistantReleaseNotes=[{
    id:'2026-11-12-asistente-privado-aprobaciones',date:'2026-11-12',category:'Piloto IT',icon:'update',
    title:'Un asistente privado que prepara los cambios antes de ejecutarlos',
    summary:'Solicita trabajo por texto, revisa el alcance de consulta y aprueba después los cambios concretos.',
    sections:[{title:'Qué se agregó',items:[
        'Seleccionar @soportebold en Chat o Slack abre una petición privada. También puedes acceder desde Informes, una tarea o un proyecto.',
        'La primera aprobación autoriza las consultas. La segunda autoriza una versión concreta de las acciones; puedes corregir campos o retirar pasos antes de ejecutarlos.',
        'Las consultas puras no requieren aprobación de cambios. El dictado compatible prepara texto editable y nunca envía automáticamente.'
    ]},{title:'Qué probar',items:[
        'Pide crear dos tareas, modifica el título de una, retira o conserva la otra y comprueba que solo se aplica la revisión aprobada.',
        'Recarga la PWA mientras se prepara o ejecuta la petición: recupera el estado y el comprobante sin repetir acciones.'
    ]},{title:'Disponibilidad',items:['Disponible solo para IT durante la validación. El soporte anterior continúa disponible fuera del piloto; Chat y Slack conservan su acceso habitual.']}]
},{
    id:'2026-11-12-asistente-tareas-etapas-proyectos',date:'2026-11-12',category:'Piloto IT',icon:'update',
    title:'Coordina tareas, proyectos y etapas mediante propuestas',
    summary:'Prepara tareas y proyectos, cambia campos y organiza pasos conservando los permisos de cada módulo.',
    sections:[{title:'Qué se agregó',items:[
        'Una petición puede contener varias acciones relacionadas. Cada paso muestra sus campos y los valores actuales disponibles antes de aprobarlo.',
        'Se pueden definir y avanzar etapas ordinarias. Sus dependencias y revisiones siguen protegiendo la finalización de la tarea.',
        'Los cambios simultáneos detienen la operación para evitar sustituir el trabajo de otro empleado. El comprobante permite abrir los registros con tus permisos vigentes.'
    ]},{title:'Qué probar',items:['Crea un proyecto y una tarea con etapas. Comprueba que una etapa obligatoria pendiente impide completar la tarea y que un cambio de un colega exige nueva revisión.']}]
},{
    id:'2026-11-12-asistente-calendarios-recibos',date:'2026-11-12',category:'Piloto IT',icon:'update',
    title:'Reuniones BOLD y Google con revisión y comprobantes',
    summary:'Consulta y prepara reuniones en calendarios autorizados, con avisos de invitados y resultados parciales explícitos.',
    sections:[{title:'Qué se agregó',items:[
        'Prepara creaciones o modificaciones en calendarios BOLD accesibles y en el calendario principal Google conectado. Revisa fechas, zona horaria e invitados.',
        'Google puede notificar a los invitados al aplicar cambios. Una interrupción no provoca reenvío automático; las creaciones de resultado incierto pueden comprobarse sin enviar otra invitación.',
        'Cancelar una solicitud detiene sus pasos pendientes. Las eliminaciones y cancelaciones de reuniones permanecen manuales.'
    ]},{title:'Qué probar',items:['Consulta una agenda antes de proponer cambios y revisa un comprobante mixto de tareas y reuniones. Las pruebas con invitados reales requieren la cuenta y el entorno de aceptación correspondientes.']}]
},{
    id:'2026-11-12-asistente-laboratorio-actividad',date:'2026-11-12',category:'Piloto IT',icon:'update',
    title:'Simula propuestas y consulta la actividad del asistente',
    summary:'Informes incorpora un laboratorio hipotético y el seguimiento privado de las operaciones del asistente.',
    sections:[{title:'Qué se agregó',items:[
        'Compara tareas por estado, carga asignada, proyectos, etapas y cambios de agenda sobre el conjunto autorizado, sin crear tareas, eventos ni invitaciones.',
        'Calcula métricas existentes y guarda o comparte definiciones con aprobación. Compartirlas no concede acceso adicional a sus fuentes.',
        'Consulta solicitudes, acciones, errores, espera y tokens comunicados por Codex. Lo desconocido no se muestra como cero; no se inventan créditos, costes ni productividad.',
        'La supervisión ve solo agregados autorizados, sin conversaciones privadas. Las cuotas se comparten con el soporte existente.'
    ]},{title:'Qué probar',items:['Simula antes de aprobar y comprueba que no aparecen registros nuevos. Abre un informe desde su evidencia y revisa Mi actividad; una cuenta sin supervisión no debe consultar la actividad del equipo.']}]
}];
