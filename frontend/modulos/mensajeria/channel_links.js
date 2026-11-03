const valid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');
export function channelLinkTarget(search){
    const query=new URLSearchParams(search),channel_id=query.get('slack_channel'),page_id=query.get('slack_page'),parent_id=query.get('slack_thread');
    if(!valid(channel_id))return null;
    if(valid(parent_id))return {channel_id,parent_id};
    return valid(page_id) ? {channel_id,page_id}:null;
}
export function threadLink(channel,parent,location=window.location.href){
    if(!valid(channel) || !valid(parent))throw Error('Referencia de hilo no válida.');
    const url=new URL(location);url.search='';url.hash='';
    url.searchParams.set('slack_channel',channel);url.searchParams.set('slack_thread',parent);
    return url.href;
}
