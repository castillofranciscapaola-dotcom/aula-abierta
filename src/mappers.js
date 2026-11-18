// Convierte entre las filas de PostgreSQL (snake_case) y los objetos del
// frontend (camelCase). Los campos que el frontend envía y que no tienen
// columna propia se guardan en "extra" (JSONB) y se devuelven aplanados.
const sanitizeHtml = require('sanitize-html');

const MAPS = {
  articles: {
    table: 'articles',
    cols: { id:'id', title:'title', summary:'summary', subject:'subject', grade:'grade',
      readTime:'read_time', status:'status', coverImage:'cover_image', coverAlt:'cover_alt',
      author:'author', role:'role', views:'views', content:'content', tags:'tags',
      previousStatus:'previous_status', trashedAt:'trashed_at', createdAt:'created_at', updatedAt:'updated_at' },
    ints: ['readTime','views'], bigints: ['trashedAt','createdAt','updatedAt'], json: ['tags'],
  },
  comments: {
    table: 'comments',
    cols: { id:'id', articleId:'article_id', authorName:'author_name', authorType:'author_type',
      authorBadge:'author_badge', schoolInfo:'school_info', content:'content', status:'status',
      isSpamAlert:'is_spam_alert', teacherReply:'teacher_reply', createdAt:'created_at' },
    ints: [], bigints: ['createdAt'], json: [],
  },
  media: {
    table: 'media',
    cols: { id:'id', title:'title', category:'category', url:'url', sizeKB:'size_kb',
      dimensions:'dimensions', altText:'alt_text', associatedArticle:'associated_article', createdAt:'created_at' },
    ints: ['sizeKB'], bigints: ['createdAt'], json: [],
  },
};

const RICH_HTML = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(['h1','h2','h3','h4','img','figure','figcaption','cite','u','s','span','div','table','thead','tbody','tr','th','td','mark']),
  allowedAttributes: { '*': ['style','class'], a: ['href','target','rel'], img: ['src','alt','width','height'] },
  allowedSchemes: ['http', 'https', 'mailto', 'data'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  // Se permiten estilos en línea (las fichas curriculares los usan) pero no url()/expression()
  allowedStyles: undefined,
  transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }) },
};
const cleanRich = (h) => sanitizeHtml(String(h || ''), RICH_HTML)
  .replace(/style="[^"]*(url\(|expression\(|javascript:)[^"]*"/gi, '');
const cleanText = (s, max = 2000) => sanitizeHtml(String(s ?? ''), { allowedTags: [], allowedAttributes: {} })
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').slice(0, max);

function fromRow(entity, row) {
  const m = MAPS[entity];
  const out = {};
  for (const [camel, col] of Object.entries(m.cols)) {
    let v = row[col];
    if (v === null || v === undefined) { if (['previousStatus','trashedAt','teacherReply','updatedAt'].includes(camel)) continue; }
    if (m.bigints.includes(camel) && v != null) v = Number(v);
    out[camel] = v;
  }
  return Object.assign(out, row.extra || {});
}

// Devuelve { columns:[...], values:[...], extra } listos para un INSERT/UPDATE
function toRow(entity, body, { allowedKeys } = {}) {
  const m = MAPS[entity];
  const row = {}; const extra = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (allowedKeys && !allowedKeys.includes(k)) continue;
    if (k === '__proto__' || k === 'constructor') continue;
    if (m.cols[k]) {
      let val = v;
      if (m.ints.includes(k)) val = Number.isFinite(+v) ? Math.trunc(+v) : 0;
      else if (m.bigints.includes(k)) val = v == null ? null : Math.trunc(+v) || null;
      else if (m.json.includes(k)) val = JSON.stringify(Array.isArray(v) ? v.map((t) => cleanText(t, 60)).slice(0, 30) : []);
      else if (k === 'content' && entity === 'articles') val = cleanRich(v);
      else if (k === 'isSpamAlert') val = !!v;
      else if (typeof v === 'string') val = k === 'content' ? cleanText(v, 5000) : cleanText(v, k === 'url' || k === 'coverImage' ? 2048 : 600);
      else if (v !== null) val = String(v);
      row[m.cols[k]] = val;
    } else if (['string','number','boolean'].includes(typeof v)) {
      extra[k] = typeof v === 'string' ? cleanText(v, 600) : v;
    }
  }
  return { row, extra };
}

module.exports = { MAPS, fromRow, toRow, cleanText };
