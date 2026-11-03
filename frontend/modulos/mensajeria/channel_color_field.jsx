import {Check} from "lucide-react";
import ColorPicker from "../core/shared/color_picker.jsx";
import {CHANNEL_COLORS, channelColor} from "./channel_discovery.js";

export default function ChannelColorField({value,onChange,department,server=false}) {
    return <div className="slack_color_field"><span className="slack_field_label">{server ? 'Color del servidor':'Color del canal'}</span><div className="slack_color_options" role="group" aria-label={server ? 'Color del servidor':'Color del canal'}>{CHANNEL_COLORS.map(color=><button type="button" key={color} className="slack_color_option" style={{"--channel-color":color}} aria-label={`Usar color ${color}`} aria-pressed={value.toLowerCase()===color.toLowerCase()} onClick={()=>onChange(color)}><span>{value.toLowerCase()===color.toLowerCase() && <Check size={17} aria-hidden="true"/>}</span></button>)}</div><div className="slack_color_custom"><label>Color personalizado<ColorPicker label={server ? 'Color personalizado del servidor':'Color personalizado del canal'} value={value || channelColor({department})} onChange={onChange}/></label>{!server && <button type="button" onClick={()=>onChange("")} aria-pressed={!value}>Automático</button>}</div>{!server && <small>Automático utiliza el color del departamento; los canales independientes usan el carmesí de BOLD.</small>}</div>;
}
