/* ============================================================
 * 剪影 · 灵感收藏站 — 共用层
 * 类型表 / frontmatter / markdown 渲染 / 图片压缩 / 设备分流
 * 界面层（桌面 + 移动）只依赖这里导出的对象，便于未来扩展
 * ============================================================ */

'use strict';

/* ---------- 内容类型表（未来加类型只需在此加一行） ---------- */
const TYPES = {
  note:       { label: '杂思', icon: '✦', color: '#7dd3fc', desc: '随手记、日记、情绪' },
  quote:      { label: '名句', icon: '❝', color: '#fcd34d', desc: '读到的好句子、名言' },
  idea:       { label: '奇思', icon: '✧', color: '#c4b5fd', desc: '灵感、脑洞、计划' },
  collection: { label: '美图', icon: '◉', color: '#fb7185', desc: '剪影、截图、好看的图' },
};
const TYPE_ORDER = ['note', 'quote', 'idea', 'collection'];

function typeInfo(t) { return TYPES[t] || TYPES.note; }

/* ---------- frontmatter 解析 / 构建 ---------- */
function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.trimStart());
  if (!m) return { meta: { type: 'note', tags: [] }, body: text.trim() };
  const meta = { type: 'note', tags: [] };
  for (const line of m[1].split('\n')) {
    const kv = /^([a-zA-Z][a-zA-Z0-9]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    let v = kv[2].trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      v = v.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    } else if (v === 'true') v = true;
    else if (v === 'false') v = false;
    meta[key] = v;
  }
  return { meta, body: (m[2] || '').trim() };
}

function buildFrontmatter(meta, body) {
  const lines = ['---'];
  lines.push(`type: ${meta.type || 'note'}`);
  if (Array.isArray(meta.tags) && meta.tags.length) lines.push(`tags: [${meta.tags.join(', ')}]`);
  if (meta.source) lines.push(`source: ${meta.source}`);
  if (meta.mood) lines.push(`mood: ${meta.mood}`);
  // 未来扩展字段从这里加，向前兼容
  lines.push('---', '');
  return lines.join('\n') + (body || '').trim() + '\n';
}

/* ---------- 极简 markdown 渲染（不引外部库） ---------- */
function renderMarkdown(src) {
  if (!src) return '';
  let html = escapeHtml(src);
  // 代码块
  html = html.replace(/```([\s\S]*?)```/g, (_, c) => `<pre class="md-code">${c.trim()}</pre>`);
  // 图片（不转义相对路径中的引号在第一步已处理，这里恢复相对引用写法）
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, url) => {
    if (/^(https?:|data:)/.test(url)) return `<img src="${url}" alt="${alt}" class="md-img" loading="lazy">`;
    return `<span class="md-img-rel" data-src="${url}" data-alt="${alt}"></span>`;
  });
  // 行内代码
  html = html.replace(/`([^`]+)`/g, '<code class="md-code-inline">$1</code>');
  // 链接
  html = html.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // 标题
  html = html.replace(/^######\s*(.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s*(.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s*(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s*(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s*(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s*(.+)$/gm, '<h1>$1</h1>');
  // 粗体/斜体/删除线
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, '$1<em>$2</em>');
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  // 无序 / 有序列表（按连续行块打包成 ul/ol）
  html = html.replace(/(?:^\s*[-•]\s+(.+)$\n?)+/gm, block => {
    const items = block.trim().split('\n').map(l => `<li>${l.replace(/^\s*[-•]\s+/, '')}</li>`).join('');
    return `<ul>${items}</ul>`;
  });
  html = html.replace(/(?:^\s*\d+\.\s+(.+)$\n?)+/gm, block => {
    const items = block.trim().split('\n').map(l => `<li>${l.replace(/^\s*\d+\.\s+/, '')}</li>`).join('');
    return `<ol>${items}</ol>`;
  });
  // 引用
  html = html.replace(/^&gt;\s?(.+)$/gm, '<blockquote>$1</blockquote>');
  // 段落
  html = html.replace(/^([^<\n][^\n]*)$/gm, (m, line) => {
    if (/^\s*<(h\d|ul|ol|pre|blockquote|li)/.test(m)) return m;
    if (line.trim() === '') return '';
    return `<p>${line}</p>`;
  });
  html = html.replace(/<p>\s*<\/p>/g, '');
  html = html.replace(/\n{2,}/g, '\n');
  html = html.replace(/<p><\/p>/g, '');
  return html.trim();
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ============================================================
 * 自动排版（本地规则版，无 AI）
 * 贴一段文字 → 自动分段 / 金句识别 / 列表识别 / 主题标签建议
 * 返回 { formattedText, suggestedTags }
 * ============================================================ */

/* 内置主题词库（出现即作为标签建议，可自行扩充） */
const TOPIC_LEXICON = [
  '工作', '学习', '读书', '灵感', '创意', '生活', '美食', '旅行', '电影', '音乐',
  '运动', '健康', '家人', '朋友', '爱情', '梦想', '烦恼', '快乐', '悲伤', '成长',
  '哲学', '自然', '艺术', '科技', '编程', '代码', '城市', '孤独', '自由', '时间',
];

/* 把一段文字切成句子（按句末标点） */
function splitSentences(text) {
  const norm = text.replace(/\s*\n+\s*/g, '\n');
  return norm.split(/(?<=[。！？!?…])\s*/).map(s => s.trim()).filter(Boolean);
}

/* 句子是否像「金句」：短 且 带引号/感叹/问号 */
function isGoldenLine(s) {
  if (s.length > 40) return false;
  return /["“」』]/.test(s) || /[！？!?]$/.test(s) || s.includes('——');
}

/* 句子是否像列表项：编号开头 或 序数词开头 */
function isListItem(s) {
  return /^(\d+[\.、．)）]|[-•]|\d{1,2}\s)/.test(s) ||
         /^(第一|第二|第三|第四|第五|第六|第七|第八|第九|第十|首先|其次|然后|最后|其一|其二)[，,、]?/.test(s);
}

/* 从句子内部提取多个编号项（如"第一去爬山，第二看电影，第三吃饭"）→ ["第一去爬山","第二看电影","第三吃饭"]，无则 null */
function extractInlineList(line) {
  const marks = '(?:第一|第二|第三|第四|第五|第六|第七|第八|第九|第十|首先|其次|然后|最后|其一|其二|\\d{1,2}[\\.、．)）])';
  const re = new RegExp('[,，、\\s]*((' + marks + ')\\s*[^，,。！？!?]+)', 'g');
  const found = [];
  let m;
  while ((m = re.exec(line))) {
    found.push(m[1].replace(/^[,，、\s]+/, '').trim());
  }
  return found.length >= 2 ? found : null;
}

/* 主函数：文字 → 结构化 markdown + 标签建议 */
function autoFormat(rawText) {
  const input = (rawText || '').trim();
  if (!input) return { formattedText: '', suggestedTags: [] };

  const blocks = [];   // { type:'text'|'quote'|'list', text?/items? }
  let cur = [];        // 普通句子缓冲
  let curList = null;  // 当前列表项缓冲

  const flushText = () => { if (cur.length) { blocks.push({ type: 'text', text: cur.join('') }); cur = []; } };
  const flushList = () => { if (curList) { blocks.push({ type: 'list', items: curList }); curList = null; } };

  for (const sentence of splitSentences(input)) {
    /* 句内多个编号 → 拆成列表块 */
    const inline = extractInlineList(sentence);
    if (inline) {
      flushText(); flushList();
      blocks.push({ type: 'list', items: inline });
      continue;
    }
    if (isListItem(sentence)) {
      flushText();
      if (!curList) curList = [];
      curList.push(sentence.replace(/^[-•]\s*/, ''));
      continue;
    }
    if (isGoldenLine(sentence)) {
      flushText(); flushList();
      blocks.push({ type: 'quote', text: sentence });
      continue;
    }
    /* 普通句子：攒 2~3 句成一段 */
    flushList();
    cur.push(sentence);
    if (cur.length >= 3) { blocks.push({ type: 'text', text: cur.join('') }); cur = []; }
  }
  flushText(); flushList();
  if (!blocks.length) blocks.push({ type: 'text', text: input });

  /* 渲染成 markdown */
  const out = blocks.map(b => {
    if (b.type === 'list') return b.items.map(i => '- ' + i).join('\n');
    if (b.type === 'quote') return '> ' + b.text;
    return b.text;
  });
  const formattedText = out.join('\n\n');

  /* 主题标签：词库命中 + 高频词提权 */
  const freq = {};
  for (const w of TOPIC_LEXICON) {
    if (input.includes(w)) freq[w] = (freq[w] || 0) + 1;
  }
  /* 额外：统计非词库词频，超过 2 次也建议 */
  const allTokens = input.replace(/[，。！？；：、""''（）《》\s]/g, ' ').split(/\s+/).filter(Boolean);
  const wordCount = {};
  for (const tk of allTokens) {
    if (tk.length >= 2) wordCount[tk] = (wordCount[tk] || 0) + 1;
  }
  const frequent = Object.entries(wordCount).filter(([w, n]) => n >= 2 && !TOPIC_LEXICON.includes(w)).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([w]) => w);
  const suggestedTags = [...new Set([...Object.keys(freq).slice(0, 4), ...frequent.slice(0, 2)])].slice(0, 5);

  return { formattedText, suggestedTags };
}

/* ---------- 图片压缩（手机照片/大图 → 控制仓库体积） ---------- */
function compressImage(file, maxSize = 1600, quality = 0.8) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) return reject(new Error('不是图片文件'));
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          const scale = maxSize / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(b => {
          URL.revokeObjectURL(url);
          b ? resolve(b) : reject(new Error('图片压缩失败'));
        }, 'image/jpeg', quality);
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('图片无法读取'));
    img.src = url;
  });
}

function fileToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('文件读取失败'));
    r.readAsDataURL(blob);
  });
}

/* ---------- 本地时间格式化 ---------- */
function pad2(n) { return String(n).padStart(2, '0'); }

function localTimeParts() {
  const d = new Date();
  return {
    Y: d.getFullYear(),
    M: pad2(d.getMonth() + 1),
    D: pad2(d.getDate()),
    h: pad2(d.getHours()),
    m: pad2(d.getMinutes()),
    s: pad2(d.getSeconds()),
  };
}

/* 由时间戳文件名 2026-08-01-143502 → 显示时间 */
function fmtStamp(name) {
  const m = /(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(name);
  if (!m) return '';
  return `${m[1]}年${m[2]}月${m[3]}日 ${m[4]}:${m[5]}`;
}

function fmtMonth(name) {
  const m = /(\d{4})-(\d{2})/.exec(name);
  return m ? `${m[1]}年${m[2]}月` : '';
}

/* ---------- 设备分流 ---------- */
function isMobileDevice() {
  if (window.innerWidth < 768) return true;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function redirectToMobile() {
  if (isMobileDevice() && !/index-mobile\.html/.test(location.pathname)) {
    location.replace(location.href.replace(/index\.html?$/, 'index-mobile.html'));
  }
}

function redirectToDesktop() {
  if (!isMobileDevice() && /index-mobile\.html/.test(location.pathname)) {
    location.replace(location.href.replace(/index-mobile\.html$/, 'index.html'));
  }
}
