import {http} from '../../core/http_client.js';

export const executionApi={
    people:(task,options={})=>http.request(`/api/v2/task-execution/${task}/people/`,options),
    get:(task,options={})=>http.request(`/api/v2/task-execution/${task}/`,options),
    define:(task,body,options={})=>http.request(`/api/v2/task-execution/${task}/`,{...options,method:'PUT',body}),
    act:(task,body,options={})=>http.request(`/api/v2/task-execution/${task}/`,{...options,method:'POST',body}),
    timeline:(task,cursor,options={})=>http.request(`/api/v2/task-execution/${task}/timeline/${cursor?`?before=${cursor.before}`:''}`,options),
    templates:(options={})=>http.request('/api/v2/task-execution/templates/',options),
    saveTemplate:(body,options={})=>http.request('/api/v2/task-execution/templates/',{...options,method:'POST',body}),
};
