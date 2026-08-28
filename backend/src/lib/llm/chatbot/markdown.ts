/**
 * Markdown helpers cho chatbot handlers.
 *
 * Handler dump text thuần vào section content. Frontend (ChatbotMessage.vue)
 * render qua `marked.parse()` — nhờ đó markdown link `[Tên job](/jobs/<id>)`
 * tự trở thành thẻ `<a>` click được trong bubble assistant.
 *
 * Tại sao cần escape: tiêu đề job có thể chứa ký tự markdown đặc biệt
 * (ngoặc tròn `()`, vuông `[]`, gạch ngang `_`, backtick, asterisk) — nếu
 * không escape thì phá cấu trúc link khi parse. Escape inline chỉ các ký
 * tự có thể break link (không escape toàn bộ Markdown special chars).
 */

/**
 * Escape các ký tự markdown có khả năng phá cấu trúc link inline.
 * - `[`, `]`: phá link `[..]`
 * - `(`, `)`: phá URL `(..)`
 * - `` ` ``: mở/đóng code inline
 * - `*`, `_`: italic/bold (ít nguy hiểm với link nhưng vẫn escape cho an toàn)
 * - `\`: ký tự escape chính nó
 */
export const escapeMdLinkText = (s: string): string =>
  s.replace(/[\\[\]()*_`]/g, (c) => `\\${c}`);

/**
 * Build markdown link sang job detail. Route hiện tại là `/jobs/:id`
 * (xem `frontend/src/router/index.ts`).
 */
export const toJobLink = (title: string, id: string): string =>
  `[${escapeMdLinkText(title)}](/jobs/${id})`;
