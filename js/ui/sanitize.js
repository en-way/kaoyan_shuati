/**
 * 前端 HTML 安全转义工具 (js/ui/sanitize.js)
 * 防止动态数据插值至 innerHTML / HTML 属性时破坏 DOM 或引发 XSS。
 */

const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

/**
 * 将任意文本安全转义为 HTML 文本与属性值可用字符串
 * @param {*} value
 * @returns {string}
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, ch => HTML_ESCAPE_MAP[ch]);
}
