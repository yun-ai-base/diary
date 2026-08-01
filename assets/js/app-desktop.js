/* ============================================================
 * 剪影 · 灵感收藏站 — 桌面版视图逻辑
 * 时间线 / 筛选 / 编辑器 / 设置
 * ============================================================ */

'use strict';

const state = {
  entries: [],
  mdPaths: new Set(),
  filterType: 'all',
  filterTag: '',
  search: '',
  editing: null,          // 正在编辑的条目（null = 新建）
  currentType: 'note',
  tags: new Set(),
  newImages: [],          // [{ blob, url }]
  isLoading: false,
};

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

/* ---------------- 工具 ---------------- */
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function dayKeyOf(name) { return (name.match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || ''; }
function monthKeyOf(name) { return (name.match(/^(\d{4}-\d{2})/) || [])[1] || ''; }

let toastTimer = null;
function toast(msg, ok = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('ok', ok);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ---------------- 登录 / 启动 ---------------- */
function init() {
  if (DiaryAPI.getToken()) {
    boot();
  } else {
    $('#loginScreen').classList.remove('hidden');
    $('#app').classList.add('hidden');
  }
  bindEvents();
}

async function boot() {
  setLoading(true);
  try {
    await DiaryAPI.test();
    $('#loginScreen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    await loadData();
    toast('已连接数据仓库', true);
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      $('#loginScreen').classList.remove('hidden');
      $('#app').classList.add('hidden');
      setLoginMsg('Token 无效或无权限，请检查');
    } else {
      toast('连接失败：' + err.message);
    }
  } finally {
    setLoading(false);
  }
}

function setLoading(on) {
  const btn = $('#loginBtn');
  btn.disabled = on;
  btn.textContent = on ? '连接中…' : '进入 · 连接数据仓库';
}

/* ---------------- 数据加载 ---------------- */
async function loadData() {
  const files = await DiaryAPI.listAll();
  const mds = files.filter(f => f.path.endsWith('.md') && /\/\d{4}-\d{2}-\d{2}/.test(f.path));
  state.mdPaths = new Set(mds.map(f => f.path));

  const entries = [];
  await Promise.all(mds.map(async f => {
    try {
      const r = await DiaryAPI.readRaw(f.path);
      entries.push(buildEntry(f, r.text));
    } catch { /* 单条失败跳过 */ }
  }));
  entries.sort((a, b) => b.name.localeCompare(a.name)); // 时间倒序
  state.entries = entries;
  buildMonthSelect();
  render();
}

/* ---------------- 月份导航 ---------------- */
function buildMonthSelect() {
  const sel = $('#monthSelect');
  const months = [...new Set(state.entries.map(e => monthKeyOf(e.name)))]
    .filter(Boolean).sort().reverse();
  sel.innerHTML = '<option value="">全部月份</option>' +
    months.map(m => `<option value="${m}">${m.replace('-', '年')}月</option>`).join('');
}

function jumpToMonth(m) {
  if (!m) return;
  const card = [...$$('.entry-card')].find(c => c.dataset.month === m);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card.classList.add('flash');
    setTimeout(() => card.classList.remove('flash'), 1200);
  }
}

/* ---------------- 渲染 ---------------- */
let renderVersion = 0; // 递增标记：hydrateAllImages 只处理最新一次渲染的 DOM
function render() {
  const myVersion = ++renderVersion;
  const { filterType, filterTag, search } = state;
  const q = search.toLowerCase().trim();

  let list = state.entries.filter(e => {
    if (filterType !== 'all' && e.type !== filterType) return false;
    if (filterTag && !e.tags.includes(filterTag)) return false;
    if (q) {
      const hay = `${e.body} ${e.tags.join(' ')} ${e.source}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const timeline = $('#timeline');
  const empty = $('#emptyState');
  if (!list.length) {
    timeline.innerHTML = '';
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    timeline.innerHTML = list.map((e, i) => renderCard(e, i * 50)).join('');
  }
  updateStats();
  hydrateAllImages(myVersion);
}

function renderCard(entry, delay) {
  const t = typeInfo(entry.type);
  const tags = entry.tags.map(tg =>
    `<span class="tag${tg === state.filterTag ? ' active' : ''}" data-tag="${escapeHtml(tg)}">#${escapeHtml(tg)}</span>`
  ).join('');
  const source = entry.type === 'quote' && entry.source
    ? `<div class="entry-source">${escapeHtml(entry.source)}</div>` : '';
  const bodyHtml = renderMarkdown(entry.body || '');
  const time = (entry.name.match(/(\d{4})-(\d{2})-(\d{2})-(\d{6})\.md/) || []).slice(1, 5).join('');
  const timeStr = time ? `${time.slice(4, 6)}-${time.slice(6, 8)} ${time.slice(8, 10)}:${time.slice(10, 12)}` : '';

  return `<article class="entry-card" data-id="${escapeHtml(entry.name)}" data-month="${monthKeyOf(entry.name)}" style="animation-delay:${Math.min(delay, 500)}ms">
    <div class="entry-head">
      <span class="entry-type" style="color:${t.color}"><i>${t.icon}</i>${t.label}</span>
      <span class="entry-time">${timeStr}</span>
      <div class="entry-menu">
        <button class="entry-menu-btn" title="操作">⋯</button>
        <div class="entry-menu-pop hidden">
          <button class="entry-menu-item" data-act="edit">✎ 编辑</button>
          <button class="entry-menu-item danger" data-act="delete">🗑 删除</button>
        </div>
      </div>
    </div>
    <div class="entry-body">${bodyHtml}</div>
    ${source}
    ${tags ? `<div class="entry-tags">${tags}</div>` : ''}
  </article>`;
}

async function hydrateAllImages(version) {
  try {
    const cards = $$('.entry-card');
    await Promise.all(cards.map(async card => {
      const entry = state.entries.find(e => e.name === card.dataset.id);
      if (!entry) return;
      const phs = $$('.md-img-rel', card);
      await Promise.all(phs.map(async ph => {
        const rel = ph.dataset.src;
        try {
          const abs = DiaryAPI.resolveImagePath(entry.path, rel);
          const url = await DiaryAPI.getImageURL(abs);
          // 渲染版本已变化（用户又点了分类），不再替换旧 DOM
          if (version !== renderVersion) return;
          const img = document.createElement('img');
          img.className = 'md-img';
          img.src = url;
          img.alt = ph.dataset.alt || '图';
          img.loading = 'lazy';
          ph.replaceWith(img);
        } catch { if (version === renderVersion) ph.remove(); }
      }));
    }));
  } catch { /* 图片加载失败不影响列表 */ }
}

function updateStats() {
  $('#statCount').textContent = state.entries.length;
  $('#statTag').textContent = new Set(state.entries.flatMap(e => e.tags)).size;
  const imgCount = state.entries.reduce((n, e) =>
    n + ((e.body.match(/!\[[^\]]*\]\([^)]+\)/g) || []).length), 0);
  $('#statImg').textContent = imgCount;
  $('#stats').classList.remove('hidden');
}

/* ---------------- 编辑器 ---------------- */
function openEditor(entry) {
  state.editing = entry || null;
  state.newImages = [];
  state.tags = new Set(entry ? entry.tags : []);
  state.currentType = entry ? entry.type : 'note';

  $('#editorTitle').textContent = entry ? '编辑灵感' : '新灵感';
  $('#saveBtn').textContent = entry ? '保存修改' : '保存';
  $('#editorBody').value = entry ? entry.body : '';
  $('#sourceInput').value = entry ? entry.source : '';
  $('#tagInput').value = '';

  renderTypePicker();
  renderTagChips();
  renderImgStrip();
  $('#sourceRow').classList.toggle('hidden', state.currentType !== 'quote');
  $('#editor').classList.remove('hidden');
  setTimeout(() => $('#editorBody').focus(), 60);
}

function closeEditor() {
  $('#editor').classList.add('hidden');
  $('#fileInput').value = '';
  state.newImages.forEach(n => URL.revokeObjectURL(n.url));
  state.newImages = [];
  state.editing = null;
}

function renderTypePicker() {
  $('#typePicker').innerHTML = TYPE_ORDER.map(t => {
    const info = TYPES[t];
    const on = state.currentType === t;
    return `<button class="type-opt${on ? ' active' : ''}" data-type="${t}" style="${on ? 'color:' + info.color : ''}">
      <i>${info.icon}</i><span>${info.label}</span>
    </button>`;
  }).join('');
}

function setType(t) {
  state.currentType = t;
  renderTypePicker();
  $('#sourceRow').classList.toggle('hidden', t !== 'quote');
}

function renderTagChips() {
  $('#tagChips').innerHTML = [...state.tags].map(tg =>
    `<span class="chip">${escapeHtml(tg)}<button class="chip-x" data-tag="${escapeHtml(tg)}">×</button></span>`
  ).join('');
}

function addTag(tg) {
  tg = tg.trim().replace(/^#/, '');
  if (!tg || state.tags.has(tg)) return;
  state.tags.add(tg);
  renderTagChips();
}

function renderImgStrip() {
  $('#imgStrip').innerHTML = state.newImages.map((img, i) =>
    `<div class="img-preview">
      <img src="${img.url}" alt="预览">
      <button class="img-preview-x" data-i="${i}">✕</button>
    </div>`
  ).join('');
}

async function onFilesPicked(files) {
  for (const file of files) {
    try {
      const blob = await compressImage(file);
      const url = URL.createObjectURL(blob);
      state.newImages.push({ blob, url });
    } catch { toast('图片处理失败：' + file.name); }
  }
  renderImgStrip();
}

async function saveEntry() {
  const body = $('#editorBody').value.trim();
  if (!body && state.newImages.length === 0) { toast('写点内容或加张图吧'); return; }

  const btn = $('#saveBtn');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = '保存中…';

  try {
    const type = state.currentType;
    const tags = [...state.tags];
    const source = $('#sourceInput').value.trim();

    let stamp, year, sha;
    if (state.editing) {
      const m = state.editing.name.match(/^(\d{4}-\d{2}-\d{2}-\d{6})(?:-(\d+))?\.md$/);
      stamp = m[1] + (m[2] ? '-' + m[2] : '');
      year = state.editing.name.slice(0, 4);
      sha = state.editing.sha;
    } else {
      stamp = await uniqueStamp();
      year = stamp.slice(0, 4);
    }

    const mdDir = `data/${year}`;
    let finalBody = body;

    // 上传新图片
    for (let i = 0; i < state.newImages.length; i++) {
      const rel = `images/${stamp}-${i + 1}.jpg`;
      const b64 = await fileToBase64(state.newImages[i].blob);
      await DiaryAPI.writeFile(`${mdDir}/${rel}`, b64);
      finalBody += `\n\n![图](${rel})`;
    }

    const mdText = buildFrontmatter({ type, tags, source }, finalBody);
    await DiaryAPI.writeFile(`${mdDir}/${stamp}.md`, utf8ToBase64(mdText), sha);

    if (state.editing) await cleanupOrphanImages(stamp, year, finalBody);

    closeEditor();
    toast('已保存 ✓', true);
    await loadData();
  } catch (err) {
    toast('保存失败：' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

/* 生成不与现有文件冲突的时间戳文件名 */
async function uniqueStamp() {
  const t = localTimeParts();
  const base = `${t.Y}-${t.M}-${t.D}-${t.h}${t.m}${t.s}`;
  const year = String(t.Y);
  let stamp = base;
  for (let i = 0; i < 60; i++) {
    if (!state.mdPaths.has(`data/${year}/${stamp}.md`)) return stamp;
    stamp = `${base.slice(0, 14)}${String(Number(base.slice(14)) + 1).padStart(2, '0')}`;
  }
  return stamp;
}

/* 编辑保存后，清理该条目下不再被引用的图片 */
async function cleanupOrphanImages(stamp, year, body) {
  try {
    const kept = new Set();
    const mdDir = `data/${year}`;
    for (const m of body.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
      kept.add((mdDir + '/' + m[1]).replace(/\/+/g, '/'));
    }
    const files = await DiaryAPI.listAll();
    const prefix = `data/${year}/images/${stamp}-`;
    await Promise.all(files
      .filter(f => f.path.startsWith(prefix) && !kept.has(f.path))
      .map(f => DiaryAPI.deleteFile(f.path, f.sha).catch(() => {})));
  } catch { /* 清理失败不阻塞主流程 */ }
}

async function deleteEntry(entry) {
  const t = typeInfo(entry.type);
  if (!confirm(`删除这条「${t.label}」吗？不可恢复。`)) return;
  try {
    await DiaryAPI.deleteFile(entry.path, entry.sha);
    // 删除关联图片
    const files = await DiaryAPI.listAll();
    const dir = entry.path.replace(/\/[^/]+$/, '');
    const base = entry.name.replace(/\.md$/, '');
    await Promise.all(files
      .filter(f => f.path.startsWith(dir + '/images/') && f.path.includes(base + '-'))
      .map(f => DiaryAPI.deleteFile(f.path, f.sha).catch(() => {})));
    toast('已删除', true);
    await loadData();
  } catch (err) { toast('删除失败：' + err.message); }
}

/* ---------------- 设置 ---------------- */
function openSettings() {
  $('#settingsToken').value = DiaryAPI.getToken();
  $('#settingsMsg').textContent = '';
  $('#settings').classList.remove('hidden');
}

function closeSettings() {
  $('#settings').classList.add('hidden');
}

function saveSettings() {
  const t = $('#settingsToken').value.trim();
  if (t) {
    DiaryAPI.setToken(t);
    setLoginMsg('');
    closeSettings();
    boot();
  } else {
    $('#settingsMsg').textContent = 'Token 不能为空';
  }
}

function clearSettings() {
  DiaryAPI.clearToken();
  closeSettings();
  $('#loginScreen').classList.remove('hidden');
  $('#app').classList.add('hidden');
}

function setLoginMsg(m, ok = false) {
  const el = $('#loginMsg');
  el.textContent = m;
  el.classList.toggle('ok', ok);
}

/* ---------------- 事件绑定 ---------------- */
function bindEvents() {
  // 登录
  $('#loginBtn').addEventListener('click', async () => {
    const t = $('#loginToken').value.trim();
    if (!t) { setLoginMsg('请粘贴 Token'); return; }
    DiaryAPI.setToken(t);
    await boot();
  });
  $('#loginGuideBtn').addEventListener('click', () => {
    $('#loginGuide').classList.toggle('hidden');
  });
  $('#loginToken').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('#loginBtn').click();
  });

  // 类型 tabs
  $('#typeTabs').addEventListener('click', e => {
    const btn = e.target.closest('.type-tab');
    if (!btn) return;
    state.filterType = btn.dataset.type;
    state.filterTag = '';          // 切分类时清掉标签过滤，避免叠加残留
    $$('.type-tab', $('#typeTabs')).forEach(b => b.classList.toggle('active', b === btn));
    render();
  });

  // 搜索
  let searchTimer = null;
  $('#searchInput').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.search = e.target.value; render(); }, 200);
  });

  // 月份跳转
  $('#monthSelect').addEventListener('change', e => jumpToMonth(e.target.value));

  // 悬浮写 + 关闭
  $('#fabBtn').addEventListener('click', () => openEditor(null));
  $('#editorClose').addEventListener('click', closeEditor);
  $('#saveBtn').addEventListener('click', saveEntry);

  // 类型选择
  $('#typePicker').addEventListener('click', e => {
    const opt = e.target.closest('.type-opt');
    if (opt) setType(opt.dataset.type);
  });

  // 标签输入
  $('#tagInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(e.target.value);
      e.target.value = '';
    }
  });
  $('#tagChips').addEventListener('click', e => {
    const x = e.target.closest('.chip-x');
    if (x) { state.tags.delete(x.dataset.tag); renderTagChips(); }
  });

  // 自动排版
  $('#autoBtn').addEventListener('click', () => {
    const text = $('#editorBody').value.trim();
    if (!text) { toast('先写点内容，再自动排版'); return; }
    const { formattedText, suggestedTags } = autoFormat(text);
    $('#editorBody').value = formattedText;
    suggestedTags.forEach(tg => state.tags.add(tg));
    renderTagChips();
    toast('已自动排版 ✨', true);
  });

  // 图片选择
  $('#imgBtn').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', e => {
    onFilesPicked(e.target.files);
    e.target.value = '';
  });
  $('#imgStrip').addEventListener('click', e => {
    const x = e.target.closest('.img-preview-x');
    if (x) {
      const i = Number(x.dataset.i);
      URL.revokeObjectURL(state.newImages[i].url);
      state.newImages.splice(i, 1);
      renderImgStrip();
    }
  });

  // 时间线事件委托：菜单 / 标签 / 图片
  $('#timeline').addEventListener('click', e => {
    const menuBtn = e.target.closest('.entry-menu-btn');
    if (menuBtn) {
      const pop = menuBtn.nextElementSibling;
      const wasOpen = !pop.classList.contains('hidden');
      closeAllMenus();
      if (!wasOpen) pop.classList.remove('hidden');
      return;
    }
    const menuItem = e.target.closest('.entry-menu-item');
    if (menuItem) {
      const card = menuItem.closest('.entry-card');
      const entry = state.entries.find(x => x.name === card.dataset.id);
      if (!entry) return;
      closeAllMenus();
      if (menuItem.dataset.act === 'edit') openEditor(entry);
      else if (menuItem.dataset.act === 'delete') deleteEntry(entry);
      return;
    }
    const tag = e.target.closest('.tag');
    if (tag) {
      const tg = tag.dataset.tag;
      state.filterTag = (state.filterTag === tg) ? '' : tg;
      $$('.type-tab', $('#typeTabs')).forEach(b => b.classList.toggle('active', b.dataset.type === 'all' && !state.filterTag));
      render();
      return;
    }
    const img = e.target.closest('.md-img');
    if (img) {
      $('#lightboxImg').src = img.src;
      $('#lightbox').classList.remove('hidden');
      return;
    }
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.entry-menu')) closeAllMenus();
  });

  // 鼠标光晕跟随
  $('#timeline').addEventListener('mousemove', e => {
    const card = e.target.closest('.entry-card');
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    card.style.setProperty('--my', (e.clientY - r.top) + 'px');
  });

  // 灯箱
  $('#lightboxClose').addEventListener('click', () => $('#lightbox').classList.add('hidden'));
  $('#lightbox').addEventListener('click', e => {
    if (e.target === $('#lightbox')) $('#lightbox').classList.add('hidden');
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      $('#lightbox').classList.add('hidden');
      closeEditor();
      closeSettings();
    }
  });

  // 设置
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#settingsClose').addEventListener('click', closeSettings);
  $('#settingsSave').addEventListener('click', saveSettings);
  $('#settingsClear').addEventListener('click', clearSettings);
  $('#goMobile').addEventListener('click', () => {
    location.href = location.href.replace(/index\.html?$/, 'index-mobile.html');
  });
}

function closeAllMenus() {
  $$('.entry-menu-pop').forEach(p => p.classList.add('hidden'));
}

init();
