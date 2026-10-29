import {mentionParts} from './mention_model.js';
import {linkParts} from './messaging_models.js';
import './mentions.css';

export default function MentionText({text,mentions,linkify=true}){
    return mentionParts(text,mentions).map((part,index)=>part.mention ?
        <span className="messaging_mention" title={part.text} key={index}>@{part.mention.name}</span>:
        <span key={index}>{linkify ? linkParts(part.text).map((link,i)=>link.href ? <a key={i} href={link.href} target="_blank" rel="noopener noreferrer">{link.text}</a>:link.text):part.text}</span>);
}
