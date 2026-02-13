// ===== 链接收藏家 v4 - popup.js =====
// 纯本地版：IndexedDB + 内置提取 + AI 提取（直接调用 API）

const DB_NAME = 'LinkCollectorDB';
const DB_VERSION = 1;
const STORE_NAME = 'bookmarks';

// ===== 全局状态 =====
let state = {
  allTags: [],
  currentTags: [],
  currentAiTags: [],
  sugHighlight: -1,
  aiConfig: { apiUrl: '', apiKey: '', model: '', prompt: '', enableImages: false },
  totalTokens: 0,
  currentTab: null,
  pageHTML: null,
};

// ===== DOM =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', async () => {
  // 恢复 AI 配置
  try {
    const data = await chrome.storage.local.get(['aiConfig', 'totalTokens']);
    if (data.aiConfig) state.aiConfig = { ...state.aiConfig, ...data.aiConfig };
    if (data.totalTokens) state.totalTokens = data.totalTokens;
  } catch {}

  loadBookmarks();
  loadAllTags();
  updateAIButton();

  // 自动获取当前标签页信息
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      state.currentTab = tab;
      $('#add-url').value = tab.url || '';
      console.log('[LLC] current tab:', tab.url, 'id:', tab.id);
    } else {
      console.warn('[LLC] no active tab found');
    }
  } catch (e) {
    console.error('[LLC] tabs.query init failed:', e);
  }

  bindEvents();
});

// ==================== IndexedDB ====================

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('url', 'url', { unique: false });
        store.createIndex('tags', 'tags', { unique: false, multiEntry: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function localGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function localAdd(bookmark) {
  const db = await openDB();
  const all = await localGetAll();
  const existing = all.find(b => b.url === bookmark.url);
  if (existing) {
    // 相同 URL 合并标签
    const mergedTags = [...new Set([...parseTags(existing.tags), ...parseTags(bookmark.tags)])].join(',');
    const mergedAiTags = [...new Set([...parseTags(existing.aiTags), ...parseTags(bookmark.aiTags)])].join(',');
    existing.tags = mergedTags;
    existing.aiTags = mergedAiTags;
    existing.name = bookmark.name || existing.name;
    existing.title = bookmark.title || existing.title;
    existing.summary = bookmark.summary || existing.summary;
    existing.updated_at = new Date().toISOString();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(existing);
      tx.oncomplete = () => resolve(existing);
      tx.onerror = () => reject(tx.error);
    });
  }
  bookmark.created_at = bookmark.created_at || new Date().toISOString();
  bookmark.updated_at = bookmark.updated_at || new Date().toISOString();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).add(bookmark);
    req.onsuccess = () => { bookmark.id = req.result; resolve(bookmark); };
    tx.onerror = () => reject(tx.error);
  });
}

async function localUpdate(id, data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const item = getReq.result;
      if (!item) return reject(new Error('not found'));
      Object.assign(item, data, { updated_at: new Date().toISOString() });
      store.put(item);
      tx.oncomplete = () => resolve(item);
    };
    tx.onerror = () => reject(tx.error);
  });
}

async function localDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function localSearch(keyword) {
  const all = await localGetAll();
  if (!keyword) return all;
  const kw = keyword.toLowerCase();
  return all.filter(b =>
    (b.name || '').toLowerCase().includes(kw) ||
    (b.title || '').toLowerCase().includes(kw) ||
    (b.url || '').toLowerCase().includes(kw) ||
    (b.tags || '').toLowerCase().includes(kw) ||
    (b.aiTags || '').toLowerCase().includes(kw) ||
    (b.summary || '').toLowerCase().includes(kw)
  );
}

// ==================== 事件绑定 ====================

function bindEvents() {
  // 搜索
  let searchTimer = null;
  $('#search-input').oninput = () => {
    clearTimeout(searchTimer);
    const v = $('#search-input').value;
    $('#btn-clear-search').style.display = v ? 'flex' : 'none';
    searchTimer = setTimeout(() => loadBookmarks(v), 300);
  };
  $('#btn-clear-search').onclick = () => {
    $('#search-input').value = '';
    $('#btn-clear-search').style.display = 'none';
    loadBookmarks();
  };

  // 视图切换
  $$('.seg-btn').forEach(btn => {
    btn.onclick = () => {
      $$('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.dataset.view;
      $('#list-view').style.display = view === 'list' ? 'block' : 'none';
      $('#tags-view').style.display = view === 'tags' ? 'block' : 'none';
      if (view === 'tags') loadTagGroups();
    };
  });

  // 添加面板
  $('#btn-toggle-add').onclick = async () => {
    const panel = $('#add-panel');
    const wasCollapsed = panel.classList.contains('collapsed');
    panel.classList.toggle('collapsed');
    panel.classList.toggle('expanded');
    // 展开时自动提取当前页面基本信息（标题、标签）
    if (wasCollapsed) {
      await autoExtractBasicInfo();
    }
  };

  // 提取
  $('#btn-fetch').onclick = doFetch;
  $('#btn-fetch-ai').onclick = doFetchAI;

  // 保存
  $('#btn-save').onclick = doSave;

  // 标签输入
  setupTagInput();
  setupAiTagInput();

  // 设置
  $('#btn-settings').onclick = showSettingsPanel;
  $('#btn-settings-back').onclick = hideSettingsPanel;
  $('#btn-save-ai').onclick = saveAIConfig;

  // 导入导出
  $('#btn-export').onclick = doExport;
  $('#btn-import').onclick = () => $('#import-file').click();
  $('#import-file').onchange = doImport;
}

// ==================== 标签输入组件 ====================

function setupTagInput() {
  const wrap = $('#tag-input-wrap');
  const input = $('#add-tags-input');
  const sugBox = $('#tag-suggestions');

  wrap.onclick = () => input.focus();

  input.onfocus = () => {
    wrap.classList.add('focused');
    showSuggestions(input.value);
  };
  input.onblur = () => {
    wrap.classList.remove('focused');
    setTimeout(() => sugBox.classList.remove('show'), 200);
  };
  input.oninput = () => showSuggestions(input.value);

  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const highlighted = sugBox.querySelector('.highlighted');
      if (highlighted) {
        addTag(highlighted.textContent);
      } else if (input.value.trim()) {
        addTag(input.value.trim());
      }
      input.value = '';
      sugBox.classList.remove('show');
      state.sugHighlight = -1;
    } else if (e.key === 'Backspace' && !input.value && state.currentTags.length > 0) {
      removeTag(state.currentTags[state.currentTags.length - 1]);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      navigateSuggestions(e.key === 'ArrowDown' ? 1 : -1);
    }
  };
}

function addTag(tag) {
  tag = tag.trim().replace(/,/g, '');
  if (!tag || state.currentTags.includes(tag)) return;
  state.currentTags.push(tag);
  renderTagPills();
}

function removeTag(tag) {
  state.currentTags = state.currentTags.filter(t => t !== tag);
  renderTagPills();
}

function renderTagPills() {
  const container = $('#tag-input-tags');
  container.innerHTML = '';
  state.currentTags.forEach(tag => {
    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    pill.innerHTML = `${escHtml(tag)}<button class="tag-pill-remove" data-tag="${escHtml(tag)}">&times;</button>`;
    pill.querySelector('.tag-pill-remove').onclick = (e) => {
      e.stopPropagation();
      removeTag(tag);
    };
    container.appendChild(pill);
  });
}

function renderAiTagPills() {
  const display = $('#ai-tags-display');
  const container = $('#ai-tags-pills');
  // 有标签或面板展开时始终显示（方便手动添加）
  const panelOpen = !$('#add-panel').classList.contains('collapsed');
  if (!state.currentAiTags.length && !panelOpen) {
    display.style.display = 'none';
    return;
  }
  display.style.display = 'block';
  container.innerHTML = '';
  state.currentAiTags.forEach(tag => {
    const pill = document.createElement('span');
    pill.className = 'ai-tag-pill';
    pill.innerHTML = `${escHtml(tag)}<button class="ai-tag-pill-remove" data-tag="${escHtml(tag)}">&times;</button>`;
    pill.querySelector('.ai-tag-pill-remove').onclick = (e) => {
      e.stopPropagation();
      state.currentAiTags = state.currentAiTags.filter(t => t !== tag);
      renderAiTagPills();
    };
    container.appendChild(pill);
  });
}

function setupAiTagInput() {
  const input = $('#ai-tags-input');
  if (!input) return;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = input.value.trim().replace(/,/g, '');
      if (val && !state.currentAiTags.includes(val)) {
        state.currentAiTags.push(val);
        renderAiTagPills();
      }
      input.value = '';
    } else if (e.key === 'Backspace' && !input.value && state.currentAiTags.length > 0) {
      state.currentAiTags.pop();
      renderAiTagPills();
    }
  };
  // 点击整个区域聚焦输入框
  $('#ai-tags-display').onclick = (e) => {
    if (e.target === input || e.target.closest('.ai-tag-pill-remove')) return;
    input.focus();
  };
}

function showSuggestions(query) {
  const sugBox = $('#tag-suggestions');
  const q = (query || '').trim().toLowerCase();
  const candidates = state.allTags.filter(t =>
    !state.currentTags.includes(t) && (q === '' || t.toLowerCase().includes(q))
  );
  if (candidates.length === 0 || (q === '' && candidates.length > 20)) {
    sugBox.classList.remove('show');
    return;
  }
  sugBox.innerHTML = '';
  candidates.slice(0, 10).forEach(tag => {
    const div = document.createElement('div');
    div.className = 'tag-sug-item';
    div.textContent = tag;
    div.onmousedown = (e) => {
      e.preventDefault();
      addTag(tag);
      $('#add-tags-input').value = '';
      sugBox.classList.remove('show');
    };
    sugBox.appendChild(div);
  });
  state.sugHighlight = -1;
  sugBox.classList.add('show');
}

function navigateSuggestions(direction) {
  const items = $$('#tag-suggestions .tag-sug-item');
  if (!items.length) return;
  items.forEach(i => i.classList.remove('highlighted'));
  state.sugHighlight += direction;
  if (state.sugHighlight < 0) state.sugHighlight = items.length - 1;
  if (state.sugHighlight >= items.length) state.sugHighlight = 0;
  items[state.sugHighlight].classList.add('highlighted');
}

async function loadAllTags() {
  try {
    const all = await localGetAll();
    const tagSet = new Set();
    all.forEach(b => {
      parseTags(b.tags).forEach(t => tagSet.add(t));
      parseTags(b.aiTags).forEach(t => tagSet.add(t));
    });
    state.allTags = [...tagSet].sort();
  } catch {}
}

// ==================== 获取当前页面 HTML ====================

async function getCurrentPageHTML() {
  // 有缓存直接返回
  if (state.pageHTML) return state.pageHTML;

  if (!state.currentTab) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) state.currentTab = tab;
    } catch (e) {
      console.warn('[LLC] tabs.query failed:', e);
    }
  }

  if (!state.currentTab) return null;

  // 方法 1：chrome.scripting 注入获取完整 DOM（包含动态内容）
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: state.currentTab.id },
      func: () => document.documentElement.outerHTML,
    });
    if (results && results[0] && results[0].result) {
      state.pageHTML = results[0].result;
      return state.pageHTML;
    }
  } catch (e) {
    console.warn('[LLC] scripting.executeScript failed:', e.message);
  }

  // 方法 2：fetch 降级（不包含动态内容，但能获取基础 HTML）
  const tabUrl = state.currentTab.url || '';
  if (tabUrl.startsWith('http')) {
    try {
      const resp = await fetch(tabUrl, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      });
      if (resp.ok) {
        state.pageHTML = await resp.text();
        return state.pageHTML;
      }
    } catch (e) {
      console.warn('[LLC] fetch fallback failed:', e.message);
    }
  }

  return null;
}

// ==================== 提取页面图片 ====================

async function getPageImages() {
  if (!state.currentTab) return [];
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: state.currentTab.id },
      func: () => {
        const imgs = Array.from(document.querySelectorAll('img'));
        return imgs
          .filter(img => {
            const rect = img.getBoundingClientRect();
            return img.src &&
                   img.src.startsWith('http') &&
                   rect.width >= 100 && rect.height >= 100 &&
                   img.naturalWidth >= 100 && img.naturalHeight >= 100;
          })
          .sort((a, b) => (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight))
          .slice(0, 3)
          .map(img => img.src);
      },
    });
    if (results && results[0] && results[0].result) {
      return results[0].result;
    }
  } catch (e) {
    console.warn('[LLC] getPageImages failed:', e.message);
  }
  return [];
}

// ==================== 自动提取基本信息 ====================

async function autoExtractBasicInfo() {
  const html = await getCurrentPageHTML();

  if (html) {
    const result = extractFromHTML(html);
    if (result.title && !$('#add-title').value) {
      $('#add-title').value = result.title;
    }
    if (result.suggestedTags) {
      const tags = result.suggestedTags.split(',').map(t => t.trim()).filter(Boolean);
      tags.forEach(t => { if (!state.currentTags.includes(t)) state.currentTags.push(t); });
      if (tags.length > 0) renderTagPills();
    }
  } else {
    // 保底：从 tab 对象获取标题
    if (state.currentTab && state.currentTab.title && !$('#add-title').value) {
      let title = state.currentTab.title;
      for (const sep of [' - ', ' | ', ' \u2013 ', ' \u2014 ', ' :: ', ' \u00b7 ']) {
        if (title.includes(sep)) {
          const parts = title.split(sep);
          title = parts.reduce((a, b) => a.length >= b.length ? a : b).trim();
          break;
        }
      }
      $('#add-title').value = title;
    }
  }
}

// ==================== 内置网页提取 ====================

// 噪声选择器——移除这些元素
const NOISE_SELECTORS = [
  'script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript',
  'iframe', 'svg', 'form', 'button', 'select', 'input', 'textarea',
  'label', 'fieldset', 'figure', 'figcaption', 'picture', 'source',
  'video', 'audio', 'canvas', '[role="navigation"]', '[role="banner"]',
  '[role="complementary"]', '.sidebar', '.widget', '.comment', '.comments',
  '.advertisement', '.ad', '.ads', '.social', '.share', '.related',
  '.recommend', '.copyright', '.pagination', '.pager', '.menu',
  '.breadcrumb',
].join(',');

// 正文关键词
const CONTENT_KEYWORDS = /article|post|entry|content|main|body|text|story|rich-text|markdown|prose|detail|blog/i;
const NOISE_KEYWORDS = /sidebar|widget|comment|footer|header|nav|menu|breadcrumb|advertisement|ad-|ads-|social|share|related|recommend|copyright|pagination|pager/i;

function extractFromHTML(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // --- 标题 ---
  let title = '';
  const ogTitle = doc.querySelector('meta[property="og:title"]');
  if (ogTitle && ogTitle.content) {
    title = ogTitle.content.trim();
  } else if (doc.title) {
    title = doc.title.trim();
  }
  // 清理站点后缀
  for (const sep of [' - ', ' | ', ' – ', ' — ', ' :: ', ' · ']) {
    if (title.includes(sep)) {
      const parts = title.split(sep);
      title = parts.reduce((a, b) => a.length >= b.length ? a : b).trim();
      break;
    }
  }

  // --- Meta description ---
  let metaDesc = '';
  const descMeta = doc.querySelector('meta[name="description"], meta[property="og:description"], meta[name="twitter:description"]');
  if (descMeta && descMeta.content) metaDesc = descMeta.content.trim();

  // --- Meta keywords ---
  let metaKeywords = '';
  const kwMeta = doc.querySelector('meta[name="keywords"]');
  if (kwMeta && kwMeta.content) metaKeywords = kwMeta.content.trim();

  // --- 移除噪声 ---
  doc.querySelectorAll(NOISE_SELECTORS).forEach(el => el.remove());
  // 移除噪声 class/id 容器
  doc.querySelectorAll('div, section, aside').forEach(el => {
    const cls = (el.className || '') + ' ' + (el.id || '');
    if (NOISE_KEYWORDS.test(cls)) el.remove();
  });

  // --- 智能提取正文 ---
  let bodyText = '';
  const candidates = [];

  doc.querySelectorAll('article, main, section, div').forEach(container => {
    const cls = (container.className || '') + ' ' + (container.id || '');
    if (NOISE_KEYWORDS.test(cls)) return;

    const paragraphs = container.querySelectorAll('p, li, td, blockquote, h1, h2, h3, h4, dd, dt');
    if (!paragraphs.length) return;

    let textLen = 0, linkLen = 0;
    const lines = [];
    paragraphs.forEach(p => {
      const t = p.textContent.trim();
      if (t.length < 6) return;
      textLen += t.length;
      p.querySelectorAll('a').forEach(a => { linkLen += a.textContent.trim().length; });
      lines.push(t);
    });

    if (textLen === 0) return;
    const linkRatio = linkLen / textLen;
    let score = textLen * (1 - linkRatio);
    if (CONTENT_KEYWORDS.test(cls)) score *= 1.5;

    candidates.push({ score, text: lines.join('\n'), textLen });
  });

  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length > 0) {
    bodyText = candidates[0].text;
  } else {
    const body = doc.querySelector('body');
    if (body) {
      bodyText = body.textContent.split('\n').map(l => l.trim()).filter(l => l.length > 0).join('\n');
    }
  }

  // --- 组装摘要 ---
  const summaryParts = [];
  if (metaDesc) summaryParts.push(metaDesc);
  if (bodyText) {
    const excerpt = bodyText.substring(0, 800);
    if (!(metaDesc && excerpt.startsWith(metaDesc.substring(0, 50)))) {
      summaryParts.push(excerpt);
    }
  }
  const summary = summaryParts.length > 0 ? summaryParts.join('\n\n') : '无法提取内容';

  // --- 标签 ---
  let suggestedTags = '';
  if (metaKeywords) {
    const tags = metaKeywords.replace(/，/g, ',').split(',').map(t => t.trim()).filter(Boolean);
    suggestedTags = tags.slice(0, 8).join(',');
  }

  return { title, summary: summary.substring(0, 1500), suggestedTags };
}

// ==================== 按钮加载状态（固定尺寸） ====================

function setButtonLoading(btn) {
  const rect = btn.getBoundingClientRect();
  btn._oldHTML = btn.innerHTML;
  btn.style.width = rect.width + 'px';
  btn.style.height = rect.height + 'px';
  btn.style.display = 'inline-flex';
  btn.style.alignItems = 'center';
  btn.style.justifyContent = 'center';
  btn.innerHTML = '<span class="spinner"></span>';
  btn.disabled = true;
}

function restoreButton(btn) {
  btn.innerHTML = btn._oldHTML || '';
  btn.style.width = '';
  btn.style.height = '';
  btn.style.display = '';
  btn.style.alignItems = '';
  btn.style.justifyContent = '';
  btn.disabled = false;
}

// ==================== 内置提取（从当前页面 DOM） ====================

async function doFetch() {
  const btn = $('#btn-fetch');
  setButtonLoading(btn);

  try {
    const html = await getCurrentPageHTML();
    if (!html) {
      // 保底：至少用 tab.title
      if (state.currentTab && state.currentTab.title) {
        $('#add-title').value = state.currentTab.title;
        showAddMsg('仅获取到标题，无法提取正文内容', 'info');
      } else {
        showAddMsg('无法获取当前页面内容', 'error');
      }
      return;
    }

    const result = extractFromHTML(html);
    if (result.title) $('#add-title').value = result.title;
    if (result.summary) $('#add-summary').value = result.summary;
    if (result.suggestedTags) {
      const tags = result.suggestedTags.split(',').map(t => t.trim()).filter(Boolean);
      state.currentTags = [...new Set([...state.currentTags, ...tags])];
      renderTagPills();
    }
    showAddMsg('提取成功', 'success');
  } catch (err) {
    showAddMsg('提取失败: ' + err.message, 'error');
  } finally {
    restoreButton(btn);
  }
}

// ==================== 设置面板 ====================

function showSettingsPanel() {
  const panel = $('#settings-panel');
  $('#ai-api-url').value = state.aiConfig.apiUrl || '';
  $('#ai-api-key').value = state.aiConfig.apiKey || '';
  $('#ai-model').value = state.aiConfig.model || '';
  $('#ai-prompt').value = state.aiConfig.prompt || '';
  $('#ai-enable-images').checked = !!state.aiConfig.enableImages;
  // 更新 token 用量显示
  const tokenEl = $('#ai-token-usage');
  if (tokenEl) {
    const k = (state.totalTokens / 1000).toFixed(1);
    tokenEl.textContent = `累计使用: ${k}K tokens`;
  }
  panel.style.display = 'block';
}

function hideSettingsPanel() {
  $('#settings-panel').style.display = 'none';
}

function saveAIConfig() {
  state.aiConfig = {
    apiUrl: $('#ai-api-url').value.trim(),
    apiKey: $('#ai-api-key').value.trim(),
    model: $('#ai-model').value.trim(),
    prompt: $('#ai-prompt').value.trim(),
    enableImages: $('#ai-enable-images').checked,
  };
  try { chrome.storage.local.set({ aiConfig: state.aiConfig }); } catch {}
  updateAIButton();
  showConfigMsg('AI 配置已保存', 'success');
}

function showConfigMsg(msg, type) {
  const el = $('#ai-config-msg');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  setTimeout(() => el.classList.remove('show'), 2000);
}

function updateAIButton() {
  const btn = $('#btn-fetch-ai');
  const ready = state.aiConfig.apiUrl && state.aiConfig.apiKey && state.aiConfig.model;
  if (ready) {
    btn.classList.add('ai-ready');
    btn.title = `AI 提取 (${state.aiConfig.model})`;
  } else {
    btn.classList.remove('ai-ready');
    btn.title = '需先在设置中配置 AI';
  }
}

// ==================== AI 提取（直接调用 API） ====================

async function doFetchAI() {
  const { apiUrl, apiKey, model, prompt: customPrompt, enableImages } = state.aiConfig;
  if (!apiUrl || !apiKey || !model) {
    showAddMsg('请先在设置中配置 AI 参数', 'error');
    showSettingsPanel();
    return;
  }

  const btn = $('#btn-fetch-ai');
  setButtonLoading(btn);

  try {
    // 第一步：从当前页面 DOM 提取内容
    const html = await getCurrentPageHTML();
    if (!html) {
      showAddMsg('无法获取页面内容，AI 无法分析', 'error');
      return;
    }
    const extracted = extractFromHTML(html);
    const pageTitle = extracted.title || (state.currentTab ? state.currentTab.title : '') || '';
    const pageText = extracted.summary || '';

    if (!pageText) {
      showAddMsg('页面内容为空，AI 无法分析', 'error');
      return;
    }

    // 第二步：获取图片（如果启用）
    let imageUrls = [];
    if (enableImages) {
      imageUrls = await getPageImages();
      console.log('[LLC] extracted images:', imageUrls.length);
    }

    // 第三步：构建 AI 请求
    const systemPrompt = customPrompt || (
      '你是一个网页内容分析助手。请根据以下网页内容' + (imageUrls.length ? '和图片' : '') + '，生成：\n' +
      '1. 一段简洁的中文摘要（100-300字）\n' +
      '2. 5-20个精准的分类标签（用逗号分隔，数量视内容丰富度而定）\n\n' +
      '请严格按以下 JSON 格式返回（不要包含 markdown 代码块标记）：\n' +
      '{"summary": "摘要内容", "tags": "标签1,标签2,...,标签N"}\n'
    );

    let apiEndpoint = apiUrl.replace(/\/+$/, '');
    if (!apiEndpoint.endsWith('/chat/completions')) {
      apiEndpoint += '/chat/completions';
    }

    // 构建用户消息（支持图片 vision 格式）
    const textPart = `网页标题：${pageTitle}\n\n网页内容：\n${pageText.substring(0, 3000)}`;
    let userContent;
    if (imageUrls.length > 0) {
      userContent = [{ type: 'text', text: textPart }];
      imageUrls.forEach(url => {
        userContent.push({ type: 'image_url', image_url: { url } });
      });
    } else {
      userContent = textPart;
    }

    const aiResp = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.3,
        max_tokens: 1500,
      }),
    });

    if (!aiResp.ok) {
      const errData = await aiResp.json().catch(() => ({}));
      throw new Error(errData.error?.message || `API 错误 (HTTP ${aiResp.status})`);
    }

    const aiData = await aiResp.json();
    const aiText = aiData.choices?.[0]?.message?.content?.trim() || '';

    // 统计 token 用量
    const usage = aiData.usage || {};
    const usedTokens = usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
    if (usedTokens > 0) {
      state.totalTokens += usedTokens;
      try { chrome.storage.local.set({ totalTokens: state.totalTokens }); } catch {}
    }

    // 解析 AI 返回的 JSON
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (pageTitle) $('#add-title').value = pageTitle;
        if (parsed.summary) $('#add-summary').value = parsed.summary;
        if (parsed.tags) {
          const aiTags = parsed.tags.split(',').map(t => t.trim()).filter(Boolean);
          // AI 提取的标签进入"智能标签"
          state.currentAiTags = [...new Set([...state.currentAiTags, ...aiTags])];
          renderAiTagPills();
        }
        const tokenInfo = usedTokens > 0 ? ` (${usedTokens} tokens)` : '';
        showAddMsg('AI 提取成功 ✨' + tokenInfo, 'success');
        return;
      } catch {}
    }

    // 解析失败：把 AI 原始回复当摘要
    if (pageTitle) $('#add-title').value = pageTitle;
    $('#add-summary').value = aiText.substring(0, 1500);
    const tokenInfo = usedTokens > 0 ? ` (${usedTokens} tokens)` : '';
    showAddMsg('AI 返回解析异常，已将原始回复填入摘要' + tokenInfo, 'info');

  } catch (err) {
    showAddMsg('AI 提取错误: ' + err.message, 'error');
  } finally {
    restoreButton(btn);
  }
}

// ==================== 保存 ====================

async function doSave() {
  const url = $('#add-url').value.trim();
  if (!url) return showAddMsg('无法获取页面链接', 'error');

  const bookmark = {
    url,
    name: $('#add-name').value.trim(),
    title: $('#add-title').value.trim(),
    tags: state.currentTags.join(','),
    aiTags: state.currentAiTags.join(','),
    summary: $('#add-summary').value.trim(),
  };

  try {
    await localAdd(bookmark);
    showAddMsg('已保存', 'success');
    clearAddForm();
    loadBookmarks();
    loadAllTags();
    setTimeout(() => {
      $('#add-panel').classList.add('collapsed');
      $('#add-panel').classList.remove('expanded');
    }, 500);
  } catch (err) {
    showAddMsg('保存错误: ' + err.message, 'error');
  }
}

function clearAddForm() {
  $('#add-name').value = '';
  $('#add-title').value = '';
  $('#add-summary').value = '';
  state.currentTags = [];
  state.currentAiTags = [];
  state.pageHTML = null;
  renderTagPills();
  renderAiTagPills();
  // URL 保持当前页面
  if (state.currentTab) {
    $('#add-url').value = state.currentTab.url || '';
  }
}

function showAddMsg(msg, type) {
  const el = $('#add-msg');
  el.textContent = msg;
  el.className = 'toast ' + type;
  // 重新触发动画
  el.style.animation = 'none';
  el.offsetHeight; // force reflow
  el.style.animation = '';
  setTimeout(() => { el.className = 'toast'; }, 3000);
}

// ==================== 加载 & 渲染 ====================

async function loadBookmarks(keyword) {
  const container = $('#results');
  try {
    const bookmarks = await localSearch(keyword);

    if (bookmarks.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><rect x="8" y="6" width="32" height="36" rx="4" stroke="#C7C7CC" stroke-width="2"/><path d="M16 16h16M16 22h10M16 28h14" stroke="#C7C7CC" stroke-width="2" stroke-linecap="round"/></svg>
          <p>${keyword ? '没有找到匹配的书签' : '还没有收藏<br>点击右上角 + 添加第一个吧'}</p>
        </div>`;
      return;
    }

    container.innerHTML = '';
    bookmarks.forEach(b => container.appendChild(createBookmarkCard(b)));
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>加载错误: ${escHtml(err.message)}</p></div>`;
  }
}

function createBookmarkCard(b) {
  const card = document.createElement('div');
  card.className = 'bookmark-card';
  const tags = parseTags(b.tags);
  const aiTags = parseTags(b.aiTags);
  const displayName = b.name || b.title || b.url;
  const timeStr = b.updated_at ? new Date(b.updated_at).toLocaleString('zh-CN') : '';

  card.innerHTML = `
    <div class="card-header">
      <div style="flex:1;min-width:0;">
        <div class="card-name">${escHtml(displayName)}</div>
        ${b.title && b.name ? `<div class="card-title">${escHtml(b.title)}</div>` : ''}
      </div>
    </div>
    <a class="card-url" href="${escHtml(b.url)}" target="_blank" rel="noopener">${escHtml(b.url)}</a>
    ${b.summary ? `<div class="card-summary">${escHtml(b.summary)}</div>` : ''}
    ${tags.length ? `<div class="card-tags">${tags.map(t => `<span class="card-tag">${escHtml(t)}</span>`).join('')}</div>` : ''}
    ${aiTags.length ? `<div class="card-tags">${aiTags.map(t => `<span class="card-tag card-ai-tag">${escHtml(t)}</span>`).join('')}</div>` : ''}
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div class="card-meta">${timeStr}</div>
      <div class="card-actions">
        <button class="card-action-btn" data-action="edit" data-id="${b.id}">编辑</button>
        <button class="card-action-btn danger" data-action="delete" data-id="${b.id}">删除</button>
      </div>
    </div>`;

  card.querySelector('[data-action="delete"]').onclick = () => confirmDelete(b);
  card.querySelector('[data-action="edit"]').onclick = () => startEdit(b);
  return card;
}

// ==================== 编辑 ====================

function startEdit(b) {
  const panel = $('#add-panel');
  panel.classList.remove('collapsed');
  panel.classList.add('expanded');

  $('#add-url').value = b.url || '';
  $('#add-name').value = b.name || '';
  $('#add-title').value = b.title || '';
  $('#add-summary').value = b.summary || '';

  state.currentTags = parseTags(b.tags);
  state.currentAiTags = parseTags(b.aiTags);
  renderTagPills();
  renderAiTagPills();

  const saveBtn = $('#btn-save');
  saveBtn.textContent = '更新收藏';
  saveBtn.onclick = async () => {
    await doUpdate(b.id);
    saveBtn.textContent = '保存收藏';
    saveBtn.onclick = doSave;
  };
}

async function doUpdate(id) {
  const data = {
    url: $('#add-url').value.trim(),
    name: $('#add-name').value.trim(),
    title: $('#add-title').value.trim(),
    tags: state.currentTags.join(','),
    aiTags: state.currentAiTags.join(','),
    summary: $('#add-summary').value.trim(),
  };
  if (!data.url) return showAddMsg('请输入链接地址', 'error');

  try {
    await localUpdate(id, data);
    showAddMsg('已更新', 'success');
    clearAddForm();
    loadBookmarks();
    loadAllTags();
  } catch (err) {
    showAddMsg('更新错误: ' + err.message, 'error');
  }
}

// ==================== 删除 ====================

function confirmDelete(b) {
  showConfirm('删除收藏', `确定删除「${b.name || b.title || b.url}」？此操作不可撤销。`, async () => {
    try {
      await localDelete(b.id);
      loadBookmarks($('#search-input').value);
      loadAllTags();
    } catch (err) {
      alert('删除失败: ' + err.message);
    }
  });
}

function showConfirm(title, msg, onOk) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-dialog">
      <div class="confirm-title">${escHtml(title)}</div>
      <div class="confirm-msg">${escHtml(msg)}</div>
      <div class="confirm-actions">
        <button class="confirm-cancel">取消</button>
        <button class="confirm-ok">确定</button>
      </div>
    </div>`;
  overlay.querySelector('.confirm-cancel').onclick = () => overlay.remove();
  overlay.querySelector('.confirm-ok').onclick = () => { overlay.remove(); onOk(); };
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}

// ==================== 标签分组 ====================

async function loadTagGroups() {
  const container = $('#tag-groups');
  try {
    const all = await localGetAll();
    const map = {};
    all.forEach(b => {
      parseTags(b.tags).forEach(tag => {
        if (!map[tag]) map[tag] = [];
        map[tag].push(b);
      });
      parseTags(b.aiTags).forEach(tag => {
        if (!map[tag]) map[tag] = [];
        if (!map[tag].includes(b)) map[tag].push(b);
      });
    });
    const groups = Object.entries(map)
      .map(([tag, bookmarks]) => ({ tag, bookmarks }))
      .sort((a, b) => b.bookmarks.length - a.bookmarks.length);

    if (groups.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>暂无标签分组</p></div>';
      return;
    }

    container.innerHTML = '';
    groups.forEach(g => {
      const div = document.createElement('div');
      div.className = 'tag-group';
      div.innerHTML = `
        <div class="tag-group-header">
          <span class="tag-group-name">${escHtml(g.tag)}</span>
          <span class="tag-group-count">${g.bookmarks.length}</span>
        </div>
        <div class="tag-group-items">
          ${g.bookmarks.map(b => `
            <div class="tag-group-item">
              <div class="tag-group-item-name">${escHtml(b.name || b.title || b.url)}</div>
              <div class="tag-group-item-url">${escHtml(b.url)}</div>
            </div>
          `).join('')}
        </div>`;
      div.querySelector('.tag-group-header').onclick = () => {
        div.querySelector('.tag-group-items').classList.toggle('expanded');
      };
      div.querySelectorAll('.tag-group-item').forEach((item, i) => {
        item.onclick = () => window.open(g.bookmarks[i].url, '_blank');
      });
      container.appendChild(div);
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>加载错误: ${escHtml(err.message)}</p></div>`;
  }
}

// ==================== 导出 ====================

async function doExport() {
  try {
    const all = await localGetAll();
    if (all.length === 0) return alert('没有数据可导出');
    const headers = ['名称', '标题', '链接', '标签', '智能标签', '摘要', '创建时间', '更新时间'];
    const rows = all.map(b => [
      b.name || '', b.title || '', b.url || '',
      b.tags || '', b.aiTags || '', b.summary || '',
      b.created_at || '', b.updated_at || '',
    ]);
    const csv = [headers, ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, `链接收藏_${formatDate(new Date())}.csv`);
  } catch (err) {
    alert('导出失败: ' + err.message);
  }
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ==================== 导入 ====================

async function doImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  try {
    const text = await file.text();
    const lines = parseCSV(text);
    if (lines.length < 2) throw new Error('文件为空或格式不正确');

    // 查找列索引（支持中英文表头）
    const header = lines[0].map(h => h.trim().toLowerCase());
    const colMap = {
      name:       findCol(header, ['名称', 'name', '自定义名称']),
      title:      findCol(header, ['标题', 'title', '页面标题']),
      url:        findCol(header, ['链接', 'url', '网址', '链接地址']),
      tags:       findCol(header, ['标签', 'tags', 'tag']),
      aiTags:     findCol(header, ['智能标签', 'aitags', 'ai_tags', 'ai标签']),
      summary:    findCol(header, ['摘要', 'summary', '内容摘要', '描述']),
      created_at: findCol(header, ['创建时间', 'created_at', 'createdat']),
      updated_at: findCol(header, ['更新时间', 'updated_at', 'updatedat']),
    };

    if (colMap.url === -1) throw new Error('未找到链接/URL 列');

    let imported = 0;
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i];
      const url = (row[colMap.url] || '').trim();
      if (!url) continue;
      await localAdd({
        url,
        name:       colMap.name >= 0 ? (row[colMap.name] || '').trim() : '',
        title:      colMap.title >= 0 ? (row[colMap.title] || '').trim() : '',
        tags:       colMap.tags >= 0 ? (row[colMap.tags] || '').trim() : '',
        aiTags:     colMap.aiTags >= 0 ? (row[colMap.aiTags] || '').trim() : '',
        summary:    colMap.summary >= 0 ? (row[colMap.summary] || '').trim() : '',
        created_at: colMap.created_at >= 0 ? (row[colMap.created_at] || '').trim() : '',
        updated_at: colMap.updated_at >= 0 ? (row[colMap.updated_at] || '').trim() : '',
      });
      imported++;
    }

    alert(`导入成功：${imported} 条记录`);
    loadBookmarks();
    loadAllTags();
  } catch (err) {
    alert('导入失败: ' + err.message);
  }
}

function findCol(header, names) {
  for (const n of names) {
    const idx = header.indexOf(n.toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

// 简单 CSV 解析器（支持引号包裹的字段）
function parseCSV(text) {
  const lines = [];
  let current = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        current.push(field);
        field = '';
      } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        current.push(field);
        field = '';
        if (current.some(c => c.trim())) lines.push(current);
        current = [];
        if (ch === '\r') i++;
      } else {
        field += ch;
      }
    }
  }
  // 最后一行
  if (field || current.length) {
    current.push(field);
    if (current.some(c => c.trim())) lines.push(current);
  }
  return lines;
}

// ==================== 工具函数 ====================

function parseTags(tags) {
  if (!tags) return [];
  return tags.split(',').map(t => t.trim()).filter(Boolean);
}

function escHtml(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function formatDate(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
