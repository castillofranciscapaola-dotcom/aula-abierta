/**
 * AULA ABIERTA — Mi Blog Docente
 * db.js — Cliente de la API REST (Express + PostgreSQL).
 *
 * Mantiene la MISMA interfaz que la versión anterior basada en IndexedDB
 * (window.AulaAbiertaDB), por lo que las páginas no necesitan cambios de lógica.
 */
class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const ADMIN_PAGES = ['panel', 'gestion', 'editor', 'biblioteca', 'moderacion', 'perfil'];

class StorageService {
  constructor() {
    // Se conserva para compatibilidad con `await AulaAbiertaDB._initPromise`
    this._initPromise = Promise.resolve();
    this._guard();
  }

  async _req(method, url, body) {
    const res = await fetch('/api' + url, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      if (res.status === 401 && this._isAdminPage()) this._toLogin();
      throw new ApiError(res.status, (data && data.error) || 'Error de red');
    }
    return data;
  }

  _page() { return (location.pathname.split('/').pop() || 'index').replace('.html', ''); }
  _isAdminPage() { return ADMIN_PAGES.includes(this._page()); }
  _toLogin() { location.replace('admin-login.html'); }
  // Las páginas de administración exigen sesión; la seguridad real vive en el servidor.
  _guard() {
    if (!this._isAdminPage()) return;
    this.me().catch(() => {});
    document.addEventListener('DOMContentLoaded', () => {
      const b = document.createElement('button');
      b.textContent = 'Cerrar sesión';
      b.setAttribute('aria-label', 'Cerrar sesión');
      b.style.cssText = 'position:fixed;top:8px;right:8px;z-index:60;padding:6px 12px;border-radius:999px;border:0;background:#1e293b;color:#fff;font:600 12px sans-serif;opacity:.85;cursor:pointer';
      b.onclick = () => this.logout();
      document.body.appendChild(b);
    });
  }

  // ── Sesión ──
  login(email, password, remember) { return this._req('POST', '/auth/login', { email, password, remember: !!remember }); }
  async logout() { await this._req('POST', '/auth/logout', {}); location.href = 'admin-login.html'; }
  me() { return this._req('GET', '/auth/me'); }

  // ── CRUD genérico (misma firma que antes) ──
  async get(store, key) {
    if (store === 'settings') return key === 'teacherProfile' ? this.getTeacherProfile() : null;
    try { return await this._req('GET', `/${store}/${encodeURIComponent(key)}`); }
    catch (e) { if (e.status === 404) return null; throw e; }
  }
  async getAll(store) {
    if (store === 'settings') return [await this.getTeacherProfile()];
    return this._req('GET', `/${store}`);
  }
  put(store, item) {
    if (store === 'settings') return this.updateTeacherProfile(item);
    return this._req('PUT', `/${store}/${encodeURIComponent(item.id)}`, item);
  }
  async delete(store, key) {
    const q = store === 'articles' ? '?permanent=1' : '';
    return (await this._req('DELETE', `/${store}/${encodeURIComponent(key)}${q}`)).ok;
  }
  async count(store) { return (await this.getAll(store)).length; }

  // ── Artículos ──
  async getPublishedArticles() { return (await this.getAll('articles')).filter(a => a.status === 'published'); }
  getArticleById(id) { return this.get('articles', id); }
  saveArticle(data) {
    return data.id ? this.put('articles', data) : this._req('POST', '/articles', data);
  }
  async updateArticle(id, updates) {
    // Las vistas se cuentan en el servidor (público y atómico); el resto es edición de admin
    const keys = Object.keys(updates);
    if (keys.length === 1 && keys[0] === 'views') { await this._req('POST', `/articles/${encodeURIComponent(id)}/view`, {}); return null; }
    const art = await this.get('articles', id);
    return art ? this.put('articles', Object.assign(art, updates)) : null;
  }
  async deleteArticle(id) { return (await this._req('DELETE', `/articles/${encodeURIComponent(id)}`)).ok; }
  restoreArticle(id) { return this._req('POST', `/articles/${encodeURIComponent(id)}/restore`, {}).catch(() => null); }
  permanentDeleteArticle(id) { return this.delete('articles', id); }
  async getTrashedArticles() {
    return (await this.getAll('articles')).filter(a => a.status === 'trash').sort((a, b) => b.trashedAt - a.trashedAt);
  }

  // ── Comentarios ──
  getCommentsByArticle(articleId, onlyApproved = true) {
    return this._req('GET', `/articles/${encodeURIComponent(articleId)}/comments${onlyApproved ? '' : '?all=1'}`);
  }
  addComment(c) { return this._req('POST', `/articles/${encodeURIComponent(c.articleId)}/comments`, c); }
  updateCommentStatus(id, status, replyText = null) {
    const body = { status };
    if (replyText !== null) body.teacherReply = replyText;
    return this._req('PATCH', `/comments/${encodeURIComponent(id)}`, body);
  }
  deleteComment(id) { return this.delete('comments', id); }

  // ── Multimedia ──
  getAllMedia() { return this.getAll('media'); }
  saveMedia(m) { return m.id ? this.put('media', m) : this._req('POST', '/media', m); }
  deleteMedia(id) { return this.delete('media', id); }

  // ── Perfil docente (público para lectura; edición requiere sesión) ──
  async getTeacherProfile() {
    const p = await this._req('GET', '/profile').catch(() => null);
    return p || { key: 'teacherProfile', name: 'Docente', title: '', role: '', specialty: '', school: '',
      yearsExperience: 0, bio: '', photoUrl: '', updatedAt: Date.now() };
  }
  updateTeacherProfile(updates) { return this._req('PUT', '/profile', updates); }
}

// Instancia global exportable
window.AulaAbiertaDB = new StorageService();

// === XSS Sanitization Utilities ===

// Sanitize rich HTML content — strips scripts, iframes, event handlers, dangerous tags
// Use for article body content that legitimately contains formatting (h2, p, strong, etc.)
function sanitizeHTML(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  // Remove dangerous tags
  div.querySelectorAll('script, iframe, object, embed, form, input').forEach(el => el.remove());
  // Remove event handlers and javascript: URLs
  div.querySelectorAll('*').forEach(el => {
    Array.from(el.attributes).forEach(attr => {
      if (attr.name.startsWith('on') || attr.value.startsWith('javascript:')) {
        el.removeAttribute(attr.name);
      }
    });
  });
  return div.innerHTML;
}
window.sanitizeHTML = sanitizeHTML;

// Escape plain text for safe insertion into HTML templates
// Use for author names, titles, summaries, comments — any user string in a template literal
function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
window.escapeHTML = escapeHTML;

// === Non-blocking Toast Notification ===
window.showToast = function(message, type) {
  if (typeof type === 'string' && !['success','error','warning','info'].includes(type)) type = 'info';
  const toast = document.createElement('div');
  toast.className = 'toast-notification toast-' + (type || 'info');
  toast.textContent = message;
  toast.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:12px 24px;border-radius:8px;color:#fff;font-size:14px;z-index:9999;animation:fadeIn .3s ease;max-width:400px;box-shadow:0 4px 12px rgba(0,0,0,.15);';
  toast.style.backgroundColor = type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#3b82f6';
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity .3s'; setTimeout(() => toast.remove(), 300); }, 3000);
};
