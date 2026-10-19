import { http } from '../core/http_client.js';
const root = '/api/v2/sheets/';
const request = (path, method = 'GET', body, options = {}) => http.request(root + path, {
  method,
  ...(body === undefined ? {} : {
    body
  }),
  ...options
});
export const sheetsApi = {
  library: () => request('library/'),
  directory: () => request('directory/'),
  get: id => request(`files/${id}/`),
  create: data => request('files/', 'POST', data),
  initialAgenda: () => request('files/initial-agenda/', 'POST', {}),
  agendaTemplate: (remove = false) => request('files/template-agenda/', remove ? 'DELETE' : 'POST', {}),
  update: (id, data) => request(`files/${id}/`, 'PATCH', data),
  remove: id => request(`files/${id}/`, 'DELETE'),
  restore: id => request(`files/${id}/restore/`, 'POST', {}),
  operation: (id, data) => request(`files/${id}/operations/`, 'POST', data),
  export: id => request(`files/${id}/export/`, 'GET', undefined, {
    responseType: 'blob'
  }),
  folder: (id, data) => request(`folders/${id ? id + '/' : ''}`, id ? data ? 'PATCH' : 'DELETE' : 'POST', data),
  preference: (id, data) => request(`files/${id}/preference/`, 'PUT', data),
  members: (id, data, remove = false) => request(`files/${id}/members/`, data ? remove ? 'DELETE' : 'PUT' : 'GET', data),
  comments: (id, row) => request(`files/${id}/row-comments/?row=${encodeURIComponent(row)}`),
  drive: (id, folder) => request(`files/${id}/drive/`, folder ? 'POST' : 'GET', folder ? {
    folder
  } : undefined),
  retry: id => request(`files/${id}/drive/retry/`, 'POST', {}),
  review: id => request(`files/${id}/drive/review/`, 'POST', {}),
  apply: (id, review, resolutions) => request(`files/${id}/drive/apply/`, 'POST', {
    review,
    resolutions
  }),
  versions: id => request(`files/${id}/versions/`),
  restoreVersion: (id, version) => request(`files/${id}/restore-version/`, 'POST', {
    version
  }),
  ticket: id => request(`files/${id}/ticket/`, 'POST', {}),
  recalculate: id => request(`files/${id}/recalculate/`, 'POST', {})
};
