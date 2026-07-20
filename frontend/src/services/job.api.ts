import { http } from './http';

export const jobApi = {
  search: (params: Record<string, unknown>) => http.get('/jobs', { params }),
  detail: (id: string) => http.get(`/jobs/${id}`),
  create: (data: Record<string, unknown>) => http.post('/jobs', data),
  update: (id: string, data: Record<string, unknown>) => http.patch(`/jobs/${id}`, data),
  delete: (id: string) => http.delete(`/jobs/${id}`),
  matches: (id: string) => http.get(`/jobs/${id}/matches`),
  apply: (id: string, data: { cvId: string; coverLetter?: string }) =>
    http.post(`/jobs/${id}/apply`, data),
};