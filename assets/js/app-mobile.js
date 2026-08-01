/* ============================================================
 * 剪影 · 灵感收藏站 — 移动版视图逻辑
 * 沉浸卡片流 / 底部导航 / 全屏编辑器 / 操作浮层
 * ============================================================ */

'use strict';

const state = {
  entries: [],
  mdPaths: new Set(),
  filterType: 'all',
  filterTag: '',
  search: '',
  editing: null,
  currentType: 'note',
  tags: new Set(),
  newImages: [],
  expandedIds: new Set(), // 已手动展开的文字卡片 id，render 后恢复
};

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

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
  if (DiaryAPI.getToken()) boot();
  else { $('#loginScreen').classList.remove('hidden'); $('#app').classList.add('hidden'); }
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
      setLoginMsg('Token 无效或无权限');
    } else toast('连接失败：' + err.message);
  } finally { setLoading(false); }
}

function setLoading(on) {
  const btn = $('#loginBtn');
  btn.disabled = on;
  btn.textContent = on ? '连接中…' : '进入 · 连接数据仓库';
}

/* ---------------- 数据 ---------------- */
async function loadData() {
  const files = await DiaryAPI.listAll();
  const mds = files.filter(f => f.path.endsWith('.md') && /\/\d{4}-\d{2}-\d{2}/.test(f.path));
  state.mdPaths = new Set(mds.map(f => f.path));
  const entries = [];
  await Promise.all(mds.map(async f => {
    try {
      const r = await DiaryAPI.readRaw(f.path);
      entries.push(buildEntry(f, r.text));
    } catch { /* 跳过坏文件 */ }
  }));
  entries.sort((a, b) => b.name.localeCompare(a.name));
  state.entries = entries;
  buildMonthSelect();
  render();
}

function buildMonthSelect() {
  const sel = $('#monthSelect');
  const months = [...new Set(state.entries.map(e => monthKeyOf(e.name)))].filter(Boolean).sort().reverse();
  sel.innerHTML = '<option value="">全部</option>' +
    months.map(m => `<option value="${m}">${m.replace('-', '/')}</option>`).join('');
}

function jumpToMonth(m) {
  if (!m) return;
  const card = $$('.entry-card').find(c => c.dataset.month === m);
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------------- 渲染 ---------------- */
function render() {
  const { filterType, filterTag, search } = state;
  const q = search.toLowerCase().trim();
  const list = state.entries.filter(e => {
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
    return;
  }
  empty.classList.add('hidden');

  const days = new Map();
  for (const e of list) {
    const dk = dayKeyOf(e.name);
    if (!days.has(dk)) days.set(dk, []);
    days.get(dk).push(e);
  }
  const dayKeys = [...days.keys()].sort().reverse();
  timeline.innerHTML = dayKeys.map(dk => {
    const cards = days.get(dk).map((e, i) => renderCard(e, i * 70));
    return `<div class="day-group visible" data-day="${dk}">
      <div class="day-label">${formatDayLabel(dk)}</div>
      ${cards.join('')}
    </div>`;
  }).join('');
  autoUncollapseShortNotes($('#timeline'));
  lazyLoadImages($('#timeline'));
}

function formatDayLabel(dk) {
  const [y, m, d] = dk.split('-').map(Number);
  const wd = ['日', '一', '二', '三', '四', '五', '六'][new Date(y, m - 1, d).getDay()];
  return `${y}年${m}月${d}日 · 周${wd}`;
}

/* 折叠卡片渲染后：内容未超出折叠高度（短笔记）则去掉折叠态和按钮 */
function autoUncollapseShortNotes(container) {
  container.querySelectorAll('.entry-body-collapsed').forEach(body => {
    if (body.scrollHeight <= body.clientHeight + 1) {
      body.classList.remove('entry-body-collapsed');
      const btn = body.nextElementSibling;
      if (btn && btn.classList.contains('entry-toggle')) btn.remove();
    }
  });
}

function renderCard(entry, delay) {
  const t = typeInfo(entry.type);
  const time = (entry.name.match(/-(\d{6})\.md/) || [])[1];
  const timeStr = time ? `${time.slice(0, 2)}:${time.slice(2, 4)}` : '';
  const tags = entry.tags.map(tg =>
    `<span class="tag${tg === state.filterTag ? ' active' : ''}" data-tag="${escapeHtml(tg)}">#${escapeHtml(tg)}</span>`
  ).join('');
  const source = entry.type === 'quote' && entry.source
    ? `<div class="entry-source">${escapeHtml(entry.source)}</div>` : '';
  // 纯文字笔记：默认折叠显示约 4 行，点击展开/收起，手动展开过的保持展开；带图笔记保持完整
  const hasImg = /!\[[^\]]*\]\([^)]+\)/.test(entry.body || '');
  const bodyHtml = renderMarkdown(entry.body || '', entry.path);
  const expanded = !hasImg && state.expandedIds.has(entry.name);
  const bodyHtmlFinal = hasImg
    ? `<div class="entry-body">${bodyHtml}</div>`
    : `<div class="entry-body${expanded ? '' : ' entry-body-collapsed'}">${bodyHtml}</div><button class="entry-toggle" data-toggle="${expanded ? 'collapse' : 'expand'}">${expanded ? '收起' : '展开'}</button>`;
  return `<article class="entry-card" data-id="${escapeHtml(entry.name)}" data-month="${monthKeyOf(entry.name)}" style="animation-delay:${Math.min(delay, 420)}ms">
    <div class="entry-head">
      <span class="entry-type" style="color:${t.color}"><i>${t.icon}</i>${t.label}</span>
      <span class="entry-time">${timeStr}</span>
      <button class="entry-menu-btn" title="操作">⋯</button>
    </div>
    ${bodyHtmlFinal}
    ${source}
    ${tags ? `<div class="entry-tags">${tags}</div>` : ''}
  </article>`;
}

/* ---------------- 编辑器 ---------------- */
function openEditor(entry) {
  state.editing = entry || null;
  state.newImages = [];
  state.tags = new Set(entry ? entry.tags : []);
  state.currentType = entry ? entry.type : 'note';
  $('#editorTitle').textContent = entry ? '编辑' : '新灵感';
  $('#saveBtn').textContent = entry ? '保存修改' : '保存';
  $('#editorBody').value = entry ? entry.body : '';
  $('#sourceInput').value = entry ? entry.source : '';
  $('#tagInput').value = '';
  renderTypePicker();
  renderTagChips();
  renderImgStrip();
  $('#sourceRow').classList.toggle('hidden', state.currentType !== 'quote');
  $('#editor').classList.remove('hidden');
  setTimeout(() => $('#editorBody').focus(), 300);
}

function closeEditor() {
  $('#editor').classList.add('hidden');
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

function renderImgStrip() {
  $('#imgStrip').innerHTML = state.newImages.map((img, i) =>
    `<div class="img-preview"><img src="${img.url}" alt="预览"><button class="img-preview-x" data-i="${i}">✕</button></div>`
  ).join('');
}

async function onFilesPicked(files) {
  for (const file of files) {
    try {
      const blob = await compressImage(file);
      state.newImages.push({ blob, url: URL.createObjectURL(blob) });
    } catch { toast('图片处理失败'); }
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
    for (let i = 0; i < state.newImages.length; i++) {
      const rel = `images/${stamp}-${i + 1}.jpg`;
      await DiaryAPI.writeFile(`${mdDir}/${rel}`, await fileToBase64(state.newImages[i].blob));
      finalBody += `\n\n![图](${rel})`;
    }
    await DiaryAPI.writeFile(`${mdDir}/${stamp}.md`, utf8ToBase64(buildFrontmatter({ type, tags, source }, finalBody)), sha);
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
  } catch {}
}

async function deleteEntry(entry) {
  if (!confirm(`删除这条「${typeInfo(entry.type).label}」吗？不可恢复。`)) return;
  try {
    await DiaryAPI.deleteFile(entry.path, entry.sha);
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

/* ---------------- 操作浮层（编辑/删除） ---------------- */
function showActions(entry) {
  const overlay = document.createElement('div');
  overlay.className = 'modal';
  overlay.innerHTML = `
    <div class="sheet actions-sheet">
      <button class="action-item" id="actEdit">✎ 编辑这条</button>
      <button class="action-item danger" id="actDelete">🗑 删除这条</button>
      <button class="action-item cancel" id="actCancel">取消</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#actEdit').addEventListener('click', () => { overlay.remove(); openEditor(entry); });
  overlay.querySelector('#actDelete').addEventListener('click', () => { overlay.remove(); deleteEntry(entry); });
  overlay.querySelector('#actCancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

/* ---------------- 图片灯箱（多图左右滑动） ---------------- */
let lightboxImages = [];
let lightboxIndex = 0;

function openLightbox(img) {
  const card = img.closest('.entry-card');
  // 收集当前卡片已加载的图片，定位当前点击的那张
  lightboxImages = [...card.querySelectorAll('.md-img')].map(i => i.src);
  lightboxIndex = Math.max(0, lightboxImages.indexOf(img.src));
  // 后台补加载同卡片里尚未进入视口的图（懒加载占位），并入灯箱列表
  card.querySelectorAll('.md-img-rel').forEach(ph => {
    loadLazyImage(ph, newImg => {
      if ($('#lightbox').classList.contains('hidden')) return;
      lightboxImages.push(newImg.src);
      updateLightbox();
    });
  });
  updateLightbox();
  $('#lightbox').classList.remove('hidden');
}

function updateLightbox() {
  const n = lightboxImages.length;
  const idx = Math.min(lightboxIndex, n - 1);
  $('#lightboxImg').src = n ? lightboxImages[idx] : '';
  $('#lightboxCount').textContent = n > 1 ? `${idx + 1} / ${n}` : '';
  $('#lightboxPrev').style.display = n > 1 ? '' : 'none';
  $('#lightboxNext').style.display = n > 1 ? '' : 'none';
}

function moveLightbox(dir) {
  const n = lightboxImages.length;
  if (n < 2) return;
  lightboxIndex = (lightboxIndex + dir + n) % n;   // 首尾循环
  updateLightbox();
}

/* ---------------- 设置 ---------------- */
function openSettings() {
  $('#settingsToken').value = DiaryAPI.getToken();
  $('#settingsMsg').textContent = '';
  $('#settings').classList.remove('hidden');
}
function closeSettings() { $('#settings').classList.add('hidden'); }
function saveSettings() {
  const t = $('#settingsToken').value.trim();
  if (!t) { $('#settingsMsg').textContent = 'Token 不能为空'; return; }
  DiaryAPI.setToken(t);
  $('#settingsMsg').textContent = '';
  closeSettings();
  boot();
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

/* ---------------- 事件 ---------------- */
function bindEvents() {
  $('#loginBtn').addEventListener('click', async () => {
    const t = $('#loginToken').value.trim();
    if (!t) { setLoginMsg('请粘贴 Token'); return; }
    DiaryAPI.setToken(t);
    await boot();
  });
  $('#loginGuideBtn').addEventListener('click', () => $('#loginGuide').classList.toggle('hidden'));
  $('#loginToken').addEventListener('keydown', e => { if (e.key === 'Enter') $('#loginBtn').click(); });

  $('#typeTabs').addEventListener('click', e => {
    const btn = e.target.closest('.type-tab');
    if (!btn) return;
    state.filterType = btn.dataset.type;
    state.filterTag = '';          // 切分类时清掉标签过滤，避免叠加残留
    $$('.type-tab', $('#typeTabs')).forEach(b => b.classList.toggle('active', b === btn));
    render();
  });

  let searchTimer = null;
  $('#searchInput').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.search = e.target.value; render(); }, 250);
  });

  $('#monthSelect').addEventListener('change', e => jumpToMonth(e.target.value));

  // 底部导航
  $('#tabHome').addEventListener('click', () => {
    state.filterType = 'all'; state.filterTag = ''; state.search = '';
    $('#searchInput').value = '';
    $$('.type-tab', $('#typeTabs')).forEach(b => b.classList.toggle('active', b.dataset.type === 'all'));
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('#fabBtn').addEventListener('click', () => openEditor(null));
  $('#tabSettings').addEventListener('click', openSettings);

  // 编辑器
  $('#editorClose').addEventListener('click', closeEditor);
  $('#saveBtn').addEventListener('click', saveEntry);
  $('#typePicker').addEventListener('click', e => {
    const opt = e.target.closest('.type-opt');
    if (opt) setType(opt.dataset.type);
  });
  $('#tagInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const tg = e.target.value.trim().replace(/^#/, '');
      if (tg && !state.tags.has(tg)) { state.tags.add(tg); renderTagChips(); }
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
  $('#cameraBtn').addEventListener('click', () => $('#cameraInput').click());
  $('#albumBtn').addEventListener('click', () => $('#albumInput').click());
  $('#cameraInput').addEventListener('change', e => { onFilesPicked(e.target.files); e.target.value = ''; });
  $('#albumInput').addEventListener('change', e => { onFilesPicked(e.target.files); e.target.value = ''; });
  $('#imgStrip').addEventListener('click', e => {
    const x = e.target.closest('.img-preview-x');
    if (x) {
      const i = Number(x.dataset.i);
      URL.revokeObjectURL(state.newImages[i].url);
      state.newImages.splice(i, 1);
      renderImgStrip();
    }
  });

  // 时间线：菜单 / 标签 / 图片
  $('#timeline').addEventListener('click', e => {
    const menuBtn = e.target.closest('.entry-menu-btn');
    if (menuBtn) {
      const entry = state.entries.find(x => x.name === menuBtn.closest('.entry-card').dataset.id);
      if (entry) showActions(entry);
      return;
    }
    // 纯文字卡片：点击任意位置展开/收起（排除菜单/标签/图片）
    const cardEl = e.target.closest('.entry-card');
    const bodyEl = cardEl ? cardEl.querySelector('.entry-body') : null;
    const isInteractEl = e.target.closest('.entry-menu-btn') || e.target.closest('.tag') || e.target.closest('.md-img');
    if (cardEl && bodyEl && !isInteractEl && cardEl.querySelector('.entry-toggle')) {
      const expanding = bodyEl.classList.contains('entry-body-collapsed');
      bodyEl.classList.toggle('entry-body-collapsed', !expanding);
      const tg = bodyEl.querySelector('.entry-toggle');
      if (tg) { tg.textContent = expanding ? '收起' : '展开'; tg.dataset.toggle = expanding ? 'collapse' : 'expand'; }
      const id = cardEl.dataset.id;
      if (expanding) state.expandedIds.add(id);
      else state.expandedIds.delete(id);
      return;
    }
    const tag = e.target.closest('.tag');
    if (tag) {
      state.filterTag = (state.filterTag === tag.dataset.tag) ? '' : tag.dataset.tag;
      render();
      return;
    }
    const img = e.target.closest('.md-img');
    if (img) { openLightbox(img); }
  });

  // 设置
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#settingsClose').addEventListener('click', closeSettings);
  $('#settingsSave').addEventListener('click', saveSettings);
  $('#settingsClear').addEventListener('click', clearSettings);
  $('#goDesktop').addEventListener('click', () => {
    location.href = location.href.replace(/index-mobile\.html$/, 'index.html');
  });

  // 灯箱（多图左右滑动）
  $('#lightboxClose').addEventListener('click', () => $('#lightbox').classList.add('hidden'));
  $('#lightboxPrev').addEventListener('click', e => { e.stopPropagation(); moveLightbox(-1); });
  $('#lightboxNext').addEventListener('click', e => { e.stopPropagation(); moveLightbox(1); });
  const lbEl = $('#lightbox');
  let lbTouchX = 0, lbTouchY = 0, lbSwiped = false;
  lbEl.addEventListener('touchstart', e => {
    lbTouchX = e.touches[0].clientX;
    lbTouchY = e.touches[0].clientY;
    lbSwiped = false;
  }, { passive: true });
  lbEl.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - lbTouchX;
    const dy = e.changedTouches[0].clientY - lbTouchY;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      lbSwiped = true;
      moveLightbox(dx < 0 ? 1 : -1);
    }
  }, { passive: true });
  lbEl.addEventListener('click', e => {
    if (e.target !== lbEl) return;
    if (lbSwiped) { lbSwiped = false; return; }   // 刚滑完这一下不算关闭
    lbEl.classList.add('hidden');
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { $('#lightbox').classList.add('hidden'); closeEditor(); closeSettings(); }
    if (e.key === 'ArrowLeft') moveLightbox(-1);
    else if (e.key === 'ArrowRight') moveLightbox(1);
  });
}

init();
