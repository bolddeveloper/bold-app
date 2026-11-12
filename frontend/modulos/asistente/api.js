import {http} from '../core/http_client.js';
const base='/api/v2/assistant/';
export const assistantApi={
    list:options=>http.request(base+'requests/',options),
    get:(id,options)=>http.request(`${base}requests/${id}/`,options),
    create:body=>http.request(base+'requests/',{method:'POST',body}),
    change:(id,body)=>http.request(`${base}requests/${id}/`,{method:'PATCH',body}),
    act:(id,action,body)=>http.request(`${base}requests/${id}/${action}/`,{method:'POST',body}),
    activity:(scope='self')=>http.request(`${base}activity/?scope=${scope}`),
    evidence:(id,index,group)=>http.request(`${base}requests/${id}/evidence/${index}/${group?`?group=${encodeURIComponent(group)}`:''}`),
    record:(id,step)=>http.request(`${base}requests/${id}/records/${encodeURIComponent(step)}/`),
};
