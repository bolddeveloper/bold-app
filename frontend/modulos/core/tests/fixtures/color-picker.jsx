import React from 'react';
import {createRoot} from 'react-dom/client';
import ColorPicker from '../../shared/color_picker.jsx';
import ChannelColorField from '../../../mensajeria/channel_color_field.jsx';
import {BlockConfiguration} from '../../../hojas/sheet_block_settings.jsx';
import '../../../tareas/src/styles.css';
import '../../../hojas/sheets.css';
import '../../../mensajeria/messaging.css';
import '../../../mensajeria/channel_controls.css';
import '../../design_v3.css';

// Synthetic local drafts only; no application API or storage.
document.documentElement.classList.toggle('theme_dark',new URLSearchParams(location.search).get('theme')!=='light');
const block={id:'preview',type:'text',title:'Colores de la lista',task:{enabled:false,status_map:{}},columns:[{id:'preview-options',name:'Estado',type:'dropdown',options:[{value:'one',label:'Pendiente',color:'#813782'}]}]};
function Preview(){
    const [color,setColor]=React.useState('#ef1f2d'),[sheet,setSheet]=React.useState(false),[saved,setSaved]=React.useState(null);
    return <main className="bold_v3" style={{padding:24,maxWidth:520,margin:'auto',minHeight:'100dvh'}}>
        <h1>Colores de BOLD</h1><p>Vista previa aislada. Sin guardar datos de la app.</p>
        <ColorPicker label="Color de prueba" value={color} onChange={setColor}/><output style={{marginLeft:12}}>{color}</output>
        <ChannelColorField value={color} onChange={setColor}/>
        <button onClick={()=>setSheet(true)}>Probar opciones de Sheets</button>
        {sheet && <BlockConfiguration sheet={{id:'preview-sheet'}} block={block} directory={{units:[],statuses:[]}} canAssign={false} close={()=>setSheet(false)} save={setSaved}/>}
        {saved && <pre>{JSON.stringify(saved.configuration.columns[0].options)}</pre>}
    </main>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
