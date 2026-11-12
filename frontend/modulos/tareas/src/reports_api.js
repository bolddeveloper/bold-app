import {http} from '../../core/http_client.js';
export const reportsApi={
    catalog:(options={})=>http.request('/api/v2/reports/catalog/',options),
    choices:(q='',options={})=>http.request(`/api/v2/reports/filter-choices/?q=${encodeURIComponent(q)}`,options),
    list:(collection='mine',options={})=>http.request(`/api/v2/reports/?collection=${collection}`,options),
    save:(body,options={})=>http.request('/api/v2/reports/',{...options,method:'POST',body}),
    preview:(body,options={})=>http.request('/api/v2/reports/preview/',{...options,method:'POST',body}),
    download:(body,options={})=>http.request('/api/v2/reports/preview/',{...options,method:'POST',body:{...body,download:true},responseType:'blob'}),
    linkMeeting:(body,options={})=>http.request('/api/v2/reports/meeting-links/',{...options,method:'POST',body}),
    meetingLinks:(event,options={})=>http.request(`/api/v2/reports/meeting-links/?event_id=${encodeURIComponent(event)}`,options),
    unlinkMeeting:(body,options={})=>http.request('/api/v2/reports/meeting-links/',{...options,method:'DELETE',body}),
};
