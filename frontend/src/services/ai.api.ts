import { http } from './http';

export const aiApi = {
  chat: async function* (messages: Array<{ role: string; content: string }>) {
    const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('access_token')}`,
      },
      body: JSON.stringify({ messages }),
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n\n').filter(Boolean);
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;
          try {
            const parsed = JSON.parse(data);
            yield parsed.content;
          } catch { /* skip */ }
        }
      }
    }
  },

  parseCv: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return http.post('/ai/cv/parse', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },

  scoreCv: (cvData: Record<string, unknown>) => http.post('/ai/cv/score', { cvData }),
  generateJd: (data: { title: string; industry: string; level: string; keywords: string[] }) =>
    http.post('/ai/jd/generate', data),
  generateCoverLetter: (cvData: Record<string, unknown>, jobDescription: string) =>
    http.post('/ai/cover-letter', { cvData, jobDescription }),
};