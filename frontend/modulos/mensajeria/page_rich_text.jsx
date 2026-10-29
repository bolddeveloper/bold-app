import MentionText from './mention_text.jsx';
import {formattedSegments,codeLanguages} from './page_formats.js';
export function RichPageText({text='',formats=[],mentions}){
    let segments;try{segments=formattedSegments(text,formats);}catch{segments=[{text,attrs:{}}];}
    return segments.map(({text:part,attrs},index)=>{
        let node=attrs.code ? <code>{part}</code>:<MentionText text={part} mentions={mentions} linkify={!attrs.href && !attrs.no_link}/>;
        if(attrs.bold)node=<strong>{node}</strong>;
        if(attrs.italic)node=<em>{node}</em>;
        if(attrs.strike)node=<s>{node}</s>;
        if(attrs.href)node=<a href={attrs.href} target="_blank" rel="noopener noreferrer" title={attrs.href}>{node}</a>;
        return <span key={index}>{node}</span>;
    });
}
export function CodeBlock({row}){
    return <figure className="slack_page_code" data-page-block={row.id} tabIndex={-1}><figcaption>{codeLanguages[row.language] || 'Texto'} · Solo lectura, no se ejecuta</figcaption><pre><code>{row.text}</code></pre></figure>;
}
