/* ============================================================
 * 剪影 · 灵感收藏站 — 数据层
 * 统一封装 GitHub API 读写私有仓库 diary-data
 * 界面层只调用这些方法，不直接碰 fetch —— 未来换存储后端只改这里
 * ============================================================ */

'use strict';

const DiaryAPI = {
  OWNER: 'yun-ai-base',
  REPO: 'diary-data',
  BRANCH: 'main',
  BASE: 'https://api.github.com',
  _imgCache: new Map(), // path -> objectURL

  /* ---- token 管理（localStorage，共用域名两版互通） ---- */
  getToken() { return localStorage.getItem('diary_token') || ''; },
  setToken(t) { localStorage.setItem('diary_token', (t || '').trim()); },
  clearToken() {
    localStorage.removeItem('diary_token');
    // 清掉 md 文本缓存（key 前缀 diary_md:）
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('diary_md:')) localStorage.removeItem(k);
    }
    this._imgCache.clear();
    idbClear();
  },

  _authHeaders(extra = {}) {
    const h = {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'diary-app',
      'X-GitHub-Api-Version': '2022-11-28',
      ...extra,
    };
    const t = this.getToken();
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
  },

  async _req(method, path, { body, raw } = {}) {
    const res = await fetch(this.BASE + path, { method, headers: this._authHeaders(), body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error('Token 无效或无权限'), { status: res.status });
    if (!res.ok) {
      let msg = res.statusText;
      try { const j = await res.json(); msg = j.message || msg; } catch {}
      throw Object.assign(new Error(msg), { status: res.status });
    }
    return raw ? res : res.json();
  },

  /* ---- 连接测试：能列出仓库树即通过 ---- */
  async test() {
    await this._req('GET', `/repos/${this.OWNER}/${this.REPO}/git/trees/${this.BRANCH}?recursive=1`);
    return true;
  },

  /* ---- 列出 data/ 下全部文件（含 sha） ---- */
  async listAll() {
    const data = await this._req('GET', `/repos/${this.OWNER}/${this.REPO}/git/trees/${this.BRANCH}?recursive=1`);
    return (data.tree || []).filter(f => f.type === 'blob' && f.path.startsWith('data/'));
  },

  /* ---- 读原始内容：md 文本 或 图片 blob ---- */
  // 注意：GitHub raw 接口对图片返回的 Content-Type 是 application/vnd.github.raw
  // 而不是 image/*，所以必须按文件扩展名判断图片类型
  async readRaw(path) {
    const enc = encodeURIComponent(path);
    const res = await fetch(`${this.BASE}/repos/${this.OWNER}/${this.REPO}/contents/${enc}`, {
      headers: this._authHeaders({ Accept: 'application/vnd.github.raw' }),
    });
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error('Token 无效或无权限'), { status: res.status });
    if (!res.ok) throw new Error('读取失败: ' + res.status);
    if (/\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i.test(path)) {
      const blob = await res.blob();
      return { kind: 'image', blob, path };
    }
    return { kind: 'text', text: await res.text(), path };
  },

  /* 带缓存读取 md 文本：sha 匹配则直接走 localStorage，省一次请求 */
  async readMdCached(path, sha) {
    const key = 'diary_md:' + path;
    try {
      const cached = JSON.parse(localStorage.getItem(key) || 'null');
      if (cached && cached.sha === sha) return cached.text;
    } catch { /* 缓存损坏则忽略 */ }
    const r = await this.readRaw(path);
    if (r.kind !== 'text') throw new Error('非文本文件: ' + path);
    try { localStorage.setItem(key, JSON.stringify({ sha, text: r.text })); }
    catch { /* 容量满时跳过缓存 */ }
    return r.text;
  },

  /* 图片 objectURL：内存 → IndexedDB → 网络，拉取后写入两级缓存 */
  async getImageURL(path) {
    if (this._imgCache.has(path)) return this._imgCache.get(path);
    const cached = await idbGet(path);
    if (cached) {
      const url = URL.createObjectURL(cached);
      this._imgCache.set(path, url);
      return url;
    }
    const r = await this.readRaw(path);
    if (r.kind !== 'image') throw new Error('非图片文件: ' + path);
    const url = URL.createObjectURL(r.blob);
    this._imgCache.set(path, url);
    idbSet(path, r.blob).catch(() => {});   // 落盘失败不阻塞
    return url;
  },

  /* ---- 写文件：新建（无 sha） / 更新（带 sha） ---- */
  async writeFile(path, contentBase64, sha, message) {
    const body = { message: message || `✎ ${path}`, content: contentBase64 };
    if (sha) body.sha = sha;
    const r = await this._req('PUT', `/repos/${this.OWNER}/${this.REPO}/contents/${encodeURIComponent(path)}`, { body });
    return r.content || {};
  },

  /* ---- 删除文件 ---- */
  async deleteFile(path, sha, message) {
    const body = { message: message || `🗑 ${path}`, sha };
    await this._req('DELETE', `/repos/${this.OWNER}/${this.REPO}/contents/${encodeURIComponent(path)}`, { body });
  },

  /* ---- 相对图片路径 → 仓库绝对路径（md 在 data/2026/x.md，图在 data/2026/images/） ---- */
  resolveImagePath(mdPath, rel) {
    const dir = mdPath.replace(/\/[^/]+$/, '');
    return (dir + '/' + rel).replace(/\/+/g, '/');
  },
};

/* ---------- IndexedDB 图片缓存（跨会话持久） ---------- */
const _IDB_NAME = 'diary-img-cache';
const _IDB_STORE = 'blobs';
let _idbPromise = null;

function _idbOpen() {
  if (_idbPromise) return _idbPromise;
  _idbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(_IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(_IDB_STORE)) req.result.createObjectStore(_IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { _idbPromise = null; reject(req.error); };
  });
  return _idbPromise;
}

function idbGet(key) {
  return _idbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(_IDB_STORE, 'readonly');
    const req = tx.objectStore(_IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  })).catch(() => null);
}

function idbSet(key, blob) {
  return _idbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(_IDB_STORE, 'readwrite');
    tx.objectStore(_IDB_STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

function idbClear() {
  if (!_idbPromise) return Promise.resolve();
  return _idbPromise.then(db => new Promise(resolve => {
    const tx = db.transaction(_IDB_STORE, 'readwrite');
    tx.objectStore(_IDB_STORE).clear();
    tx.oncomplete = () => resolve();
  })).catch(() => {});
}

/* ---------- 条目模型：把 md 文本 + 文件信息合成条目对象 ---------- */
function buildEntry(file, text) {
  const { meta, body } = parseFrontmatter(text);
  return {
    path: file.path,
    sha: file.sha,
    name: file.path.split('/').pop(),
    year: (file.path.match(/data\/(\d{4})\//) || [])[1] || '',
    meta,
    body,
    type: meta.type || 'note',
    tags: meta.tags || [],
    source: meta.source || '',
    time: fmtStamp(file.path),
  };
}
