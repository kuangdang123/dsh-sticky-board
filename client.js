/* ================= 00-head.js ================= */
// Sticky notes — browser half.
//
// Loaded by dsh-client-modules at /plugins/dsh-sticky-board/client.js and run
// through the shell's lazy-CJS module table (`window.__ModuleLoader__.load`).
// Everything below shares ONE factory scope: each `src/*.js` fragment assigns
// onto the `DSN` namespace object declared here, so no fragment needs imports.
window.__ModuleLoader__.load({
  id: 'dsh-sticky-board',
  factory: function (require) {
    'use strict'
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var ReactDOMClient = require('react-dom/client')

    var h = React.createElement
    var DSN = {}
    DSN.React = React
    DSN.ReactDOM = ReactDOMClient
    DSN.h = h
    DSN.VERSION = '0.1.0'

/* ================= 10-core.js ================= */
/* ------------------------------------------------------------------ *
 * Shared plumbing: logging, ids, DOM helpers, a tiny event bus, style
 * injection, the icon set, and clipboard access.
 * ------------------------------------------------------------------ */

DSN.NS = 'dshNotes'
DSN.debug = false

DSN.log = function () {
  if (!DSN.debug) return
  try {
    var args = ['[sticky-notes]']
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i])
    console.log.apply(console, args)
  } catch (error) { /* logging must never throw */ }
}

DSN.uid = function (prefix) {
  return String(prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7)
}

DSN.now = function () { return Date.now() }

DSN.clamp = function (value, min, max) {
  return value < min ? min : value > max ? max : value
}

DSN.escapeHtml = function (value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  })
}

DSN.debounce = function (fn, ms) {
  var timer = null
  return function () {
    var self = this
    var args = arguments
    if (timer) clearTimeout(timer)
    timer = setTimeout(function () { timer = null; fn.apply(self, args) }, ms)
  }
}

DSN.throttle = function (fn, ms) {
  var last = 0
  var timer = null
  return function () {
    var self = this
    var args = arguments
    var now = Date.now()
    var wait = ms - (now - last)
    if (wait <= 0) {
      if (timer) { clearTimeout(timer); timer = null }
      last = now
      fn.apply(self, args)
      return
    }
    if (timer) return
    timer = setTimeout(function () { timer = null; last = Date.now(); fn.apply(self, args) }, wait)
  }
}

/** addEventListener that returns its own disposer. */
DSN.on = function (target, type, handler, options) {
  if (!target || typeof target.addEventListener !== 'function') return function () {}
  target.addEventListener(type, handler, options)
  return function () {
    try { target.removeEventListener(type, handler, options) } catch (error) { /* already gone */ }
  }
}

/** Clause guard used by every global pointer/keyboard handler we own. */
DSN.isEditable = function (node) {
  if (!node || node.nodeType !== 1) return false
  var tag = node.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (node.isContentEditable) return true
  return false
}

DSN.closest = function (node, selector) {
  var current = node
  while (current && current.nodeType === 1) {
    if (typeof current.closest === 'function') {
      var hit = current.closest(selector)
      if (hit) return hit
      return null
    }
    current = current.parentNode
  }
  return null
}

/* ---------------------------- event bus ---------------------------- */

DSN.bus = (function () {
  var listeners = new Set()
  return {
    emit: function (event) {
      listeners.forEach(function (fn) {
        try { fn(event) } catch (error) { DSN.log('bus listener failed', error) }
      })
    },
    subscribe: function (fn) {
      listeners.add(fn)
      return function () { listeners.delete(fn) }
    },
  }
})()

DSN.toast = function (text, kind) {
  DSN.bus.emit({ type: 'toast', text: text, kind: kind || 'info', id: DSN.uid('toast') })
}

/* -------------------------- style injection ------------------------ */

DSN.injectStyle = function (doc, cssText) {
  if (!doc || !doc.createElement) return function () {}
  var existing = doc.querySelector('style[data-dsn-style="1"]')
  if (existing) {
    existing.textContent = cssText
    return function () {}
  }
  var element = doc.createElement('style')
  element.setAttribute('data-dsn-style', '1')
  element.textContent = cssText
  ;(doc.head || doc.documentElement).appendChild(element)
  return function () {
    if (element.parentNode) element.parentNode.removeChild(element)
  }
}

/* ------------------------------- icons ----------------------------- */

DSN.ICONS = {
  note: ['M5 4h9.5L19 8.5V20H5z', 'M14.5 4v4.5H19', 'M8.5 12.5h7', 'M8.5 15.5h4.5'],
  plus: ['M12 5v14', 'M5 12h14'],
  close: ['M18 6 6 18', 'M6 6l12 12'],
  search: ['M11 4.8a6.2 6.2 0 1 0 0 12.4 6.2 6.2 0 0 0 0-12.4z', 'm15.6 15.6 3.9 3.9'],
  copy: ['M9.5 9.5h8.5a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H9.5A1.5 1.5 0 0 1 8 19.5V11a1.5 1.5 0 0 1 1.5-1.5z', 'M15.5 6.5h-9A1.5 1.5 0 0 0 5 8v9'],
  trash: ['M4 7h16', 'M9.5 7V4.5h5V7', 'M6.5 7l.9 11.4A2 2 0 0 0 9.4 20h5.2a2 2 0 0 0 2-1.6L17.5 7', 'M10.5 11v5.5', 'M13.5 11v5.5'],
  pin: ['M12 14.5V21', 'M8.5 3.5h7l-1 6 3 4H6.5l3-4-1-6z'],
  insert: ['M12 3.5v10', 'm8 9.5 4 4 4-4', 'M5 20.5h14'],
  quote: ['M9.5 6.5C7.3 7.4 6 9.4 6 12v6h5.5v-6H8.8c0-1.8.7-3.1 2.2-3.8z', 'M18 6.5c-2.2.9-3.5 2.9-3.5 5.5v6h5.5v-6h-2.7c0-1.8.7-3.1 2.2-3.8z'],
  edit: ['M4.5 19.5H8l10-10a2.1 2.1 0 0 0-3-3l-10 10v3z'],
  check: ['M4.5 12.5l5 5 10-11'],
  pip: ['M3.5 4.5h17v15h-17z', 'M12 11.5h6.5v6H12z'],
  grip: ['M9 6.5h.01', 'M9 12h.01', 'M9 17.5h.01', 'M15 6.5h.01', 'M15 12h.01', 'M15 17.5h.01'],
  chevron: ['m7 10 5 5 5-5'],
  more: ['M5.5 12h.01', 'M12 12h.01', 'M18.5 12h.01'],
  folder: ['M3.5 6.5h6l2 2h9v11h-17z'],
  sections: ['M4 5.5h16', 'M4 12h16', 'M4 18.5h10'],
  restore: ['M4.5 12a7.5 7.5 0 1 0 2.4-5.5', 'M4 4v4.5h4.5'],
  image: ['M3.5 5.5h17v13h-17z', 'M3.5 15.5l4.5-4.5 3.5 3.5 3-3 6 6', 'M15.5 9.5h.01'],
  table: ['M3.5 5.5h17v13h-17z', 'M3.5 10h17', 'M9.5 10v8.5', 'M15 10v8.5'],
  collapse: ['m7 14 5-5 5 5'],
  expand: ['m7 10 5 5 5-5'],
  float: ['M14 4.5h6v6', 'M20 4.5 11 13.5', 'M18.5 14v5.5h-13v-13H11'],
}

DSN.Icon = function Icon(props) {
  var name = props.name
  var size = props.size || 16
  var paths = DSN.ICONS[name] || DSN.ICONS.note
  var children = []
  for (var i = 0; i < paths.length; i++) children.push(h('path', { key: i, d: paths[i] }))
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: props.thick ? 2.4 : 1.7,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
    focusable: 'false',
    className: props.className,
  }, children)
}

/* ----------------------------- clipboard --------------------------- */

/**
 * Copy rich content. Prefers an HTML+text clipboard item so a paste into a
 * Markdown composer keeps tables and code fences, and degrades to plain text.
 */
DSN.copyRich = function (html, text) {
  var plain = text == null ? '' : String(text)
  var rich = html == null ? '' : String(html)
  var ClipItem = typeof window !== 'undefined' ? window.ClipboardItem : undefined
  if (navigator.clipboard && typeof navigator.clipboard.write === 'function' && ClipItem) {
    try {
      return navigator.clipboard.write([new ClipItem({
        'text/html': new Blob([rich], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      })]).then(function () { return true }, function (error) {
        DSN.log('richtext clipboard rejected', error)
        return DSN.copyText(plain)
      })
    } catch (error) {
      DSN.log('ClipboardItem construction failed', error)
    }
  }
  return DSN.copyText(plain)
}

DSN.copyText = function (text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(String(text)).then(function () { return true }, function (error) {
      DSN.log('clipboard.writeText rejected', error)
      return DSN.copyTextFallback(text)
    })
  }
  return Promise.resolve(DSN.copyTextFallback(text))
}

DSN.copyTextFallback = function (text) {
  try {
    var area = document.createElement('textarea')
    area.value = String(text)
    area.setAttribute('aria-hidden', 'true')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    var ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch (error) {
    DSN.log('execCommand copy failed', error)
    return false
  }
}

/** Human-readable age of a note, localized with the caller's translate fn. */
DSN.formatAge = function (timestamp, t) {
  var delta = Date.now() - Number(timestamp || 0)
  var minute = 60000
  var hour = 60 * minute
  var day = 24 * hour
  if (!isFinite(delta) || delta < minute) return t('time.justNow')
  if (delta < hour) return t('time.minutes', { n: Math.floor(delta / minute) })
  if (delta < day) return t('time.hours', { n: Math.floor(delta / hour) })
  if (delta < 7 * day) return t('time.days', { n: Math.floor(delta / day) })
  var date = new Date(Number(timestamp))
  var month = date.getMonth() + 1
  var dayOfMonth = date.getDate()
  return date.getFullYear() === new Date().getFullYear()
    ? month + '/' + dayOfMonth
    : date.getFullYear() + '/' + month + '/' + dayOfMonth
}

/** First non-empty text line, used as a card headline. */
DSN.headline = function (text, limit) {
  var raw = String(text == null ? '' : text).trim()
  if (!raw) return ''
  var line = raw.split('\n').find(function (item) { return item.trim() !== '' }) || raw
  line = line.replace(/\s+/g, ' ').trim()
  var max = limit || 60
  return line.length > max ? line.slice(0, max - 1) + '…' : line
}

/* ================= 15-i18n.js ================= */
/* ------------------------------------------------------------------ *
 * Copy dictionaries. Every user-visible string in this plugin lives here;
 * components receive `t` (the locale service's bound translate function).
 * `zh` is the key source of truth, `en` must carry the same keys.
 * ------------------------------------------------------------------ */

DSN.zh = {
  'panel.title': '便签',
  'panel.close': '关闭面板',
  'panel.collapse': '收起',
  'panel.expand': '展开',
  'panel.pip': '画中画（置顶悬浮窗）',
  'panel.dragHint': '拖动标题栏移动，拖动右下角调整大小',

  'tab.all': '全部',
  'tab.trash': '回收站',

  'section.inbox': '收件箱',
  'section.add': '新建分区',
  'section.rename': '重命名分区',
  'section.delete': '删除分区',
  'section.namePlaceholder': '分区名称',
  'section.deleteHint': '分区内的便签会移到第一个分区',
  'section.count': '{n} 条',

  'composer.placeholder': '记一条…  可直接粘贴图片/表格，也可以从对话里拖进来',
  'composer.save': '保存',
  'composer.saveHint': 'Ctrl+Enter 保存',
  'composer.richHint': '支持富文本、代码、表格、图片',

  'note.copy': '复制',
  'note.insert': '插入到输入框',
  'note.quote': '引用到输入框',
  'note.pin': '置顶',
  'note.unpin': '取消置顶',
  'note.edit': '编辑',
  'note.save': '保存修改',
  'note.cancel': '取消',
  'note.delete': '删除',
  'note.restore': '恢复',
  'note.purge': '彻底删除',
  'note.empty': '停用',
  'note.saved': '已存入便签',
  'note.updated': '已更新便签',
  'note.dragHint': '拖动可排序 / 归档到其他分区',

  'search.placeholder': '搜索便签…',
  'search.clear': '清除搜索',

  'list.empty': '还没有便签。选中对话里的内容后点「存便签」，或在上方直接记录。',
  'list.emptySection': '这个分区还是空的。',
  'list.trashEmpty': '回收站是空的。',
  'list.count': '{n} 条便签',
  'list.pinned': '置顶',
  'list.source': '来自 {name}',

  'trash.dropHint': '拖到这里删除',
  'trash.emptyAll': '清空回收站',
  'trash.confirmEmpty': '彻底删除回收站里的全部便签？',

  'capture.chip': '存便签',
  'capture.chipTitle': '把选中的内容存入便签 (Alt+Shift+S)',
  'capture.quote': '引用文本',
  'capture.dropHere': '松手存入便签',
  'capture.dropRich': '拖入文本 / 表格 / 图片',

  'status.storageFull': '便签存储已满，请清理回收站或删除部分便签',
  'status.copyFailed': '复制失败，请手动选中复制',
  'status.copied': '已复制',
  'status.inserted': '已插入到输入框',
  'status.quoted': '已作为引用插入输入框',
  'status.quotedOther': '已插入引用（原文来自另一个会话：{name}）',
  'status.quotedCopied': '当前没有可用的输入框，已复制原文',
  'status.noSession': '当前没有可插入的会话，已复制到剪贴板',

  'sync.idle': '本地',
  'sync.loading': '正在读取已保存的便签…',
  'sync.saving': '保存中…',
  'sync.saved': '已保存',
  'sync.local': '仅浏览器本地',
  'sync.error': '保存失败',
  'sync.title': '便签保存在本机文件中；点击可立即保存',

  'pip.unsupported': '当前浏览器不支持画中画窗口',
  'pip.title': '便签 · 置顶窗口',

  'sidebar.launcher': '便签',
  'sidebar.tabTitle': '便签',
  'sidebar.tabDescription': '随手记录与跨会话搬运',

  'shortcuts.hint': 'Alt+Shift+N 打开/关闭便签 · Alt+Shift+S 存选区',

  'time.justNow': '刚刚',
  'time.minutes': '{n} 分钟前',
  'time.hours': '{n} 小时前',
  'time.days': '{n} 天前',

  'kind.text': '文本',
  'kind.table': '表格',
  'kind.image': '图片',
  'kind.code': '代码',
  'kind.mixed': '混合',
  'kind.link': '链接',
}

DSN.en = {
  'panel.title': 'Sticky notes',
  'panel.close': 'Close panel',
  'panel.collapse': 'Collapse',
  'panel.expand': 'Expand',
  'panel.pip': 'Picture-in-picture (always on top)',
  'panel.dragHint': 'Drag the header to move, drag the corner to resize',

  'tab.all': 'All',
  'tab.trash': 'Trash',

  'section.inbox': 'Inbox',
  'section.add': 'New section',
  'section.rename': 'Rename section',
  'section.delete': 'Delete section',
  'section.namePlaceholder': 'Section name',
  'section.deleteHint': 'Notes in it move to the first section',
  'section.count': '{n}',

  'composer.placeholder': 'Write a note… paste images or tables, or drag content here',
  'composer.save': 'Save',
  'composer.saveHint': 'Ctrl+Enter to save',
  'composer.richHint': 'Rich text, code, tables and images are kept',

  'note.copy': 'Copy',
  'note.insert': 'Insert into composer',
  'note.quote': 'Quote into composer',
  'note.pin': 'Pin',
  'note.unpin': 'Unpin',
  'note.edit': 'Edit',
  'note.save': 'Save changes',
  'note.cancel': 'Cancel',
  'note.delete': 'Delete',
  'note.restore': 'Restore',
  'note.purge': 'Delete forever',
  'note.empty': 'Disable',
  'note.saved': 'Saved to notes',
  'note.updated': 'Note updated',
  'note.dragHint': 'Drag to reorder or move to another section',

  'search.placeholder': 'Search notes…',
  'search.clear': 'Clear search',

  'list.empty': 'No notes yet. Select something in a conversation and press "Save note", or write one above.',
  'list.emptySection': 'This section is empty.',
  'list.trashEmpty': 'The trash is empty.',
  'list.count': '{n} notes',
  'list.pinned': 'Pinned',
  'list.source': 'from {name}',

  'trash.dropHint': 'Drop here to delete',
  'trash.emptyAll': 'Empty trash',
  'trash.confirmEmpty': 'Permanently delete every note in the trash?',

  'capture.chip': 'Save note',
  'capture.chipTitle': 'Save the selection as a sticky note (Alt+Shift+S)',
  'capture.quote': 'Quote text',
  'capture.dropHere': 'Drop to save a note',
  'capture.dropRich': 'Drop text / tables / images',

  'status.storageFull': 'Note storage is full — empty the trash or delete some notes',
  'status.copyFailed': 'Copy failed, please select and copy manually',
  'status.copied': 'Copied',
  'status.inserted': 'Inserted into the composer',
  'status.quoted': 'Quoted into the composer',
  'status.quotedOther': 'Quoted — the source lives in another conversation: {name}',
  'status.quotedCopied': 'No composer available — copied the text instead',
  'status.noSession': 'No chat to insert into — copied to the clipboard instead',

  'sync.idle': 'Local',
  'sync.loading': 'Reading saved notes…',
  'sync.saving': 'Saving…',
  'sync.saved': 'Saved',
  'sync.local': 'Browser only',
  'sync.error': 'Save failed',
  'sync.title': 'Notes are saved to a file on this machine; click to save now',

  'pip.unsupported': 'This browser does not support picture-in-picture windows',
  'pip.title': 'Sticky notes · always on top',

  'sidebar.launcher': 'Sticky notes',
  'sidebar.tabTitle': 'Sticky notes',
  'sidebar.tabDescription': 'Quick capture and cross-session hand-off',

  'shortcuts.hint': 'Alt+Shift+N toggles notes · Alt+Shift+S saves the selection',

  'time.justNow': 'just now',
  'time.minutes': '{n}m ago',
  'time.hours': '{n}h ago',
  'time.days': '{n}d ago',

  'kind.text': 'Text',
  'kind.table': 'Table',
  'kind.image': 'Image',
  'kind.code': 'Code',
  'kind.mixed': 'Mixed',
  'kind.link': 'Link',
}

DSN.dicts = { zh: DSN.zh, en: DSN.en }

/**
 * Later fragments add their own copy here (called at load time, before
 * `apply()` registers the dictionaries), so each file owns its strings.
 */
DSN.addStrings = function (zh, en) {
  Object.keys(zh || {}).forEach(function (key) { DSN.dicts.zh[key] = zh[key] })
  Object.keys(en || {}).forEach(function (key) { DSN.dicts.en[key] = en[key] })
}

/** Fallback translator for the window before the locale service answers. */
DSN.fallbackT = function (key, params) {
  var table = DSN.dicts[DSN.defaultLang || 'zh'] || DSN.zh
  var template = table[key] != null ? table[key] : (DSN.zh[key] != null ? DSN.zh[key] : key)
  if (!params) return template
  return String(template).replace(/\{(\w+)\}/g, function (match, name) {
    return name in params ? String(params[name]) : match
  })
}

/* ================= 20-model.js ================= */
/* ------------------------------------------------------------------ *
 * The notes document: state shape, pure mutations, localStorage
 * persistence, and cross-window synchronization (a picture-in-picture
 * window is a second document of the same browser tab, so it shares this
 * store instance directly; other tabs get BroadcastChannel messages).
 * ------------------------------------------------------------------ */

DSN.STORAGE_KEY = 'dsh-notes/v1'
DSN.CHANNEL_NAME = '@@DSN_STORE_KEY@@'
DSN.MAX_NOTES = 800
DSN.MAX_HTML = 600000
/**
 * Priority is a four-step scale; `normal` is the default so an untouched board
 * looks exactly like it always did. Higher rank sorts first.
 */
DSN.PRIORITIES = ['urgent', 'high', 'normal', 'low']
DSN.DEFAULT_PRIORITY = 'normal'
DSN.PRIORITY_RANK = { urgent: 3, high: 2, normal: 1, low: 0 }
/** Checklists and comment threads are bounded so one note cannot blow the document up. */
DSN.MAX_TASKS = 60
DSN.MAX_TASK_TEXT = 200
DSN.MAX_COMMENTS = 80
DSN.MAX_COMMENT_HTML = 4000
/** Detached note windows: how many may float at once, and their size bounds. */
DSN.MAX_FLOATERS = 8
DSN.FLOAT_W = 360
DSN.FLOAT_H = 300
DSN.FLOAT_MIN_W = 220
DSN.FLOAT_MIN_H = 110
DSN.FLOAT_MAX_W = 1100
DSN.FLOAT_MAX_H = 2000

DSN.emptyState = function (t) {
  var translate = typeof t === 'function' ? t : DSN.fallbackT
  var inboxId = 'sec-inbox'
  return {
    version: 1,
    sections: [{ id: inboxId, name: translate('section.inbox'), order: 0 }],
    notes: [],
    ui: {
      open: false,
      collapsed: false,
      panel: null,
      activeSectionId: inboxId,
      view: 'board',
      search: '',
      seen: false,
      floaters: [],
      sort: 'time',
      priorityFilter: 'all',
      hideDone: false,
      detailNoteId: null,
    },
  }
}

/** One checklist item: plain text, so it stays readable in the JSON document. */
function normalizeTask(item) {
  if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id) return null
  return {
    id: item.id,
    text: String(item.text == null ? '' : item.text).slice(0, DSN.MAX_TASK_TEXT),
    done: item.done === true,
  }
}

/** One comment: rich text, the same sanitized subset every other surface uses. */
function normalizeComment(item) {
  if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id) return null
  var html = typeof item.html === 'string' ? item.html.slice(0, DSN.MAX_COMMENT_HTML) : ''
  var text = typeof item.text === 'string' ? item.text : ''
  return {
    id: item.id,
    html: html,
    text: text,
    createdAt: Number(item.createdAt) || Date.now(),
  }
}

function normalizeTaskList(raw) {
  var list = Array.isArray(raw) ? raw : []
  var out = []
  for (var i = 0; i < list.length && out.length < DSN.MAX_TASKS; i += 1) {
    var task = normalizeTask(list[i])
    if (task) out.push(task)
  }
  return out
}

function normalizeCommentList(raw) {
  var list = Array.isArray(raw) ? raw : []
  var out = []
  for (var i = 0; i < list.length && out.length < DSN.MAX_COMMENTS; i += 1) {
    var comment = normalizeComment(list[i])
    if (comment) out.push(comment)
  }
  out.sort(function (a, b) { return a.createdAt - b.createdAt })
  return out
}

/**
 * Where a captured note came from. The board never renders this; it is the
 * transcript coordinate the capture saw, kept so a note can be quoted back into
 * a composer exactly the way 引用文本 does (the quote body is plain text, the
 * position is only ours to remember).
 */
function normalizeOrigin(item) {
  if (!item || typeof item !== 'object') return null
  var sessionId = typeof item.sessionId === 'string' && item.sessionId ? item.sessionId : null
  var nodeKey = typeof item.nodeKey === 'string' && item.nodeKey ? item.nodeKey : null
  var anchorKey = typeof item.anchorKey === 'string' && item.anchorKey ? item.anchorKey : null
  var turn = Number(item.turn)
  var origin = {
    sessionId: sessionId,
    sessionTitle: typeof item.sessionTitle === 'string' ? item.sessionTitle.slice(0, 120) : '',
    turn: isFinite(turn) && turn >= 0 ? Math.round(turn) : null,
    nodeKey: nodeKey,
    anchorKey: anchorKey,
  }
  if (!origin.sessionId && !origin.nodeKey && !origin.anchorKey && origin.turn === null) return null
  return origin
}

DSN.normalizeTaskList = normalizeTaskList
DSN.normalizeCommentList = normalizeCommentList
DSN.normalizeOrigin = normalizeOrigin

DSN.normalizeState = function (raw, t) {
  var base = DSN.emptyState(t)
  if (!raw || typeof raw !== 'object') return base
  var sections = Array.isArray(raw.sections) ? raw.sections.filter(function (item) {
    return item && typeof item.id === 'string' && item.id
  }).map(function (item, index) {
    return {
      id: item.id,
      name: typeof item.name === 'string' ? item.name : base.sections[0].name,
      order: typeof item.order === 'number' ? item.order : index,
    }
  }) : []
  if (sections.length === 0) sections = base.sections
  sections.sort(function (a, b) { return a.order - b.order })

  var knownSections = new Set(sections.map(function (item) { return item.id }))
  var notes = Array.isArray(raw.notes) ? raw.notes.filter(function (item) {
    return item && typeof item.id === 'string'
  }).map(function (item) {
    return {
      id: item.id,
      sectionId: knownSections.has(item.sectionId) ? item.sectionId : sections[0].id,
      html: typeof item.html === 'string' ? item.html : '',
      text: typeof item.text === 'string' ? item.text : '',
      title: typeof item.title === 'string' ? item.title : '',
      kind: typeof item.kind === 'string' ? item.kind : 'text',
      source: item.source && typeof item.source === 'object'
        ? { sessionId: item.source.sessionId || null, sessionTitle: item.source.sessionTitle || '' }
        : null,
      origin: normalizeOrigin(item.origin),
      createdAt: Number(item.createdAt) || Date.now(),
      updatedAt: Number(item.updatedAt) || Number(item.createdAt) || Date.now(),
      pinned: item.pinned === true,
      deletedAt: Number(item.deletedAt) || null,
      priority: DSN.PRIORITY_RANK[item.priority] === undefined ? DSN.DEFAULT_PRIORITY : item.priority,
      tasks: normalizeTaskList(item.tasks),
      comments: normalizeCommentList(item.comments),
    }
  }) : []

  var ui = Object.assign({}, base.ui, raw.ui && typeof raw.ui === 'object' ? raw.ui : {})
  if (!knownSections.has(ui.activeSectionId)) ui.activeSectionId = sections[0].id
  if (ui.view !== 'trash' && ui.view !== 'tasks') ui.view = 'board'
  ui.sort = ui.sort === 'priority' ? 'priority' : 'time'
  ui.priorityFilter = DSN.PRIORITY_RANK[ui.priorityFilter] === undefined ? 'all' : ui.priorityFilter
  ui.hideDone = ui.hideDone === true
  ui.detailNoteId = typeof ui.detailNoteId === 'string' && ui.detailNoteId ? ui.detailNoteId : null
  var panel = ui.panel
  ui.panel = panel && typeof panel === 'object'
    && isFinite(panel.x) && isFinite(panel.y) && isFinite(panel.w) && isFinite(panel.h)
    ? { x: Number(panel.x), y: Number(panel.y), w: Number(panel.w), h: Number(panel.h) }
    : null
  ui.search = typeof ui.search === 'string' ? ui.search : ''
  ui.seen = ui.seen === true
  ui.floaters = DSN.normalizeFloaters(ui.floaters)
  return { version: 1, sections: sections, notes: notes, ui: ui }
}

/** Keep only well-formed detached windows: one per note, clamped geometry. */
DSN.normalizeFloaters = function (raw) {
  var list = Array.isArray(raw) ? raw : []
  var seen = {}
  var out = []
  for (var i = 0; i < list.length; i += 1) {
    var item = list[i]
    if (!item || typeof item.noteId !== 'string' || !item.noteId) continue
    if (seen[item.noteId]) continue
    if (!isFinite(item.x) || !isFinite(item.y)) continue
    seen[item.noteId] = true
    out.push({
      noteId: item.noteId,
      x: Math.round(Number(item.x)),
      y: Math.round(Number(item.y)),
      w: DSN.clamp(Math.round(Number(item.w)) || DSN.FLOAT_W, DSN.FLOAT_MIN_W, DSN.FLOAT_MAX_W),
      h: DSN.clamp(Math.round(Number(item.h)) || DSN.FLOAT_H, DSN.FLOAT_MIN_H, DSN.FLOAT_MAX_H),
      z: Math.round(Number(item.z)) || 1,
      collapsed: item.collapsed === true,
    })
    if (out.length >= DSN.MAX_FLOATERS) break
  }
  return out
}

/**
 * Create the notes store.
 * @param {{ t?: Function, storage?: Storage|null, key?: string }} options
 */
DSN.createStore = function (options) {
  var config = options || {}
  var t = typeof config.t === 'function' ? config.t : DSN.fallbackT
  var key = config.key || DSN.STORAGE_KEY
  var storage = config.storage === undefined
    ? (function () { try { return window.localStorage } catch (error) { return null } })()
    : config.storage

  var listeners = new Set()
  var state = null
  var saveTimer = null
  var lastWrite = 0
  var channel = null
  var disposed = false

  function notify() {
    listeners.forEach(function (fn) {
      try { fn(state) } catch (error) { DSN.log('store listener failed', error) }
    })
  }

  function readStored() {
    if (!storage) return null
    try {
      var raw = storage.getItem(key)
      if (!raw) return null
      return DSN.normalizeState(JSON.parse(raw), t)
    } catch (error) {
      DSN.log('stored notes unreadable', error)
      return null
    }
  }

  function writeStored() {
    if (!storage) return false
    try {
      storage.setItem(key, JSON.stringify(state))
      lastWrite = Date.now()
      return true
    } catch (error) {
      DSN.log('stored notes write failed', error)
      DSN.toast(t('status.storageFull'), 'error')
      return false
    }
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(function () { saveTimer = null; writeStored() }, 250)
  }

  function scheduleBroadcast() {
    if (!channel) return
    try { channel.postMessage({ type: 'state', at: Date.now(), state: state }) } catch (error) {
      DSN.log('broadcast failed', error)
    }
  }

  function commit(next, options) {
    if (disposed) return
    if (!next || next === state) return
    state = next
    notify()
    var flags = options || {}
    if (flags.persist !== false) scheduleSave()
    if (flags.broadcast !== false) scheduleBroadcast()
  }

  function update(mutator) {
    var next = mutator(state)
    if (next !== state) commit(next)
    return next
  }

  function withNotes(mapFn) {
    return update(function (current) {
      return Object.assign({}, current, { notes: current.notes.map(mapFn) })
    })
  }

  /* ------------------------------ actions ---------------------------- */

  var actions = {
    setOpen: function (open) {
      update(function (current) {
        return Object.assign({}, current, { ui: Object.assign({}, current.ui, { open: open === true, seen: true }) })
      })
    },
    toggleOpen: function () {
      update(function (current) {
        return Object.assign({}, current, { ui: Object.assign({}, current.ui, { open: !current.ui.open, seen: true }) })
      })
    },
    setCollapsed: function (collapsed) {
      update(function (current) {
        return Object.assign({}, current, { ui: Object.assign({}, current.ui, { collapsed: collapsed === true }) })
      })
    },
    setPanelRect: function (rect) {
      update(function (current) {
        return Object.assign({}, current, {
          ui: Object.assign({}, current.ui, {
            panel: rect
              ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) }
              : null,
          }),
        })
      })
    },
    setActiveSection: function (sectionId) {
      update(function (current) {
        return Object.assign({}, current, {
          ui: Object.assign({}, current.ui, { activeSectionId: sectionId, view: 'board' }),
        })
      })
    },
    setView: function (view) {
      var next = view === 'trash' || view === 'tasks' ? view : 'board'
      update(function (current) {
        return Object.assign({}, current, { ui: Object.assign({}, current.ui, { view: next }) })
      })
    },
    setSearch: function (query) {
      update(function (current) {
        return Object.assign({}, current, { ui: Object.assign({}, current.ui, { search: String(query || '') }) })
      })
    },
    /** Ordering of the visible notes: the historical time order, or by priority. */
    setSort: function (sort) {
      var next = sort === 'priority' ? 'priority' : 'time'
      update(function (current) {
        if (current.ui.sort === next) return current
        return Object.assign({}, current, { ui: Object.assign({}, current.ui, { sort: next }) })
      })
    },
    /** `'all'` or one of DSN.PRIORITIES. */
    setPriorityFilter: function (priority) {
      var next = DSN.PRIORITY_RANK[priority] === undefined ? 'all' : priority
      update(function (current) {
        if (current.ui.priorityFilter === next) return current
        return Object.assign({}, current, { ui: Object.assign({}, current.ui, { priorityFilter: next }) })
      })
    },
    setHideDone: function (hide) {
      update(function (current) {
        var next = hide === true
        if (current.ui.hideDone === next) return current
        return Object.assign({}, current, { ui: Object.assign({}, current.ui, { hideDone: next }) })
      })
    },
    toggleHideDone: function () {
      update(function (current) {
        return Object.assign({}, current, { ui: Object.assign({}, current.ui, { hideDone: !current.ui.hideDone }) })
      })
    },
    /** Which note is open in the detail/comment sheet, or null. */
    setDetail: function (noteId) {
      var next = typeof noteId === 'string' && noteId ? noteId : null
      update(function (current) {
        if (current.ui.detailNoteId === next) return current
        return Object.assign({}, current, { ui: Object.assign({}, current.ui, { detailNoteId: next }) })
      })
    },
    /* -------------------- detached note windows ---------------------- */
    /** Open a floating window for `noteId` (or raise it when already open). */
    addFloater: function (noteId, rect) {
      var id = String(noteId || '')
      if (!id) return null
      update(function (current) {
        var floaters = current.ui.floaters || []
        var topZ = 1
        for (var i = 0; i < floaters.length; i += 1) topZ = Math.max(topZ, floaters[i].z || 1)
        var existing = -1
        for (var j = 0; j < floaters.length; j += 1) if (floaters[j].noteId === id) existing = j
        if (existing >= 0) {
          return Object.assign({}, current, {
            ui: Object.assign({}, current.ui, {
              floaters: floaters.map(function (item) {
                return item.noteId === id ? Object.assign({}, item, { z: topZ + 1, collapsed: false }) : item
              }),
            }),
          })
        }
        var next = floaters.slice()
        if (next.length >= DSN.MAX_FLOATERS) {
          var lowest = 0
          for (var k = 1; k < next.length; k += 1) if ((next[k].z || 1) < (next[lowest].z || 1)) lowest = k
          next.splice(lowest, 1)
        }
        var box = rect || {}
        next.push({
          noteId: id,
          x: Math.round(Number(box.x) || 0),
          y: Math.round(Number(box.y) || 0),
          w: DSN.clamp(Math.round(Number(box.w)) || DSN.FLOAT_W, DSN.FLOAT_MIN_W, DSN.FLOAT_MAX_W),
          h: DSN.clamp(Math.round(Number(box.h)) || DSN.FLOAT_H, DSN.FLOAT_MIN_H, DSN.FLOAT_MAX_H),
          z: topZ + 1,
          collapsed: false,
        })
        return Object.assign({}, current, { ui: Object.assign({}, current.ui, { floaters: next }) })
      })
      return id
    },
    moveFloater: function (noteId, x, y) {
      update(function (current) {
        return Object.assign({}, current, {
          ui: Object.assign({}, current.ui, {
            floaters: (current.ui.floaters || []).map(function (item) {
              return item.noteId === noteId
                ? Object.assign({}, item, { x: Math.round(Number(x) || 0), y: Math.round(Number(y) || 0) })
                : item
            }),
          }),
        })
      })
    },
    resizeFloater: function (noteId, w, h) {
      update(function (current) {
        return Object.assign({}, current, {
          ui: Object.assign({}, current.ui, {
            floaters: (current.ui.floaters || []).map(function (item) {
              return item.noteId === noteId
                ? Object.assign({}, item, {
                  w: DSN.clamp(Math.round(Number(w)) || DSN.FLOAT_W, DSN.FLOAT_MIN_W, DSN.FLOAT_MAX_W),
                  h: DSN.clamp(Math.round(Number(h)) || DSN.FLOAT_H, DSN.FLOAT_MIN_H, DSN.FLOAT_MAX_H),
                })
                : item
            }),
          }),
        })
      })
    },
    raiseFloater: function (noteId) {
      update(function (current) {
        var floaters = current.ui.floaters || []
        var topZ = 0
        for (var i = 0; i < floaters.length; i += 1) topZ = Math.max(topZ, floaters[i].z || 1)
        var currentEntry = null
        for (var j = 0; j < floaters.length; j += 1) if (floaters[j].noteId === noteId) currentEntry = floaters[j]
        if (!currentEntry || currentEntry.z === topZ) return current
        return Object.assign({}, current, {
          ui: Object.assign({}, current.ui, {
            floaters: floaters.map(function (item) {
              return item.noteId === noteId ? Object.assign({}, item, { z: topZ + 1 }) : item
            }),
          }),
        })
      })
    },
    removeFloater: function (noteId) {
      update(function (current) {
        var floaters = current.ui.floaters || []
        if (!floaters.some(function (item) { return item.noteId === noteId })) return current
        return Object.assign({}, current, {
          ui: Object.assign({}, current.ui, {
            floaters: floaters.filter(function (item) { return item.noteId !== noteId }),
          }),
        })
      })
    },
    setFloaterCollapsed: function (noteId, collapsed) {
      update(function (current) {
        return Object.assign({}, current, {
          ui: Object.assign({}, current.ui, {
            floaters: (current.ui.floaters || []).map(function (item) {
              return item.noteId === noteId ? Object.assign({}, item, { collapsed: collapsed === true }) : item
            }),
          }),
        })
      })
    },
    closeAllFloaters: function () {
      update(function (current) {
        if (!(current.ui.floaters || []).length) return current
        return Object.assign({}, current, { ui: Object.assign({}, current.ui, { floaters: [] }) })
      })
    },
    addNote: function (payload) {
      var input = payload || {}
      var sectionId = input.sectionId || state.ui.activeSectionId || state.sections[0].id
      if (!state.sections.some(function (item) { return item.id === sectionId })) sectionId = state.sections[0].id
      var now = Date.now()
      var html = String(input.html || '')
      if (html.length > DSN.MAX_HTML) html = html.slice(0, DSN.MAX_HTML)
      var text = String(input.text || '')
      var note = {
        id: input.id || DSN.uid('note'),
        sectionId: sectionId,
        html: html,
        text: text || DSN.htmlToText(html),
        title: String(input.title || ''),
        kind: input.kind || DSN.detectKind(html, text),
        source: input.source || null,
        origin: normalizeOrigin(input.origin),
        createdAt: now,
        updatedAt: now,
        pinned: input.pinned === true,
        deletedAt: null,
        priority: DSN.PRIORITY_RANK[input.priority] === undefined ? DSN.DEFAULT_PRIORITY : input.priority,
        tasks: normalizeTaskList(input.tasks),
        comments: normalizeCommentList(input.comments),
      }
      var notes = state.notes.slice()
      if (notes.length >= DSN.MAX_NOTES) {
        var oldest = null
        for (var i = notes.length - 1; i >= 0; i--) {
          if (notes[i].deletedAt) { oldest = i; break }
        }
        if (oldest === null) oldest = notes.length - 1
        notes.splice(oldest, 1)
      }
      notes.unshift(note)
      commit(Object.assign({}, state, { notes: notes }))
      return note.id
    },
    updateNote: function (noteId, patch) {
      var input = patch || {}
      withNotes(function (note) {
        if (note.id !== noteId) return note
        var next = Object.assign({}, note, input, { updatedAt: Date.now() })
        if (typeof input.html === 'string') {
          next.html = input.html.slice(0, DSN.MAX_HTML)
          if (input.text === undefined) next.text = DSN.htmlToText(next.html)
        }
        if (input.text !== undefined) next.text = String(input.text)
        return next
      })
    },
    deleteNote: function (noteId) {
      // Deleting closes the detached window first — a floating window must never
      // outlive (or show) a note that moved to the trash.
      update(function (current) {
        return Object.assign({}, current, {
          notes: current.notes.map(function (note) {
            return note.id === noteId ? Object.assign({}, note, { deletedAt: Date.now(), pinned: false }) : note
          }),
          ui: Object.assign({}, current.ui, {
            floaters: (current.ui.floaters || []).filter(function (item) { return item.noteId !== noteId }),
          }),
        })
      })
    },
    restoreNote: function (noteId) {
      withNotes(function (note) {
        if (note.id !== noteId) return note
        return Object.assign({}, note, { deletedAt: null })
      })
    },
    purgeNote: function (noteId) {
      update(function (current) {
        return Object.assign({}, current, {
          notes: current.notes.filter(function (note) { return note.id !== noteId }),
          ui: Object.assign({}, current.ui, {
            floaters: (current.ui.floaters || []).filter(function (item) { return item.noteId !== noteId }),
          }),
        })
      })
    },
    emptyTrash: function () {
      update(function (current) {
        var keep = current.notes.filter(function (note) { return !note.deletedAt })
        var alive = {}
        for (var i = 0; i < keep.length; i += 1) alive[keep[i].id] = true
        return Object.assign({}, current, {
          notes: keep,
          ui: Object.assign({}, current.ui, {
            floaters: (current.ui.floaters || []).filter(function (item) { return alive[item.noteId] }),
          }),
        })
      })
    },
    setPinned: function (noteId, pinned) {
      withNotes(function (note) {
        if (note.id !== noteId) return note
        return Object.assign({}, note, { pinned: pinned === true })
      })
    },
    togglePin: function (noteId) {
      withNotes(function (note) {
        if (note.id !== noteId) return note
        return Object.assign({}, note, { pinned: !note.pinned })
      })
    },
    /* -------------------- priority ---------------------- */
    /** `'low' | 'normal' | 'high' | 'urgent'`; anything else falls back to normal. */
    setPriority: function (noteId, priority) {
      var next = DSN.PRIORITY_RANK[priority] === undefined ? DSN.DEFAULT_PRIORITY : priority
      withNotes(function (note) {
        if (note.id !== noteId || note.priority === next) return note
        return Object.assign({}, note, { priority: next, updatedAt: Date.now() })
      })
    },
    /* -------------------- checklist --------------------- */
    addTask: function (noteId, text) {
      var value = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, DSN.MAX_TASK_TEXT)
      if (!value) return null
      var taskId = null
      withNotes(function (note) {
        if (note.id !== noteId) return note
        var tasks = (note.tasks || []).slice()
        if (tasks.length >= DSN.MAX_TASKS) return note
        taskId = DSN.uid('task')
        tasks.push({ id: taskId, text: value, done: false })
        return Object.assign({}, note, { tasks: tasks, updatedAt: Date.now() })
      })
      return taskId
    },
    setTaskText: function (noteId, taskId, text) {
      var value = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, DSN.MAX_TASK_TEXT)
      if (!value) return
      withNotes(function (note) {
        if (note.id !== noteId) return note
        var found = false
        var tasks = (note.tasks || []).map(function (task) {
          if (task.id !== taskId || task.text === value) return task
          found = true
          return Object.assign({}, task, { text: value })
        })
        return found ? Object.assign({}, note, { tasks: tasks, updatedAt: Date.now() }) : note
      })
    },
    toggleTask: function (noteId, taskId) {
      withNotes(function (note) {
        if (note.id !== noteId) return note
        var found = false
        var tasks = (note.tasks || []).map(function (task) {
          if (task.id !== taskId) return task
          found = true
          return Object.assign({}, task, { done: !task.done })
        })
        return found ? Object.assign({}, note, { tasks: tasks, updatedAt: Date.now() }) : note
      })
    },
    removeTask: function (noteId, taskId) {
      withNotes(function (note) {
        if (note.id !== noteId) return note
        var tasks = (note.tasks || []).filter(function (task) { return task.id !== taskId })
        if (tasks.length === (note.tasks || []).length) return note
        return Object.assign({}, note, { tasks: tasks, updatedAt: Date.now() })
      })
    },
    /** Drop every finished item so a long checklist can be reset in one click. */
    clearDoneTasks: function (noteId) {
      withNotes(function (note) {
        if (note.id !== noteId) return note
        var tasks = (note.tasks || []).filter(function (task) { return !task.done })
        if (tasks.length === (note.tasks || []).length) return note
        return Object.assign({}, note, { tasks: tasks, updatedAt: Date.now() })
      })
    },
    /* -------------------- comments ---------------------- */
    addComment: function (noteId, html, text) {
      var raw = typeof html === 'string' ? html : ''
      var safe = ''
      try {
        safe = typeof DSN.sanitizeHtml === 'function' ? DSN.sanitizeHtml(raw) : raw
      } catch (error) {
        DSN.log('comment sanitize failed', error)
        safe = ''
      }
      var plain = typeof text === 'string' && text
        ? text
        : (typeof DSN.htmlToText === 'function' ? DSN.htmlToText(safe) : '')
      plain = String(plain || '').trim()
      var body = safe.length > DSN.MAX_COMMENT_HTML ? safe.slice(0, DSN.MAX_COMMENT_HTML) : safe
      if (typeof DSN.htmlToText === 'function' && !DSN.htmlToText(body).trim()) return null
      var commentId = null
      withNotes(function (note) {
        if (note.id !== noteId) return note
        var comments = (note.comments || []).slice()
        if (comments.length >= DSN.MAX_COMMENTS) return note
        commentId = DSN.uid('cmt')
        comments.push({ id: commentId, html: body, text: plain, createdAt: Date.now() })
        return Object.assign({}, note, { comments: comments, updatedAt: Date.now() })
      })
      return commentId
    },
    removeComment: function (noteId, commentId) {
      withNotes(function (note) {
        if (note.id !== noteId) return note
        var comments = (note.comments || []).filter(function (item) { return item.id !== commentId })
        if (comments.length === (note.comments || []).length) return note
        return Object.assign({}, note, { comments: comments, updatedAt: Date.now() })
      })
    },
    /** Move a note into `sectionId`, placing it before `beforeId` when given. */
    moveNote: function (noteId, sectionId, beforeId) {
      update(function (current) {
        var index = current.notes.findIndex(function (note) { return note.id === noteId })
        if (index < 0) return current
        var target = current.sections.some(function (item) { return item.id === sectionId })
          ? sectionId
          : current.notes[index].sectionId
        var notes = current.notes.slice()
        var moved = Object.assign({}, notes[index], {
          sectionId: target,
          pinned: beforeId === null ? notes[index].pinned : notes[index].pinned,
          updatedAt: Date.now(),
        })
        notes.splice(index, 1)
        var insertAt = beforeId ? notes.findIndex(function (note) { return note.id === beforeId }) : -1
        if (insertAt < 0) {
          var lastInSection = -1
          for (var i = 0; i < notes.length; i++) if (notes[i].sectionId === target) lastInSection = i
          insertAt = lastInSection + 1 || 0
          if (insertAt === 0) {
            // empty target section: insert after the last note of the preceding sections
            insertAt = 0
          }
        }
        notes.splice(insertAt, 0, moved)
        return Object.assign({}, current, { notes: notes })
      })
    },
    addSection: function (name) {
      var id = DSN.uid('sec')
      update(function (current) {
        var order = current.sections.reduce(function (max, item) { return Math.max(max, item.order + 1) }, 0)
        return Object.assign({}, current, {
          sections: current.sections.concat([{
            id: id,
            name: String(name || '').trim() || t('section.inbox'),
            order: order,
          }]),
          ui: Object.assign({}, current.ui, { activeSectionId: id, view: 'board' }),
        })
      })
      return id
    },
    renameSection: function (sectionId, name) {
      update(function (current) {
        return Object.assign({}, current, {
          sections: current.sections.map(function (item) {
            return item.id === sectionId ? Object.assign({}, item, { name: String(name || '').trim() || item.name }) : item
          }),
        })
      })
    },
    deleteSection: function (sectionId) {
      update(function (current) {
        if (current.sections.length <= 1) return current
        var sections = current.sections.filter(function (item) { return item.id !== sectionId })
        var fallback = sections[0].id
        return Object.assign({}, current, {
          sections: sections,
          notes: current.notes.map(function (note) {
            return note.sectionId === sectionId ? Object.assign({}, note, { sectionId: fallback }) : note
          }),
          ui: Object.assign({}, current.ui, {
            activeSectionId: current.ui.activeSectionId === sectionId ? fallback : current.ui.activeSectionId,
          }),
        })
      })
    },
    importState: function (raw) {
      var next = DSN.normalizeState(raw, t)
      commit(next)
      return next
    },
    replaceState: function (raw) {
      commit(DSN.normalizeState(raw, t))
    },
  }

  /* --------------------------- init and sync ------------------------- */

  state = readStored() || DSN.emptyState(t)

  try {
    if (typeof window !== 'undefined' && typeof window.BroadcastChannel === 'function') {
      channel = new window.BroadcastChannel(DSN.CHANNEL_NAME)
      channel.onmessage = function (event) {
        var data = event && event.data
        if (!data || data.type !== 'state' || !data.state) return
        if (data.origin === DSN.storeId) return
        // Last writer wins; adopting never echoes back.
        state = DSN.normalizeState(data.state, t)
        notify()
      }
    }
  } catch (error) {
    DSN.log('BroadcastChannel unavailable', error)
    channel = null
  }

  // A second tab may also write localStorage without a channel delivery.
  var onStorage = function (event) {
    if (!event || event.key !== key || !event.newValue) return
    try {
      state = DSN.normalizeState(JSON.parse(event.newValue), t)
      notify()
    } catch (error) { DSN.log('storage event unreadable', error) }
  }
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)

  var wrappedActions = {}
  // High-frequency, purely local geometry: persisted, but not broadcast (other
  // windows keep their own copy until the next meaningful change).
  var QUIET = { setSearch: 1, setPanelRect: 1, moveFloater: 1, resizeFloater: 1, raiseFloater: 1 }
  Object.keys(actions).forEach(function (name) {
    wrappedActions[name] = function () {
      var result = actions[name].apply(null, arguments)
      if (channel && !QUIET[name]) {
        try { channel.postMessage({ type: 'state', origin: DSN.storeId, state: state }) } catch (error) { /* ignore */ }
      }
      return result
    }
  })

  return {
    getSnapshot: function () { return state },
    subscribe: function (fn) {
      listeners.add(fn)
      return function () { listeners.delete(fn) }
    },
    actions: wrappedActions,
    flush: function () {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
      return writeStored()
    },
    getLastWrite: function () { return lastWrite },
    dispose: function () {
      disposed = true
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = null
      listeners.clear()
      if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
      if (channel) {
        try { channel.close() } catch (error) { /* ignore */ }
        channel = null
      }
    },
  }
}

DSN.storeId = DSN.uid('store')

/* ================= 25-sync.js ================= */
/* ------------------------------------------------------------------ *
 * Durable storage: mirror the board to the Host-owned JSON file behind
 * `/dsh-sticky-board/data`, so notes survive a cleared browser profile and
 * reach every window that opens the same Harness.
 *
 * localStorage stays the fast, synchronous copy; this layer only adds a
 * debounced push and a boot-time merge. When the Host half is missing (or the
 * page is not served over HTTP) the board keeps working browser-locally and
 * the footer says so.
 * ------------------------------------------------------------------ */

;(function () {
  'use strict'

  var ENDPOINT = '/dsh-sticky-board/data'
  var PUSH_DELAY = 700

  /* ------------------------------ status ---------------------------- */

  var statusValue = { state: 'idle', savedAt: 0, file: '', message: '' }
  var statusListeners = []

  /**
   * Publish a partial status update.
   * @param patch - fields to replace.
   */
  function emitStatus(patch) {
    var next = Object.assign({}, statusValue, patch)
    if (next.state === statusValue.state && next.savedAt === statusValue.savedAt
      && next.file === statusValue.file && next.message === statusValue.message) return
    statusValue = next
    for (var i = 0; i < statusListeners.length; i += 1) {
      try { statusListeners[i](statusValue) } catch (error) { DSN.log('sync listener failed', error) }
    }
  }

  DSN.syncStatus = {
    getSnapshot: function () { return statusValue },
    subscribe: function (listener) {
      statusListeners.push(listener)
      return function () {
        var index = statusListeners.indexOf(listener)
        if (index >= 0) statusListeners.splice(index, 1)
      }
    },
  }

  /* ------------------------------ helpers --------------------------- */

  /**
   * Whether this page can talk to the Host route at all.
   * @returns a boolean.
   */
  function canReachHost() {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return false
    var location = window.location
    if (!location) return false
    return location.protocol === 'http:' || location.protocol === 'https:'
  }

  /**
   * Numeric ordering stamp of one note, used to resolve merge conflicts.
   * @param note - the note.
   * @returns the stamp.
   */
  function noteStamp(note) {
    var updated = Number(note && note.updatedAt)
    if (isFinite(updated) && updated > 0) return updated
    var created = Number(note && note.createdAt)
    if (isFinite(created) && created > 0) return created
    return 0
  }

  /**
   * Union two lists of `{ id }` entries, keeping the local copy of a duplicate.
   * @param mine - local entries.
   * @param theirs - remote entries.
   * @returns the union, local order first.
   */
  function unionById(mine, theirs) {
    var out = Array.isArray(mine) ? mine.slice() : []
    var known = {}
    for (var i = 0; i < out.length; i += 1) known[out[i].id] = true
    var extra = Array.isArray(theirs) ? theirs : []
    for (var j = 0; j < extra.length; j += 1) {
      if (known[extra[j].id]) continue
      known[extra[j].id] = true
      out.push(extra[j])
    }
    return out
  }

  /**
   * Merge one note that both sides hold: the newer stamp owns the text and the
   * flags, but checklists and comments are unions — those are the two places
   * where two machines legitimately add different items to the same note.
   * @param current - the local note.
   * @param candidate - the stored note.
   * @returns the merged note.
   */
  function mergeNote(current, candidate) {
    var newer = noteStamp(candidate) > noteStamp(current) ? candidate : current
    var older = newer === candidate ? current : candidate
    var merged = Object.assign({}, newer)
    merged.tasks = unionById(newer.tasks, older.tasks)
    var comments = unionById(newer.comments, older.comments)
    comments.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0) })
    merged.comments = comments
    return merged
  }

  /**
   * Union two board documents: sections by id, notes by id (newer stamp wins).
   * The local document owns the UI state, because it describes this window.
   * @param local - this window's document.
   * @param remote - the stored document.
   * @param t - translate function for normalization.
   * @returns the merged document.
   */
  DSN.mergeStates = function (local, remote, t) {
    var mine = DSN.normalizeState(local, t)
    var theirs = DSN.normalizeState(remote, t)

    var sections = mine.sections.slice()
    var knownSections = {}
    for (var s = 0; s < sections.length; s += 1) knownSections[sections[s].id] = true
    for (var r = 0; r < theirs.sections.length; r += 1) {
      var section = theirs.sections[r]
      if (knownSections[section.id]) continue
      knownSections[section.id] = true
      sections.push(section)
    }

    var notes = mine.notes.slice()
    var byId = {}
    for (var n = 0; n < notes.length; n += 1) byId[notes[n].id] = n
    for (var k = 0; k < theirs.notes.length; k += 1) {
      var candidate = theirs.notes[k]
      var index = byId[candidate.id]
      if (index === undefined) {
        byId[candidate.id] = notes.length
        notes.push(candidate)
        continue
      }
      var current = notes[index]
      // The newer edit wins; a delete is an edit, so a later delete also wins.
      notes[index] = mergeNote(current, candidate)
    }

    notes.sort(function (a, b) {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
      return noteStamp(b) - noteStamp(a)
    })

    var ui = Object.assign({}, mine.ui)
    var activeExists = false
    for (var a = 0; a < sections.length; a += 1) {
      if (sections[a].id === ui.activeSectionId) { activeExists = true; break }
    }
    if (!activeExists) ui.activeSectionId = sections[0].id

    return { version: 1, sections: sections, notes: notes, ui: ui }
  }

  /* ------------------------------- install -------------------------- */

  /**
   * Wire one store to the Host document route.
   * @param options - `{ store, t, endpoint }`.
   * @returns the disposer.
   */
  DSN.installSync = function (options) {
    var opts = options || {}
    var store = opts.store
    var t = typeof opts.t === 'function' ? opts.t : DSN.fallbackT
    var endpoint = typeof opts.endpoint === 'string' && opts.endpoint ? opts.endpoint : ENDPOINT

    if (!store || typeof store.subscribe !== 'function') return function () {}

    var disposed = false
    var applyingRemote = false
    var pushTimer = null
    var pushing = false
    var dirty = false
    var loaded = false

    /**
     * Push the current document to the Host.
     * @param keepalive - true when the page may be unloading.
     * @returns nothing; completion updates the status.
     */
    function push(keepalive) {
      if (disposed || !canReachHost()) return
      if (pushing && !keepalive) { dirty = true; return }
      pushing = true
      dirty = false
      var body = ''
      try {
        body = JSON.stringify({
          savedAt: Date.now(),
          savedBy: (typeof navigator !== 'undefined' && navigator && navigator.userAgent) || '',
          state: store.getSnapshot(),
        })
      } catch (error) {
        pushing = false
        emitStatus({ state: 'error', message: String(error && error.message || error) })
        return
      }
      emitStatus({ state: 'saving' })
      window.fetch(endpoint, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: body,
        cache: 'no-store',
        credentials: 'same-origin',
        keepalive: keepalive === true,
      }).then(function (response) {
        if (!response.ok) throw new Error('http ' + response.status)
        return response.json().catch(function () { return null })
      }).then(function (payload) {
        pushing = false
        if (disposed) return
        emitStatus({
          state: 'saved',
          savedAt: (payload && Number(payload.savedAt)) || Date.now(),
          message: '',
        })
        if (dirty) schedule()
      }).catch(function (error) {
        pushing = false
        if (disposed) return
        emitStatus({ state: 'error', message: String(error && error.message || error) })
      })
    }

    /** Queue a debounced push. */
    function schedule() {
      if (disposed) return
      if (pushTimer) clearTimeout(pushTimer)
      pushTimer = setTimeout(function () {
        pushTimer = null
        push(false)
      }, PUSH_DELAY)
    }

    /** Adopt the Host document, merging it into what this window already has. */
    function boot() {
      if (disposed) return
      if (!canReachHost()) {
        emitStatus({ state: 'local' })
        return
      }
      emitStatus({ state: 'loading' })
      window.fetch(endpoint, {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        credentials: 'same-origin',
      }).then(function (response) {
        if (!response.ok) throw new Error('http ' + response.status)
        return response.json()
      }).then(function (payload) {
        if (disposed) return
        loaded = true
        if (!payload || payload.ok !== true) {
          emitStatus({ state: 'error', message: 'unexpected-payload' })
          return
        }
        emitStatus({ state: 'saved', file: typeof payload.file === 'string' ? payload.file : '' })
        if (!payload.state) {
          // First run for this profile: seed the file from the browser copy.
          push(false)
          return
        }
        var local = store.getSnapshot()
        var merged = DSN.mergeStates(local, payload.state, t)
        var changed = false
        try {
          changed = JSON.stringify(merged) !== JSON.stringify(local)
        } catch (error) { changed = true }
        if (!changed) return
        applyingRemote = true
        try {
          store.actions.replaceState(merged)
        } catch (error) {
          DSN.log('sync merge apply failed', error)
        } finally {
          applyingRemote = false
        }
        push(false)
      }).catch(function (error) {
        if (disposed) return
        emitStatus({ state: 'local', message: String(error && error.message || error) })
      })
    }

    var unsubscribe = store.subscribe(function () {
      if (disposed || applyingRemote) return
      schedule()
    })

    /**
     * Flush pending work when the page goes away.
     * @returns nothing.
     */
    function flushNow() {
      if (pushTimer) { clearTimeout(pushTimer); pushTimer = null }
      if (!loaded) return
      push(true)
    }

    var onHide = function () {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flushNow()
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', flushNow)
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onHide)
    }

    boot()

    // The Host can be missing a route at boot (old host half, restarted server,
    // reloaded plugin). A retry re-runs the discovery step, so the pill can
    // recover without reloading the page.
    DSN.syncStatus.retry = function () {
      if (disposed) return
      boot()
    }

    return function dispose() {
      disposed = true
      DSN.syncStatus.retry = null
      if (pushTimer) clearTimeout(pushTimer)
      pushTimer = null
      try { unsubscribe() } catch (error) { /* ignore */ }
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', flushNow)
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onHide)
      }
    }
  }

  /* ---------------------------- footer widget ----------------------- */

  /**
   * Reactive sync state for React components.
   * @returns the current status object.
   */
  DSN.useSyncStatus = function () {
    var React = DSN.React
    if (!React || typeof React.useSyncExternalStore !== 'function') return statusValue
    return React.useSyncExternalStore(DSN.syncStatus.subscribe, DSN.syncStatus.getSnapshot)
  }

  /**
   * Small status pill: durable-storage state with the file path on hover.
   * Click forces a save now, which is the retry path after a failure.
   * @param props - `{ t }`.
   * @returns the element.
   */
  DSN.SyncStatus = function SyncStatus(props) {
    var p = props || {}
    var t = typeof p.t === 'function' ? p.t : DSN.fallbackT
    var status = DSN.useSyncStatus()
    var state = status.state || 'idle'
    var label = t('sync.' + state, { n: 0 })
    if (typeof label !== 'string' || label.indexOf('sync.') === 0) label = t('sync.saved')
    var title = status.file ? status.file : t('sync.title')
    if (state === 'loading') title = t('sync.loading')
    return DSN.h('button', {
      type: 'button',
      className: 'dsn-sync dsn-sync--' + state,
      title: title,
      'aria-label': title,
      onClick: function (event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault()
        try {
          if (DSN.store && typeof DSN.store.flush === 'function') DSN.store.flush()
        } catch (error) { DSN.log('sync flush failed', error) }
        var retry = DSN.syncStatus && typeof DSN.syncStatus.retry === 'function' ? DSN.syncStatus.retry : null
        if (retry && (state === 'local' || state === 'error')) retry()
      },
    },
      DSN.h('i', { className: 'dsn-sync-dot', 'aria-hidden': 'true' }),
      DSN.h('span', { className: 'dsn-sync-label' }, label),
    )
  }
})()

/* ================= 30-content.js ================= */
/* ------------------------------------------------------------------ *
 * Rich content engine.
 *
 *  - DSN.htmlToText / DSN.textToHtml       HTML <-> plain text
 *  - DSN.detectKind                        'text' | 'table' | 'image' |
 *                                          'code' | 'mixed' | 'link'
 *  - DSN.sanitizeHtml                      the only allowlist sanitizer;
 *                                          every dangerous innerHTML path
 *                                          in this bundle goes through it
 *  - DSN.Content                           read-only rich renderer
 *  - DSN.Editor                            contentEditable rich editor
 *  - DSN.dragHasContent/DSN.readDragContent  HTML5 drag payload reader
 *
 * The parser used below is an inert DOMParser('text/html') document: it
 * never executes scripts and never loads images/iframes.
 * ------------------------------------------------------------------ */

DSN.addStrings({
  'content.editorLabel': '便签编辑器',
  'content.imageAlt': '图片',
}, {
  'content.editorLabel': 'Note editor',
  'content.imageAlt': 'Image',
})

/* ------------------------- sanitizer tables ------------------------ */

var CONTENT_ALLOWED_TAGS = {
  a: true, b: true, blockquote: true, br: true, caption: true,
  code: true, col: true, colgroup: true, del: true, div: true,
  em: true, h1: true, h2: true, h3: true, h4: true, h5: true, h6: true,
  hr: true, i: true, img: true, ins: true, kbd: true, li: true,
  mark: true, ol: true, p: true, pre: true, s: true, span: true,
  strong: true, sub: true, sup: true, table: true, tbody: true,
  td: true, tfoot: true, th: true, thead: true, tr: true, u: true,
  ul: true,
}

// Elements emitted as one tag with no closing counterpart.
var CONTENT_VOID_TAGS = { br: true, col: true, hr: true, img: true }

// Elements dropped together with their subtree: script/style/iframe and
// friends can load or execute resources, SVG/MathML can smuggle script
// through foreign content, and form controls carry no useful rich content.
var CONTENT_DROP_TAGS = {
  APPLET: true, AREA: true, AUDIO: true, BASE: true, BUTTON: true,
  CANVAS: true, EMBED: true, FRAME: true, FRAMESET: true, IFRAME: true,
  INPUT: true, KEYGEN: true, LINK: true, MAP: true, MATH: true,
  META: true, NOSCRIPT: true, OBJECT: true, OPTGROUP: true, OPTION: true,
  PARAM: true, PLAINTEXT: true, PORTAL: true, SCRIPT: true, SELECT: true,
  SOURCE: true, STYLE: true, SVG: true, TEMPLATE: true, TEXTAREA: true,
  TITLE: true, TRACK: true, VIDEO: true, XMP: true,
}

// Style declarations we keep; colours and everything else are stripped.
var CONTENT_STYLE_PROPS = {
  'font-weight': /^(normal|bold|bolder|lighter|[1-9]00)$/i,
  'font-style': /^(normal|italic|oblique)$/i,
  'text-align': /^(left|right|center|justify|start|end)$/i,
  'text-decoration': /^(none|(underline|overline|line-through)(?:[ \t]+(underline|overline|line-through))*)$/i,
  'text-decoration-line': /^(none|(underline|overline|line-through)(?:[ \t]+(underline|overline|line-through))*)$/i,
}

// Image payload caps shared by the paste and drop paths.
var CONTENT_MAX_IMAGE_BYTES = 8 * 1024 * 1024
var CONTENT_MAX_IMAGES = 4

// Block-ish tags whose direct children are inline text (used by htmlToText).
var CONTENT_TEXT_BLOCK = {
  BLOCKQUOTE: true, DD: true, DIV: true, DT: true, H1: true, H2: true,
  H3: true, H4: true, H5: true, H6: true, LI: true, P: true, PRE: true,
}

var CONTENT_TEXT_SKIP = {
  HEAD: true, IFRAME: true, MATH: true, NOSCRIPT: true, OBJECT: true,
  SCRIPT: true, STYLE: true, SVG: true, TEMPLATE: true, TITLE: true,
}

/* --------------------------- DOM plumbing -------------------------- */

var CONTENT_PARSER = null

function CONTENT_parseDocument(source) {
  if (typeof DOMParser === 'undefined') return null
  if (!CONTENT_PARSER) CONTENT_PARSER = new DOMParser()
  return CONTENT_PARSER.parseFromString(String(source), 'text/html')
}

/** Minimal entity decoder, used only where the DOM parser is unavailable. */
function CONTENT_unescapeHtml(value) {
  var text = String(value == null ? '' : value)
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, function (match, body) {
    var lower = String(body).toLowerCase()
    if (lower.charAt(0) === '#') {
      var code = lower.charAt(1) === 'x' ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10)
      if (isFinite(code) && code >= 0 && code <= 1114111) {
        try {
          return String.fromCodePoint
            ? String.fromCodePoint(code)
            : String.fromCharCode(code)
        } catch (error) {
          return match
        }
      }
      return match
    }
    if (lower === 'amp') return '&'
    if (lower === 'lt') return '<'
    if (lower === 'gt') return '>'
    if (lower === 'quot') return '"'
    if (lower === 'apos') return "'"
    if (lower === 'nbsp') return '\u00a0'
    return match
  })
}

/** Very small tag stripper for the no-DOMParser fallback path. */
function CONTENT_stripTags(source) {
  var text = String(source == null ? '' : source)
  text = text.replace(/<(script|style|noscript|template|svg|math)\b[\s\S]*?<\/\1\s*>/gi, '')
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<\/(p|div|li|tr|h[1-6]|blockquote|pre|table|ul|ol|caption)\s*>/gi, '\n')
  text = text.replace(/<[^>]*>/g, '')
  return text
}

/* ---------------------------- html -> text ------------------------- */

function CONTENT_pushText(out, value, pre) {
  var text = String(value == null ? '' : value)
  if (!text) return
  if (!pre) {
    text = text.replace(/\s+/g, ' ')
    var previous = out.length ? out[out.length - 1] : ''
    var previousChar = previous ? previous.charAt(previous.length - 1) : ''
    if (text === ' ') {
      if (!previous || previousChar === ' ' || previousChar === '\n') return
      out.push(' ')
      return
    }
    if (!previous || previousChar === '\n' || previousChar === ' ') {
      text = text.replace(/^ +/, '')
    }
    if (!text) return
  }
  out.push(text)
}

function CONTENT_collectRow(row, out, depth) {
  var cells = []
  var children = row.childNodes || []
  for (var i = 0; i < children.length; i++) {
    var cell = children[i]
    if (!cell || cell.nodeType !== 1) continue
    var tag = String(cell.tagName || '').toUpperCase()
    if (tag !== 'TD' && tag !== 'TH') continue
    var cellOut = []
    CONTENT_collectText(cell, cellOut, depth + 1, false)
    cells.push(cellOut.join('').replace(/\s+/g, ' ').trim())
  }
  if (!cells.length) return
  out.push('\n')
  out.push(cells.join(' | '))
}

function CONTENT_collectText(node, out, depth, inPre) {
  if (!node || depth > 160) return
  if (node.nodeType === 3) {
    CONTENT_pushText(out, node.nodeValue, inPre)
    return
  }
  if (node.nodeType !== 1) return
  var tag = String(node.tagName || '').toUpperCase()
  if (tag === 'BR') { out.push('\n'); return }
  if (tag === 'HR') { out.push('\n'); return }
  if (tag === 'IMG') return
  if (tag === 'TR') { CONTENT_collectRow(node, out, depth); return }
  if (CONTENT_TEXT_SKIP[tag]) return
  var pre = inPre || tag === 'PRE'
  var children = node.childNodes || []
  for (var i = 0; i < children.length; i++) {
    CONTENT_collectText(children[i], out, depth + 1, pre)
  }
  if (CONTENT_TEXT_BLOCK[tag]) out.push('\n')
}

function CONTENT_cleanText(raw) {
  var text = String(raw == null ? '' : raw)
  text = text.replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n')
  var lines = text.split('\n')
  var kept = []
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/[ \t]+$/, '')
    if (!line.trim() && kept.length === 0) continue
    kept.push(line)
  }
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop()
  text = kept.join('\n')
  return text.replace(/\n{3,}/g, '\n\n')
}

DSN.htmlToText = function htmlToText(html) {
  var source = String(html == null ? '' : html)
  if (!source) return ''
  try {
    var doc = CONTENT_parseDocument(source)
    if (doc && doc.body) {
      var out = []
      CONTENT_collectText(doc.body, out, 0, false)
      return CONTENT_cleanText(out.join(''))
    }
  } catch (error) {
    DSN.log('htmlToText DOM path failed', error)
  }
  try {
    return CONTENT_cleanText(CONTENT_unescapeHtml(CONTENT_stripTags(source)))
  } catch (nested) {
    DSN.log('htmlToText fallback failed', nested)
    return ''
  }
}

/* ---------------------------- text -> html ------------------------- */

DSN.textToHtml = function textToHtml(text) {
  var raw = String(text == null ? '' : text)
  if (!raw) return ''
  var lines = raw.replace(/\r\n?/g, '\n').split('\n')
  var parts = []
  for (var i = 0; i < lines.length; i++) {
    if (lines[i] === '') parts.push('<div><br></div>')
    else parts.push('<div>' + DSN.escapeHtml(lines[i]) + '</div>')
  }
  return parts.join('')
}

/* ---------------------------- kind detection ----------------------- */

function CONTENT_isSingleUrl(text) {
  return /^(https?:\/\/|mailto:|www\.)\S+$/i.test(String(text == null ? '' : text).trim())
}

DSN.detectKind = function detectKind(html, text) {
  var source = String(html == null ? '' : html)
  var plain = String(text == null ? '' : text).trim()
  try {
    // The store may pass an empty text; derive it so html-only notes classify.
    if (!plain && source) plain = DSN.htmlToText(source).trim()
    if (!source.trim()) return CONTENT_isSingleUrl(plain) ? 'link' : 'text'
    var cleaned = source.replace(/<(script|style|noscript|template|svg|math)\b[\s\S]*?<\/\1\s*>/gi, '')
    var hasTable = /<table[\s>\/]/i.test(cleaned)
    var hasImage = /<img[\s>\/]/i.test(cleaned)
    var hasCode = /<(pre|code)[\s>\/]/i.test(cleaned)
    if (hasTable && (hasImage || hasCode)) return 'mixed'
    if (hasImage && hasCode) return 'mixed'
    if (hasTable) return 'table'
    if (hasImage) return 'image'
    if (hasCode) return 'code'
    var anchors = cleaned.match(/<a\b[^>]*>/gi)
    if (anchors && anchors.length > 0) {
      if (CONTENT_isSingleUrl(plain)) return 'link'
      if (anchors.length === 1 && plain.length > 0 && plain.length <= 400) {
        var anchorBody = cleaned.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)
        if (anchorBody) {
          var anchorText = CONTENT_cleanText(CONTENT_unescapeHtml(CONTENT_stripTags(anchorBody[1])))
          if (anchorText && plain.length <= anchorText.length + 4) return 'link'
        }
      }
    }
  } catch (error) {
    DSN.log('detectKind failed', error)
  }
  return 'text'
}

/* --------------------------- allowlist attrs ----------------------- */

function CONTENT_safeHref(raw) {
  var value = String(raw == null ? '' : raw).replace(/^[\u0000-\u0020\u00a0]+|[\u0000-\u0020\u00a0]+$/g, '')
  if (!value) return ''
  if (/[\u0000-\u001f\u007f]/.test(value)) return ''
  var lower = value.toLowerCase()
  if (lower.indexOf('http://') === 0) return value
  if (lower.indexOf('https://') === 0) return value
  if (lower.indexOf('mailto:') === 0) return value
  return ''
}

function CONTENT_safeImageSrc(raw) {
  var value = String(raw == null ? '' : raw).replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '')
  if (!value) return ''
  if (/[\u0000-\u001f\u007f]/.test(value)) return ''
  var lower = value.toLowerCase()
  if (lower.indexOf('https://') === 0) return value
  if (lower.indexOf('data:image/') === 0) return value
  return ''
}

function CONTENT_cleanStyle(raw) {
  var style = String(raw == null ? '' : raw)
  if (!style) return ''
  // No CSS escapes, no url(), no comment tricks: values must be plain keywords.
  if (/[<>"'\\]/.test(style) || style.indexOf('/*') >= 0) return ''
  var declarations = style.split(';')
  var kept = []
  var seen = {}
  for (var i = 0; i < declarations.length; i++) {
    var declaration = declarations[i]
    var colon = declaration.indexOf(':')
    if (colon < 0) continue
    var name = declaration.slice(0, colon).trim().toLowerCase()
    var value = declaration.slice(colon + 1).trim()
    if (!CONTENT_STYLE_PROPS[name]) continue
    if (seen[name]) continue
    if (!CONTENT_STYLE_PROPS[name].test(value)) continue
    seen[name] = true
    kept.push(name + ': ' + value.toLowerCase())
  }
  return kept.join('; ')
}

function CONTENT_spanAttr(node, name) {
  var raw = node.getAttribute(name)
  if (raw == null || raw === '') return ''
  var number = parseInt(raw, 10)
  if (!isFinite(number) || number <= 0) return ''
  return name + '="' + Math.min(number, 1000) + '"'
}

function CONTENT_sanitizeAttrs(node, tag) {
  var parts = []
  var style = CONTENT_cleanStyle(node.getAttribute('style'))
  if (tag === 'a') {
    var href = CONTENT_safeHref(node.getAttribute('href'))
    if (!href) return ''
    parts.push('href="' + DSN.escapeHtml(href) + '"')
    parts.push('target="_blank"')
    parts.push('rel="noopener noreferrer"')
    if (style) parts.push('style="' + DSN.escapeHtml(style) + '"')
    return parts.join(' ')
  }
  if (tag === 'img') {
    var src = CONTENT_safeImageSrc(node.getAttribute('src'))
    if (!src) return ''
    parts.push('src="' + DSN.escapeHtml(src) + '"')
    var alt = node.getAttribute('alt')
    if (alt != null) parts.push('alt="' + DSN.escapeHtml(String(alt).slice(0, 300)) + '"')
    if (style) parts.push('style="' + DSN.escapeHtml(style) + '"')
    return parts.join(' ')
  }
  if (tag === 'td' || tag === 'th') {
    var colspan = CONTENT_spanAttr(node, 'colspan')
    if (colspan) parts.push(colspan)
    var rowspan = CONTENT_spanAttr(node, 'rowspan')
    if (rowspan) parts.push(rowspan)
  }
  if (tag === 'col' || tag === 'colgroup') {
    var span = CONTENT_spanAttr(node, 'span')
    if (span) parts.push(span)
  }
  if (style) parts.push('style="' + DSN.escapeHtml(style) + '"')
  return parts.join(' ')
}

/* --------------------------- sanitizer tree ------------------------ */

function CONTENT_sanitizeChildren(node, depth) {
  var out = ''
  var children = node.childNodes || []
  for (var i = 0; i < children.length; i++) {
    out += CONTENT_sanitizeNode(children[i], depth)
  }
  return out
}

function CONTENT_sanitizeNode(node, depth) {
  if (!node) return ''
  // Text node: escape entities so the output re-parses to the same text.
  if (node.nodeType === 3) return DSN.escapeHtml(node.nodeValue == null ? '' : node.nodeValue)
  if (node.nodeType !== 1) return ''
  if (depth > 140) return DSN.escapeHtml(node.textContent || '')
  var tag = String(node.tagName || '').toLowerCase()
  if (!tag) return ''
  if (CONTENT_DROP_TAGS[tag.toUpperCase()]) return ''
  if (!CONTENT_ALLOWED_TAGS[tag]) {
    // Unknown wrappers are dropped as tags; their sanitized children survive.
    return CONTENT_sanitizeChildren(node, depth + 1)
  }
  var attrs = CONTENT_sanitizeAttrs(node, tag)
  if (tag === 'img') return attrs ? '<img ' + attrs + '>' : ''
  if (tag === 'a' && !attrs) return CONTENT_sanitizeChildren(node, depth + 1)
  if (CONTENT_VOID_TAGS[tag]) return '<' + tag + (attrs ? ' ' + attrs : '') + '>'
  return '<' + tag + (attrs ? ' ' + attrs : '') + '>' + CONTENT_sanitizeChildren(node, depth + 1) + '</' + tag + '>'
}

/* --------------------------- sanitizer cache ----------------------- */

var CONTENT_CACHE = null
var CONTENT_CACHE_LIMIT = 80
var CONTENT_CACHE_MAX_INPUT = 131072

function CONTENT_cacheGet(key) {
  if (!CONTENT_CACHE) return null
  return CONTENT_CACHE.has(key) ? CONTENT_CACHE.get(key) : null
}

function CONTENT_cacheSet(key, value) {
  if (typeof Map === 'undefined') return
  if (!CONTENT_CACHE) CONTENT_CACHE = new Map()
  if (CONTENT_CACHE.size >= CONTENT_CACHE_LIMIT) {
    var oldest = CONTENT_CACHE.keys().next()
    if (!oldest.done) CONTENT_CACHE.delete(oldest.value)
  }
  CONTENT_CACHE.set(key, value)
}

DSN.sanitizeHtml = function sanitizeHtml(html) {
  var source = String(html == null ? '' : html)
  if (!source) return ''
  var cacheable = source.length <= CONTENT_CACHE_MAX_INPUT
  if (cacheable) {
    var cached = CONTENT_cacheGet(source)
    if (cached != null) return cached
  }
  var output
  try {
    var doc = CONTENT_parseDocument(source)
    if (doc && doc.body) {
      output = CONTENT_sanitizeChildren(doc.body, 0)
    } else {
      output = DSN.escapeHtml(CONTENT_unescapeHtml(CONTENT_stripTags(source)))
    }
  } catch (error) {
    DSN.log('sanitizeHtml failed, escaping the whole input', error)
    try {
      output = DSN.escapeHtml(CONTENT_unescapeHtml(CONTENT_stripTags(source)))
    } catch (nested) {
      output = ''
    }
  }
  if (cacheable) CONTENT_cacheSet(source, output)
  return output
}

/* ------------------------------ Content ---------------------------- */

DSN.Content = function Content(props) {
  var config = props || {}
  var source = config.html == null ? '' : String(config.html)
  var kind = config.kind ? String(config.kind) : 'text'
  var safe = DSN.React.useMemo(function () {
    return DSN.sanitizeHtml(source)
  }, [source])
  var className = 'dsn-content'
  if (kind === 'image' || kind === 'table' || kind === 'code') className += ' dsn-content--' + kind
  if (config.className) className += ' ' + config.className
  return DSN.h('div', {
    className: className,
    'data-dsn-kind': kind,
    dangerouslySetInnerHTML: { __html: safe },
  })
}

/* ------------------------------ Editor ----------------------------- */

var CONTENT_EDITOR_DEBOUNCE_MS = 120

function CONTENT_editorSeed(value) {
  var raw = value == null ? '' : String(value)
  if (!raw) return ''
  return /<\/?[a-z][^>]*>/i.test(raw) ? raw : DSN.textToHtml(raw)
}

function CONTENT_updateEmpty(node) {
  if (!node) return
  var empty = false
  try {
    empty = String(node.textContent || '').replace(/[\s\u00a0]+/g, '') === ''
      && !node.querySelector('img, table, hr')
  } catch (error) {
    DSN.log('editor empty state failed', error)
    empty = false
  }
  node.setAttribute('data-empty', empty ? 'true' : 'false')
}

function CONTENT_toggleDropClass(node, active) {
  if (!node || !node.classList) return
  if (active) node.classList.add('dsn-editor--drop')
  else node.classList.remove('dsn-editor--drop')
}

/** Insert already-sanitized HTML at the caret (or at `savedRange`). */
function CONTENT_insertHtml(node, html, savedRange) {
  if (!node || !html) return
  try { node.focus() } catch (focusError) { /* detached */ }
  var selection = typeof window !== 'undefined' ? window.getSelection() : null
  var range = null
  if (savedRange && node.contains(savedRange.commonAncestorContainer)) {
    range = savedRange
  } else if (selection && selection.rangeCount > 0) {
    var current = selection.getRangeAt(0)
    if (node.contains(current.commonAncestorContainer)) range = current
  }
  if (!range) {
    range = document.createRange()
    range.selectNodeContents(node)
    range.collapse(false)
  }
  if (selection) {
    try {
      selection.removeAllRanges()
      selection.addRange(range)
    } catch (selectionError) { /* ignore */ }
  }
  var inserted = false
  try {
    inserted = document.execCommand('insertHTML', false, html)
  } catch (execError) {
    DSN.log('execCommand insertHTML failed, using range insertion', execError)
  }
  if (inserted) return
  try {
    var template = document.createElement('template')
    // SAFETY: callers pass HTML that already went through DSN.sanitizeHtml;
    // sanitizing again keeps this assignment safe even if a caller forgets.
    template.innerHTML = DSN.sanitizeHtml(html)
    var fragment = template.content
    range.deleteContents()
    var last = fragment.lastChild
    range.insertNode(fragment)
    if (last && selection) {
      var after = document.createRange()
      after.setStartAfter(last)
      after.collapse(true)
      selection.removeAllRanges()
      selection.addRange(after)
    }
  } catch (insertError) {
    DSN.log('range insertion failed', insertError)
  }
}

function CONTENT_fileListOf(dataTransfer) {
  var files = []
  try {
    var raw = dataTransfer ? dataTransfer.files : null
    if (raw && typeof raw.length === 'number') {
      for (var i = 0; i < raw.length; i++) files.push(raw[i])
    }
  } catch (error) {
    DSN.log('dataTransfer.files unreadable', error)
  }
  if (files.length === 0 && dataTransfer && dataTransfer.items) {
    try {
      for (var j = 0; j < dataTransfer.items.length; j++) {
        var item = dataTransfer.items[j]
        if (!item || item.kind !== 'file' || typeof item.getAsFile !== 'function') continue
        var file = item.getAsFile()
        if (file) files.push(file)
      }
    } catch (itemError) {
      DSN.log('dataTransfer.items unreadable', itemError)
    }
  }
  return files
}

function CONTENT_pickImages(files, maxImages) {
  var limit = maxImages || CONTENT_MAX_IMAGES
  var picked = []
  var list = files || []
  for (var i = 0; i < list.length; i++) {
    if (picked.length >= limit) break
    var file = list[i]
    if (!file || !file.type || file.type.indexOf('image/') !== 0) continue
    if (typeof file.size === 'number' && file.size > CONTENT_MAX_IMAGE_BYTES) {
      DSN.log('image rejected: larger than the limit', file.name, file.size)
      continue
    }
    picked.push(file)
  }
  return picked
}

function CONTENT_filesToDataUrls(files) {
  if (typeof Promise === 'undefined' || typeof FileReader === 'undefined' || !files || !files.length) {
    return Promise.resolve([])
  }
  var readers = files.map(function (file) {
    return new Promise(function (resolve) {
      var reader
      try {
        reader = new FileReader()
      } catch (error) {
        DSN.log('FileReader unavailable', error)
        resolve('')
        return
      }
      reader.onload = function () {
        resolve(typeof reader.result === 'string' ? reader.result : '')
      }
      reader.onerror = function () {
        DSN.log('FileReader failed', reader.error)
        resolve('')
      }
      try {
        reader.readAsDataURL(file)
      } catch (error) {
        DSN.log('readAsDataURL failed', error)
        resolve('')
      }
    })
  })
  return Promise.all(readers).then(function (urls) {
    return urls || []
  }, function (error) {
    DSN.log('data URL conversion failed', error)
    return []
  })
}

function CONTENT_hasDragType(dataTransfer, wanted) {
  try {
    var types = dataTransfer ? dataTransfer.types : null
    if (!types) return false
    if (typeof types.contains === 'function') return types.contains(wanted)
    if (typeof types.length === 'number') {
      for (var i = 0; i < types.length; i++) if (types[i] === wanted) return true
    }
  } catch (error) {
    DSN.log('drag types unreadable', error)
  }
  return false
}

function CONTENT_readData(dataTransfer, type) {
  try {
    var value = dataTransfer ? dataTransfer.getData(type) : ''
    return value == null ? '' : String(value)
  } catch (error) {
    DSN.log('getData failed for ' + type, error)
    return ''
  }
}

DSN.Editor = function Editor(props) {
  var config = props || {}
  var React = DSN.React
  var translate = typeof config.t === 'function' ? config.t : DSN.fallbackT
  var nodeRef = React.useRef(null)
  var timerRef = React.useRef(null)
  var focusedRef = React.useRef(false)
  var lastEmittedRef = React.useRef(null)
  var onChangeRef = React.useRef(config.onChange)
  var onSubmitRef = React.useRef(config.onSubmit)
  onChangeRef.current = config.onChange
  onSubmitRef.current = config.onSubmit

  var initialSeedRef = React.useRef(null)
  if (initialSeedRef.current === null) {
    initialSeedRef.current = DSN.sanitizeHtml(CONTENT_editorSeed(config.value))
    lastEmittedRef.current = initialSeedRef.current
  }
  var initialSeed = initialSeedRef.current

  function emitNow() {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    var node = nodeRef.current
    if (!node) return
    var html = DSN.sanitizeHtml(node.innerHTML)
    lastEmittedRef.current = html
    CONTENT_updateEmpty(node)
    var callback = onChangeRef.current
    if (typeof callback !== 'function') return
    try {
      callback(html)
    } catch (error) {
      DSN.log('editor onChange failed', error)
    }
  }

  function emitSoon() {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(function () {
      timerRef.current = null
      emitNow()
    }, CONTENT_EDITOR_DEBOUNCE_MS)
  }

  // Re-seed from the outside only when the value is not just our own echo.
  // A focused editor keeps its DOM untouched so the caret never jumps, except
  // for an explicit reset to empty: the composer clears its draft right after
  // saving while it still holds focus, and without this the old text stays on
  // screen even though the note was stored.
  React.useEffect(function () {
    var node = nodeRef.current
    if (!node) return
    var seed = DSN.sanitizeHtml(CONTENT_editorSeed(config.value))
    if (seed === lastEmittedRef.current) return
    if (focusedRef.current && seed !== '') return
    if (node.innerHTML === seed) {
      lastEmittedRef.current = seed
      return
    }
    node.innerHTML = seed
    lastEmittedRef.current = seed
    CONTENT_updateEmpty(node)
  }, [config.value])

  // `data-empty` drives the CSS placeholder; it is DOM-owned (not a React
  // prop) so a parent re-render never resets it over the user's content.
  React.useEffect(function () {
    CONTENT_updateEmpty(nodeRef.current)
    return undefined
  }, [])

  React.useEffect(function () {
    if (!config.autoFocus) return undefined
    var node = nodeRef.current
    if (!node) return undefined
    try {
      node.focus()
      var range = document.createRange()
      range.selectNodeContents(node)
      range.collapse(false)
      var selection = window.getSelection()
      if (selection) {
        selection.removeAllRanges()
        selection.addRange(range)
      }
    } catch (error) {
      DSN.log('editor autofocus failed', error)
    }
    return undefined
  }, [])

  React.useEffect(function () {
    return function () {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  function onInput() {
    CONTENT_updateEmpty(nodeRef.current)
    emitSoon()
  }

  function onFocus() {
    focusedRef.current = true
    CONTENT_updateEmpty(nodeRef.current)
  }

  function onBlur() {
    focusedRef.current = false
    emitNow()
  }

  function onKeyDown(event) {
    if (!event) return
    if (event.isComposing || event.keyCode === 229) return
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      emitNow()
      var submit = onSubmitRef.current
      if (typeof submit === 'function') {
        try {
          submit()
        } catch (error) {
          DSN.log('editor onSubmit failed', error)
        }
      }
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      var node = nodeRef.current
      if (node && typeof node.blur === 'function') node.blur()
    }
  }

  function onPaste(event) {
    var node = nodeRef.current
    if (!node) return
    var dataTransfer = event.clipboardData || (event.nativeEvent && event.nativeEvent.clipboardData)
    if (!dataTransfer) return
    var savedRange = null
    try {
      var selection = window.getSelection()
      if (selection && selection.rangeCount > 0) {
        var current = selection.getRangeAt(0)
        if (node.contains(current.commonAncestorContainer)) savedRange = current.cloneRange()
      }
    } catch (rangeError) {
      DSN.log('paste range unreadable', rangeError)
    }
    var html = CONTENT_readData(dataTransfer, 'text/html')
    var plain = CONTENT_readData(dataTransfer, 'text/plain')
    var imageFiles = CONTENT_pickImages(CONTENT_fileListOf(dataTransfer), CONTENT_MAX_IMAGES)
    if (html) {
      event.preventDefault()
      CONTENT_insertHtml(node, DSN.sanitizeHtml(html), savedRange)
      CONTENT_updateEmpty(node)
      emitNow()
      return
    }
    if (imageFiles.length) {
      event.preventDefault()
      var altText = DSN.escapeHtml(translate('content.imageAlt'))
      CONTENT_filesToDataUrls(imageFiles).then(function (urls) {
        var markup = ''
        for (var i = 0; i < urls.length; i++) {
          if (!urls[i]) continue
          markup += '<img src="' + DSN.escapeHtml(urls[i]) + '" alt="' + altText + '">'
        }
        if (!markup) return
        CONTENT_insertHtml(node, DSN.sanitizeHtml(markup), savedRange)
        CONTENT_updateEmpty(node)
        emitNow()
      })
      return
    }
    if (plain) {
      event.preventDefault()
      var safePlain = plain.replace(/\r\n?/g, '\n')
      if (safePlain.indexOf('\n') >= 0) {
        CONTENT_insertHtml(node, DSN.sanitizeHtml(DSN.textToHtml(safePlain)), savedRange)
      } else {
        try {
          document.execCommand('insertText', false, safePlain)
        } catch (textError) {
          CONTENT_insertHtml(node, DSN.sanitizeHtml(DSN.textToHtml(safePlain)), savedRange)
        }
      }
      CONTENT_updateEmpty(node)
      emitNow()
      return
    }
    // No clipboard payload we understand: let the browser handle it.
  }

  function onDrop(event) {
    var node = nodeRef.current
    var dataTransfer = event.dataTransfer
    if (!node || !dataTransfer) return
    CONTENT_toggleDropClass(node, false)
    if (CONTENT_hasDragType(dataTransfer, 'application/x-dsn-note')) {
      // A note dragged out of the board must not be pasted as text here.
      event.preventDefault()
      return
    }
    if (!DSN.dragHasContent(dataTransfer)) return
    event.preventDefault()
    if (typeof event.stopPropagation === 'function') event.stopPropagation()
    DSN.readDragContent(dataTransfer).then(function (payload) {
      if (!payload) return
      if (payload.html) {
        CONTENT_insertHtml(node, DSN.sanitizeHtml(payload.html))
      } else if (payload.text) {
        CONTENT_insertHtml(node, DSN.sanitizeHtml(DSN.textToHtml(payload.text)))
      }
      CONTENT_updateEmpty(node)
      emitNow()
    }, function (error) {
      DSN.log('drop payload failed', error)
    })
  }

  function onDragOver(event) {
    var dataTransfer = event.dataTransfer
    if (!dataTransfer) return
    if (CONTENT_hasDragType(dataTransfer, 'application/x-dsn-note')) {
      event.preventDefault()
      var node = nodeRef.current
      if (node) CONTENT_toggleDropClass(node, false)
      return
    }
    if (!DSN.dragHasContent(dataTransfer)) return
    event.preventDefault()
    try { dataTransfer.dropEffect = 'copy' } catch (effectError) { /* read-only */ }
    CONTENT_toggleDropClass(event.currentTarget, true)
  }

  function onDragEnter(event) {
    var dataTransfer = event.dataTransfer
    if (!dataTransfer) return
    if (CONTENT_hasDragType(dataTransfer, 'application/x-dsn-note')) return
    if (DSN.dragHasContent(dataTransfer)) CONTENT_toggleDropClass(event.currentTarget, true)
  }

  function onDragLeave(event) {
    CONTENT_toggleDropClass(event.currentTarget, false)
  }

  var className = 'dsn-editor'
  if (config.className) className += ' ' + config.className
  var style = null
  if (config.minHeight != null) {
    style = { minHeight: typeof config.minHeight === 'number' ? config.minHeight + 'px' : String(config.minHeight) }
  }
  var placeholder = config.placeholder == null ? '' : String(config.placeholder)

  return DSN.h('div', {
    ref: nodeRef,
    className: className,
    style: style,
    contentEditable: true,
    suppressContentEditableWarning: true,
    role: 'textbox',
    tabIndex: 0,
    spellCheck: true,
    'aria-multiline': 'true',
    'aria-label': translate('content.editorLabel'),
    'aria-placeholder': placeholder,
    'data-placeholder': placeholder,
    dangerouslySetInnerHTML: { __html: initialSeed },
    onInput: onInput,
    onFocus: onFocus,
    onBlur: onBlur,
    onKeyDown: onKeyDown,
    onPaste: onPaste,
    onDrop: onDrop,
    onDragOver: onDragOver,
    onDragEnter: onDragEnter,
    onDragLeave: onDragLeave,
  })
}

/* --------------------------- drag payloads ------------------------- */

DSN.dragHasContent = function dragHasContent(dataTransfer) {
  try {
    if (!dataTransfer) return false
    if (CONTENT_hasDragType(dataTransfer, 'text/html')) return true
    if (CONTENT_hasDragType(dataTransfer, 'text/plain')) return true
    if (CONTENT_hasDragType(dataTransfer, 'Files')) return true
    if (CONTENT_fileListOf(dataTransfer).length > 0) return true
  } catch (error) {
    DSN.log('dragHasContent failed', error)
  }
  return false
}

DSN.readDragContent = function readDragContent(dataTransfer) {
  var result = { html: '', text: '', files: [] }
  try {
    if (!dataTransfer) return Promise.resolve(result)
    var files = CONTENT_fileListOf(dataTransfer)
    result.files = files
    var html = CONTENT_readData(dataTransfer, 'text/html')
    var text = CONTENT_readData(dataTransfer, 'text/plain')
    result.text = text
    var images = CONTENT_pickImages(files, CONTENT_MAX_IMAGES)
    for (var i = 0; i < files.length; i++) {
      var file = files[i]
      if (!file || images.indexOf(file) >= 0) continue
      var name = file.name || ''
      if (!name) continue
      result.text += (result.text ? '\n' : '') + '[file: ' + name + ']'
    }
    if (!images.length) {
      result.html = html ? DSN.sanitizeHtml(html) : ''
      return Promise.resolve(result)
    }
    return CONTENT_filesToDataUrls(images).then(function (urls) {
      var markup = ''
      for (var j = 0; j < urls.length; j++) {
        if (!urls[j]) continue
        markup += '<img src="' + DSN.escapeHtml(urls[j]) + '" alt="">'
      }
      result.html = (html ? DSN.sanitizeHtml(html) : '') + markup
      return result
    }, function (error) {
      DSN.log('drag image conversion failed', error)
      result.html = html ? DSN.sanitizeHtml(html) : ''
      return result
    })
  } catch (error) {
    DSN.log('readDragContent failed', error)
    return Promise.resolve({ html: '', text: '', files: [] })
  }
}

/* ------------------------------ styles ----------------------------- */

var CONTENT_CSS = [
  '/* rendered rich content */',
  '.dsn-content {',
  '  color: var(--dsw-alias-label-primary, #1b1b1f);',
  '  font-size: 13px;',
  '  line-height: 1.65;',
  '  min-width: 0;',
  '  overflow-wrap: anywhere;',
  '  word-break: break-word;',
  '}',
  '.dsn-content > :first-child { margin-top: 0; }',
  '.dsn-content > :last-child { margin-bottom: 0; }',
  '.dsn-content p { margin: 0 0 0.55em; }',
  '.dsn-content h1, .dsn-content h2, .dsn-content h3,',
  '.dsn-content h4, .dsn-content h5, .dsn-content h6 {',
  '  margin: 0.65em 0 0.3em;',
  '  color: var(--dsw-alias-label-primary, #1b1b1f);',
  '  font-weight: 600;',
  '  line-height: 1.35;',
  '}',
  '.dsn-content h1 { font-size: 1.5em; }',
  '.dsn-content h2 { font-size: 1.32em; }',
  '.dsn-content h3 { font-size: 1.18em; }',
  '.dsn-content h4 { font-size: 1.06em; }',
  '.dsn-content h5 { font-size: 1em; }',
  '.dsn-content h6 { font-size: 0.92em; color: var(--dsw-alias-label-secondary, #5c5c66); }',
  '.dsn-content ul, .dsn-content ol { margin: 0.35em 0 0.55em; padding-left: 1.5em; }',
  '.dsn-content li { margin: 0.15em 0; }',
  '.dsn-content li > p { margin: 0; }',
  '.dsn-content blockquote {',
  '  margin: 0.5em 0;',
  '  padding: 0.1em 0 0.1em 0.75em;',
  '  border-left: 3px solid var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.16));',
  '  color: var(--dsw-alias-label-secondary, #5c5c66);',
  '}',
  '.dsn-content hr {',
  '  height: 0;',
  '  margin: 0.8em 0;',
  '  border: 0;',
  '  border-top: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));',
  '}',
  '.dsn-content a {',
  '  color: var(--dsw-alias-link, #4d6bfe);',
  '  text-decoration: underline;',
  '  text-underline-offset: 2px;',
  '  cursor: pointer;',
  '}',
  '.dsn-content a:hover { text-decoration-thickness: 2px; }',
  '.dsn-content img {',
  '  display: block;',
  '  max-width: 100%;',
  '  height: auto;',
  '  margin: 4px 0;',
  '  border-radius: var(--dsw-radius-md, 8px);',
  '  background: var(--dsw-alias-bg-layer-2, #f5f5f7);',
  '}',
  '.dsn-content--image img {',
  '  max-height: 320px;',
  '  width: auto;',
  '  object-fit: contain;',
  '  margin-left: auto;',
  '  margin-right: auto;',
  '}',
  '.dsn-content table {',
  '  display: block;',
  '  width: 100%;',
  '  max-width: 100%;',
  '  overflow-x: auto;',
  '  margin: 6px 0;',
  '  border-collapse: collapse;',
  '  border-spacing: 0;',
  '  font-size: 12px;',
  '  line-height: 1.5;',
  '}',
  '.dsn-content caption {',
  '  caption-side: top;',
  '  padding: 0 0 6px;',
  '  color: var(--dsw-alias-label-secondary, #5c5c66);',
  '  font-size: 12px;',
  '  text-align: left;',
  '}',
  '.dsn-content td, .dsn-content th {',
  '  padding: 5px 8px;',
  '  border: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));',
  '  vertical-align: top;',
  '  text-align: left;',
  '}',
  '.dsn-content th {',
  '  background: var(--dsw-alias-bg-layer-2, #f5f5f7);',
  '  color: var(--dsw-alias-label-primary, #1b1b1f);',
  '  font-weight: 600;',
  '  white-space: nowrap;',
  '}',
  '.dsn-content code, .dsn-content kbd {',
  '  font-family: var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace);',
  '  font-size: 0.92em;',
  '}',
  '.dsn-content code {',
  '  padding: 0.08em 0.35em;',
  '  border-radius: 4px;',
  '  background: var(--dsw-alias-bg-skeleton, rgba(0, 0, 0, 0.05));',
  '  color: var(--dsw-alias-label-primary, #1b1b1f);',
  '}',
  '.dsn-content pre {',
  '  margin: 6px 0;',
  '  padding: 8px 10px;',
  '  max-height: 340px;',
  '  overflow: auto;',
  '  border: 0.5px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06));',
  '  border-radius: var(--dsw-radius-md, 8px);',
  '  background: var(--dsw-alias-bg-layer-2, #f5f5f7);',
  '  font-size: 12px;',
  '  line-height: 1.55;',
  '  white-space: pre;',
  '  tab-size: 2;',
  '}',
  '.dsn-content pre code {',
  '  padding: 0;',
  '  border-radius: 0;',
  '  background: transparent;',
  '  color: inherit;',
  '  font-size: inherit;',
  '  white-space: inherit;',
  '}',
  '.dsn-content--code pre { margin: 0; }',
  '.dsn-content kbd {',
  '  padding: 0.05em 0.35em;',
  '  border: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));',
  '  border-bottom-width: 2px;',
  '  border-radius: 4px;',
  '  background: var(--dsw-alias-bg-layer-1, #ffffff);',
  '}',
  '.dsn-content mark {',
  '  padding: 0 2px;',
  '  border-radius: 2px;',
  '  background: var(--dsw-alias-bg-skeleton, rgba(0, 0, 0, 0.08));',
  '  color: inherit;',
  '}',
  '.dsn-content sub, .dsn-content sup { font-size: 0.75em; line-height: 0; }',
  '.dsn-content--clamp {',
  '  max-height: 11.5em;',
  '  overflow: hidden;',
  '  -webkit-mask-image: linear-gradient(to bottom, var(--dsw-alias-label-primary, #1b1b1f) 75%, transparent);',
  '  mask-image: linear-gradient(to bottom, var(--dsw-alias-label-primary, #1b1b1f) 75%, transparent);',
  '}',
  '.dsn-content--expanded {',
  '  max-height: none;',
  '  overflow: visible;',
  '  -webkit-mask-image: none;',
  '  mask-image: none;',
  '}',
  '/* contentEditable editor */',
  '.dsn-editor {',
  '  position: relative;',
  '  box-sizing: border-box;',
  '  width: 100%;',
  '  min-height: 64px;',
  '  max-height: 300px;',
  '  padding: 9px 11px;',
  '  overflow-y: auto;',
  '  border: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));',
  '  border-radius: var(--dsw-radius-md, 8px);',
  '  background: var(--dsw-alias-bg-layer-1, #ffffff);',
  '  color: var(--dsw-alias-label-primary, #1b1b1f);',
  '  font: inherit;',
  '  font-size: 13px;',
  '  line-height: 1.6;',
  '  text-align: left;',
  '  white-space: pre-wrap;',
  '  overflow-wrap: anywhere;',
  '  word-break: break-word;',
  '  outline: none;',
  '  transition: border-color 0.15s ease;',
  '}',
  '.dsn-editor:focus, .dsn-editor:focus-within {',
  '  border-color: var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4d6bfe));',
  '}',
  '.dsn-editor--drop {',
  '  border-color: var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4d6bfe));',
  '  background: var(--dsw-alias-bg-layer-2, #f5f5f7);',
  '}',
  '.dsn-editor[data-empty="true"]::before, .dsn-editor:empty::before {',
  '  content: attr(data-placeholder);',
  '  position: absolute;',
  '  top: 9px;',
  '  left: 11px;',
  '  right: 11px;',
  '  display: -webkit-box;',
  '  overflow: hidden;',
  '  -webkit-box-orient: vertical;',
  '  -webkit-line-clamp: 2;',
  '  color: var(--dsw-alias-label-tertiary, #8a8a94);',
  '  white-space: pre-wrap;',
  '  pointer-events: none;',
  '}',
  '.dsn-editor p, .dsn-editor div { margin: 0; }',
  '.dsn-editor a { color: var(--dsw-alias-link, #4d6bfe); }',
  '.dsn-editor img { max-width: 100%; height: auto; border-radius: 6px; }',
  '.dsn-editor table { max-width: 100%; border-collapse: collapse; font-size: 12px; }',
  '.dsn-editor td, .dsn-editor th {',
  '  padding: 4px 6px;',
  '  border: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));',
  '}',
  '.dsn-editor th { background: var(--dsw-alias-bg-layer-2, #f5f5f7); font-weight: 600; text-align: left; }',
  '.dsn-editor pre {',
  '  margin: 0 0 4px;',
  '  padding: 6px 8px;',
  '  overflow-x: auto;',
  '  border-radius: 6px;',
  '  background: var(--dsw-alias-bg-layer-2, #f5f5f7);',
  '  font-size: 12px;',
  '  white-space: pre;',
  '}',
  '.dsn-editor code {',
  '  font-family: var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace);',
  '  font-size: 0.92em;',
  '}',
  '.dsn-editor blockquote {',
  '  margin: 0;',
  '  padding-left: 8px;',
  '  border-left: 3px solid var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.16));',
  '  color: var(--dsw-alias-label-secondary, #5c5c66);',
  '}',
].join('\n')

// 30-content runs before 40-styles defines DSN.addCss. Every fragment of the
// bundle executes synchronously inside one factory body, and a microtask runs
// only after that body finished, so the retry succeeds and the chunk is
// registered before the plugin's apply() injects the stylesheet.
;(function registerContentCss() {
  function register() {
    if (typeof DSN.addCss !== 'function') return false
    try {
      DSN.addCss('content', CONTENT_CSS)
    } catch (error) {
      DSN.log('content CSS registration failed', error)
    }
    return true
  }
  if (register()) return
  if (typeof Promise === 'function') {
    Promise.resolve().then(function () {
      if (register()) return
      setTimeout(function () {
        if (!register()) DSN.log('content CSS skipped: DSN.addCss is unavailable')
      }, 0)
    })
  } else {
    setTimeout(function () {
      if (!register()) DSN.log('content CSS skipped: DSN.addCss is unavailable')
    }, 0)
  }
})()

/* ================= 40-styles.js ================= */
/* ------------------------------------------------------------------ *
 * CSS infrastructure and the plugin's whole visual language.
 *
 * Every fragment may append its own named chunk with DSN.addCss(name, css);
 * the joined string is injected once into the host document (and once into
 * the picture-in-picture document). `base` is this file's chunk and the only
 * one guaranteed to exist before the others.
 *
 * Rules for every chunk:
 *   - class names are `dsn-` prefixed; nothing here depends on host classes;
 *   - every colour is `var(--dsw-alias-*, <literal fallback>)` because the PiP
 *     document has no host stylesheets (the token VALUES are copied inline by
 *     70-pip.js, the literals are the safety net);
 *   - sizes, radii, spacing stay plain px/rem literals;
 *   - the host theme attribute is never read: tokens carry the light/dark
 *     switch. `.dsn-root[data-dsn-theme]` is our own opt-in override for a
 *     surface that must not follow the surrounding document.
 * ------------------------------------------------------------------ */

;(function () {
  var chunks = {}
  var order = []

  DSN.CSS = {}

  /**
   * Register (or replace) one named CSS chunk. Idempotent per name: the last
   * call wins and the chunk keeps its original position in the cascade.
   * @param {string} name
   * @param {string} cssText
   * @returns {string} the chunk name
   */
  DSN.addCss = function addCss(name, cssText) {
    var key = name == null ? '' : String(name)
    var text = typeof cssText === 'string' ? cssText : ''
    if (!key || !text) return ''
    if (!Object.prototype.hasOwnProperty.call(chunks, key)) order.push(key)
    chunks[key] = text
    // A chunk registered after the sheet was injected (a lazily loaded
    // fragment, a test harness) must still reach the live document.
    try {
      var doc = typeof document !== 'undefined' ? document : null
      var sheet = doc && doc.querySelector ? doc.querySelector('style[data-dsn-style="1"]') : null
      if (sheet) sheet.textContent = DSN.cssText()
    } catch (error) { DSN.log('style refresh failed', error) }
    return key
  }

  /** @returns {string} every registered chunk, in registration order. */
  DSN.cssText = function cssText() {
    var parts = []
    for (var i = 0; i < order.length; i++) {
      var chunk = chunks[order[i]]
      if (chunk) parts.push('/* dsn:' + order[i] + ' */\n' + chunk)
    }
    return parts.join('\n')
  }

  /** @returns {string[]} the registered chunk names, in cascade order. */
  DSN.cssChunkNames = function cssChunkNames() {
    return order.slice()
  }
})()

/* ------------------------------------------------------------------ *
 * The alias tokens this stylesheet reads. 70-pip.js copies their computed
 * values into the PiP document, so this list must stay in sync with the
 * `var(--dsw-alias-...)` references below.
 * ------------------------------------------------------------------ */

DSN.TOKENS = [
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-module-platform',
  '--dsw-alias-bg-overlay',
  '--dsw-alias-bg-skeleton',
  '--dsw-alias-bg-mask-1',
  '--dsw-alias-bg-mask-2',
  '--dsw-alias-bg-mask-3',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-label-caption',
  '--dsw-alias-label-primary-inverted',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-border-l3',
  '--dsw-alias-border-l4',
  '--dsw-alias-border-inverted',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-interactive-bg-active',
  '--dsw-alias-interactive-bg-hover-danger',
  '--dsw-alias-brand-primary',
  '--dsw-alias-button-primary-fill',
  '--dsw-alias-button-primary-hover',
  '--dsw-alias-button-floating-fill',
  '--dsw-alias-button-floating-hover',
  '--dsw-alias-button-ghost-active-fill',
  '--dsw-alias-state-business-primary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-link',
  '--dsw-alias-toast-bg',
  '--dsw-alias-toast-label',
  '--dsw-alias-tooltip-bg',
  '--dsw-alias-scrollbar-bg-l2',
  '--dsw-alias-scrollbar-hover-l2',
  '--dsw-alias-markdown-inline-code',
  '--dsw-alias-markdown-tag',
]

DSN.CSS.base = [
  '/* ================================================================ */',
  '/* 0. Root scope: reset, type ramp, focus, scrollbars, utilities      */',
  '/* ================================================================ */',
  '',
  '.dsn-root,',
  '.dsn-root *,',
  '.dsn-root *::before,',
  '.dsn-root *::after {',
  '  box-sizing: border-box;',
  '}',
  '',
  '.dsn-root {',
  '  --dsn-radius-panel: 14px;',
  '  --dsn-radius-card: 10px;',
  '  --dsn-radius-control: 8px;',
  '  --dsn-radius-pill: 999px;',
  '  --dsn-radius-titlebar: 44px;',
  '  --dsn-font-code: ui-monospace, SFMono-Regular, "SF Mono", "JetBrains Mono", Consolas, "Liberation Mono", Menlo, monospace;',
  '  position: relative;',
  '  font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif);',
  '  font-size: 13px;',
  '  font-weight: 400;',
  '  line-height: 1.5;',
  '  letter-spacing: 0;',
  '  text-align: left;',
  '  color: var(--dsw-alias-label-primary, #0f1115);',
  '  -webkit-font-smoothing: antialiased;',
  '  text-rendering: optimizeLegibility;',
  '  isolation: isolate;',
  '}',
  '',
  '.dsn-root :where(button, input, textarea, select) {',
  '  font: inherit;',
  '  color: inherit;',
  '  letter-spacing: inherit;',
  '  margin: 0;',
  '}',
  '',
  '.dsn-root :where(button) {',
  '  cursor: pointer;',
  '  background: none;',
  '  border: 0;',
  '  padding: 0;',
  '  text-align: inherit;',
  '}',
  '',
  '.dsn-root [hidden] {',
  '  display: none !important;',
  '}',
  '',
  '.dsn-root :focus {',
  '  outline: none;',
  '}',
  '',
  '.dsn-root :focus-visible {',
  '  outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6);',
  '  outline-offset: 2px;',
  '}',
  '',
  '.dsn-root ::selection {',
  '  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 24%, transparent);',
  '  color: inherit;',
  '}',
  '',
  '.dsn-sr-only {',
  '  position: absolute;',
  '  width: 1px;',
  '  height: 1px;',
  '  margin: -1px;',
  '  padding: 0;',
  '  overflow: hidden;',
  '  clip: rect(0 0 0 0);',
  '  clip-path: inset(50%);',
  '  white-space: nowrap;',
  '  border: 0;',
  '}',
  '',
  '.dsn-scroll {',
  '  scrollbar-width: thin;',
  '  scrollbar-color: var(--dsw-alias-scrollbar-bg-l2, rgb(229, 229, 229)) transparent;',
  '  overscroll-behavior: contain;',
  '}',
  '',
  '.dsn-scroll::-webkit-scrollbar {',
  '  width: 10px;',
  '  height: 10px;',
  '}',
  '',
  '.dsn-scroll::-webkit-scrollbar-track {',
  '  background: transparent;',
  '}',
  '',
  '.dsn-scroll::-webkit-scrollbar-thumb {',
  '  background: var(--dsw-alias-scrollbar-bg-l2, rgb(229, 229, 229));',
  '  background-clip: padding-box;',
  '  border: 3px solid transparent;',
  '  border-radius: var(--dsn-radius-pill);',
  '}',
  '',
  '.dsn-scroll::-webkit-scrollbar-thumb:hover {',
  '  background: var(--dsw-alias-scrollbar-hover-l2, rgb(212, 212, 212));',
  '  background-clip: padding-box;',
  '}',
  '',
  '/* ---------------------------------------------------------------- */',
  '/* 1. Controls: buttons, icon buttons, inputs, chips, badges, menus   */',
  '/* ---------------------------------------------------------------- */',
  '',
  '.dsn-btn {',
  '  display: inline-flex;',
  '  align-items: center;',
  '  justify-content: center;',
  '  gap: 6px;',
  '  height: 28px;',
  '  padding: 0 10px;',
  '  border: 1px solid transparent;',
  '  border-radius: var(--dsn-radius-control);',
  '  background: transparent;',
  '  color: var(--dsw-alias-label-secondary, #61666b);',
  '  font-size: 12px;',
  '  font-weight: 500;',
  '  line-height: 1;',
  '  white-space: nowrap;',
  '  user-select: none;',
  '  transition: background-color 0.16s ease, color 0.16s ease, border-color 0.16s ease, transform 0.12s ease, opacity 0.16s ease;',
  '}',
  '',
  '.dsn-btn:hover {',
  '  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));',
  '  color: var(--dsw-alias-label-primary, #0f1115);',
  '}',
  '',
  '.dsn-btn:active {',
  '  background: var(--dsw-alias-interactive-bg-active, rgba(38, 49, 72, 0.1));',
  '  transform: translateY(0.5px);',
  '}',
  '',
  '.dsn-btn:disabled,',
  '.dsn-btn[aria-disabled="true"] {',
  '  opacity: 0.45;',
  '  cursor: default;',
  '  transform: none;',
  '}',
  '',
  '.dsn-btn-primary {',
  '  border-color: var(--dsw-alias-brand-primary, #0f1115);',
  '  background: var(--dsw-alias-button-primary-fill, #0f1115);',
  '  color: var(--dsw-alias-label-primary-inverted, #ffffff);',
  '  box-shadow: 0 1px 2px var(--dsw-alias-bg-mask-2, rgba(0, 0, 0, 0.12));',
  '}',
  '',
  '.dsn-btn-primary:hover {',
  '  background: var(--dsw-alias-button-primary-hover, #43454a);',
  '  border-color: var(--dsw-alias-button-primary-hover, #43454a);',
  '  color: var(--dsw-alias-label-primary-inverted, #ffffff);',
  '}',
  '',
  '.dsn-btn-danger {',
  '  color: var(--dsw-alias-state-error-primary, #ec1313);',
  '}',
  '',
  '.dsn-btn-danger:hover {',
  '  background: var(--dsw-alias-interactive-bg-hover-danger, rgba(236, 19, 19, 0.05));',
  '  color: var(--dsw-alias-state-error-primary, #ec1313);',
  '}',
  '',
  '.dsn-btn-tiny {',
  '  height: 22px;',
  '  padding: 0 7px;',
  '  font-size: 11px;',
  '  border-radius: 6px;',
  '}',
  '',
  '.dsn-iconbtn {',
  '  display: inline-flex;',
  '  align-items: center;',
  '  justify-content: center;',
  '  width: 26px;',
  '  height: 26px;',
  '  padding: 0;',
  '  border: 0;',
  '  border-radius: var(--dsn-radius-control);',
  '  background: transparent;',
  '  color: var(--dsw-alias-label-tertiary, #81858c);',
  '  transition: background-color 0.16s ease, color 0.16s ease, transform 0.12s ease;',
  '}',
  '',
  '.dsn-iconbtn:hover {',
  '  background: var(--dsw-alias-button-floating-hover, #f1f3f5);',
  '  color: var(--dsw-alias-label-primary, #0f1115);',
  '}',
  '',
  '.dsn-iconbtn:active {',
  '  transform: scale(0.94);',
  '}',
  '',
  '.dsn-iconbtn.is-active,',
  '.dsn-iconbtn[aria-pressed="true"] {',
  '  background: var(--dsw-alias-button-ghost-active-fill, #ebebeb);',
  '  color: var(--dsw-alias-label-primary, #0f1115);',
  '}',
  '',
  '.dsn-iconbtn:disabled {',
  '  opacity: 0.4;',
  '  cursor: default;',
  '}',
  '',
  '.dsn-iconbtn svg {',
  '  display: block;',
  '  pointer-events: none;',
  '}',
  '',
  '.dsn-btn svg,',
  '.dsn-section-chip svg,',
  '.dsn-tab svg,',
  '.dsn-chip svg {',
  '  display: block;',
  '  flex: 0 0 auto;',
  '  pointer-events: none;',
  '}',
  '',
  '.dsn-input {',
  '  width: 100%;',
  '  height: 28px;',
  '  padding: 0 9px;',
  '  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));',
  '  border-radius: var(--dsn-radius-control);',
  '  background: var(--dsw-alias-bg-module-platform, #f9fafb);',
  '  color: var(--dsw-alias-label-primary, #0f1115);',
  '  font-size: 12px;',
  '  outline: none;',
  '  transition: border-color 0.16s ease, background-color 0.16s ease, box-shadow 0.16s ease;',
  '}',
  '',
  '.dsn-input::placeholder {',
  '  color: var(--dsw-alias-label-caption, #adb2b8);',
  '}',
  '',
  '.dsn-input:focus {',
  '  border-color: var(--dsw-alias-state-business-primary, #4176e6);',
  '  background: var(--dsw-alias-bg-layer-1, #ffffff);',
  '  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 16%, transparent);',
  '}',
  '',
  '.dsn-chip {',
  '  display: inline-flex;',
  '  align-items: center;',
  '  gap: 5px;',
  '  height: 22px;',
  '  padding: 0 8px;',
  '  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));',
  '  border-radius: var(--dsn-radius-pill);',
  '  background: var(--dsw-alias-markdown-tag, #f1f3f5);',
  '  color: var(--dsw-alias-label-secondary, #61666b);',
  '  font-size: 11px;',
  '  font-weight: 500;',
  '  line-height: 1;',
  '  white-space: nowrap;',
  '  max-width: 100%;',
  '  overflow: hidden;',
  '  text-overflow: ellipsis;',
  '}',
  '',
  '.dsn-badge {',
  '  display: inline-flex;',
  '  align-items: center;',
  '  justify-content: center;',
  '  min-width: 18px;',
  '  height: 18px;',
  '  padding: 0 5px;',
  '  border-radius: var(--dsn-radius-pill);',
  '  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));',
  '  color: var(--dsw-alias-label-tertiary, #81858c);',
  '  font-size: 11px;',
  '  font-weight: 600;',
  '  line-height: 1;',
  '  font-variant-numeric: tabular-nums;',
  '}',
  '',
  '.dsn-kbd {',
  '  display: inline-block;',
  '  padding: 0 4px;',
  '  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));',
  '  border-bottom-width: 2px;',
  '  border-radius: 4px;',
  '  background: var(--dsw-alias-markdown-inline-code, #fafafa);',
  '  color: var(--dsw-alias-label-secondary, #61666b);',
  '  font-family: var(--dsn-font-code);',
  '  font-size: 10px;',
  '  line-height: 1.6;',
  '}',
  '',
  '.dsn-divider {',
  '  height: 1px;',
  '  background: var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.04));',
  '}',
  '',
  '/* Hover/focus tooltip driven by data-tip; native title stays as the fallback. */',
  '.dsn-tip {',
  '  position: relative;',
  '}',
  '',
  '.dsn-tip::after {',
  '  content: attr(data-tip);',
  '  position: absolute;',
  '  left: 50%;',
  '  bottom: calc(100% + 6px);',
  '  transform: translate(-50%, 2px);',
  '  z-index: 6;',
  '  padding: 4px 7px;',
  '  border-radius: 6px;',
  '  background: var(--dsw-alias-tooltip-bg, #2c2c2e);',
  '  color: var(--dsw-alias-toast-label, #ffffff);',
  '  font-size: 11px;',
  '  font-weight: 500;',
  '  line-height: 1.35;',
  '  white-space: nowrap;',
  '  pointer-events: none;',
  '  opacity: 0;',
  '  transition: opacity 0.14s ease, transform 0.14s ease;',
  '}',
  '',
  '.dsn-tip:hover::after,',
  '.dsn-tip:focus-visible::after {',
  '  opacity: 1;',
  '  transform: translate(-50%, 0);',
  '}',
  '',
  '.dsn-menu {',
  '  position: absolute;',
  '  z-index: 4;',
  '  min-width: 132px;',
  '  padding: 4px;',
  '  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));',
  '  border-radius: var(--dsn-radius-card);',
  '  background: var(--dsw-alias-bg-layer-2, #ffffff);',
  '  box-shadow: 0 2px 6px var(--dsw-alias-bg-mask-2, rgba(0, 0, 0, 0.12)), 0 14px 34px -14px var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.24));',
  '}',
  '',
  '.dsn-menu-item {',
  '  display: flex;',
  '  align-items: center;',
  '  gap: 8px;',
  '  width: 100%;',
  '  height: 28px;',
  '  padding: 0 8px;',
  '  border: 0;',
  '  border-radius: 7px;',
  '  background: transparent;',
  '  color: var(--dsw-alias-label-secondary, #61666b);',
  '  font-size: 12px;',
  '  text-align: left;',
  '}',
  '',
  '.dsn-menu-item:hover {',
  '  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));',
  '  color: var(--dsw-alias-label-primary, #0f1115);',
  '}',
  '',
  '.dsn-menu-item.is-danger {',
  '  color: var(--dsw-alias-state-error-primary, #ec1313);',
  '}',
  '',
  '.dsn-menu-sep {',
  '  height: 1px;',
  '  margin: 4px 6px;',
  '  background: var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.04));',
  '}',
  '',
  '/* ---------------------------------------------------------------- */',
  '/* 2. Panel shell: frame, header, body, resize handle                 */',
  '/* ---------------------------------------------------------------- */',
  '',
  '.dsn-panel {',
  '  position: fixed;',
  '  z-index: 2147483000;',
  '  display: flex;',
  '  flex-direction: column;',
  '  min-width: 300px;',
  '  min-height: var(--dsn-radius-titlebar);',
  '  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));',
  '  border-radius: var(--dsn-radius-panel);',
  '  background: var(--dsw-alias-bg-layer-1, #ffffff);',
  '  color: var(--dsw-alias-label-primary, #0f1115);',
  '  box-shadow: 0 0 0 1px var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.04)), 0 2px 6px var(--dsw-alias-bg-mask-2, rgba(0, 0, 0, 0.12)), 0 20px 48px -14px var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.24));',
  '  overflow: visible;',
  '  transition: box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1);',
  '}',
  '',
  '@supports (backdrop-filter: blur(1px)) {',
  '  .dsn-panel {',
  '    background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #ffffff) 90%, transparent);',
  '    backdrop-filter: blur(18px) saturate(1.05);',
  '  }',
  '}',
  '',
  '/* One hairline of light along the top edge; the only decorative flourish. */',
  '.dsn-panel::before {',
  '  content: "";',
  '  position: absolute;',
  '  inset: 0 12px auto;',
  '  height: 1px;',
  '  background: linear-gradient(90deg, transparent, var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.12)) 22%, var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.12)) 78%, transparent);',
  '  pointer-events: none;',
  '  z-index: 1;',
  '}',
  '',
  '.dsn-panel.is-dragging {',
  '  transition: none;',
  '  box-shadow: 0 0 0 1px var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.12)), 0 28px 64px -18px var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.24));',
  '}',
  '',
  '/* Collapsed: the header strip is the whole window. */',
  '.dsn-panel.is-collapsed {',
  '  min-height: 0;',
  '}',
  '',
  '.dsn-panel.is-collapsed .dsn-body,',
  '.dsn-panel.is-collapsed .dsn-resize {',
  '  display: none;',
  '}',
  '',
  '.dsn-panel.is-collapsed::before {',
  '  inset: 0 12px auto;',
  '}',
  '',
  '.dsn-panel.is-embedded {',
  '  position: relative;',
  '  inset: auto;',
  '  width: 100%;',
  '  height: 100%;',
  '  min-width: 0;',
  '  border: 0;',
  '  border-radius: 0;',
  '  box-shadow: none;',
  '  background: var(--dsw-alias-bg-layer-1, #ffffff);',
  '}',
  '',
  '.dsn-panel.is-embedded::before {',
  '  display: none;',
  '}',
  '',
  '.dsn-header {',
  '  position: relative;',
  '  z-index: 2;',
  '  flex: 0 0 auto;',
  '  display: flex;',
  '  align-items: center;',
  '  gap: 8px;',
  '  height: var(--dsn-radius-titlebar);',
  '  padding: 0 8px 0 12px;',
  '  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.04));',
  '  border-top-left-radius: var(--dsn-radius-panel);',
  '  border-top-right-radius: var(--dsn-radius-panel);',
  '  background: linear-gradient(180deg, color-mix(in srgb, var(--dsw-alias-bg-layer-1, #ffffff) 94%, transparent), transparent);',
  '  cursor: grab;',
  '  user-select: none;',
  '  touch-action: none;',
  '}',
  '',
  '.dsn-header:active,',
  '.dsn-panel.is-dragging .dsn-header {',
  '  cursor: grabbing;',
  '}',
  '',
  '.dsn-panel.is-collapsed .dsn-header {',
  '  border-bottom-color: transparent;',
  '}',
  '',
  '.dsn-panel.is-embedded .dsn-header {',
  '  cursor: default;',
  '  border-bottom-color: var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));',
  '  padding-right: 12px;',
  '}',
  '',
  '.dsn-panel.is-embedded .dsn-header:active {',
  '  cursor: default;',
  '}',
  '',
  '.dsn-header-icon {',
  '  display: inline-flex;',
  '  align-items: center;',
  '  justify-content: center;',
  '  width: 22px;',
  '  height: 22px;',
  '  border-radius: 7px;',
  '  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));',
  '  color: var(--dsw-alias-label-secondary, #61666b);',
  '  flex: 0 0 auto;',
  '}',
  '',
  '.dsn-header-title {',
  '  font-size: 13px;',
  '  font-weight: 600;',
  '  letter-spacing: 0.01em;',
  '  color: var(--dsw-alias-label-primary, #0f1115);',
  '  white-space: nowrap;',
  '  overflow: hidden;',
  '  text-overflow: ellipsis;',
  '}',
  '',
  '.dsn-header-badge {',
  '  flex: 0 0 auto;',
  '  height: 17px;',
  '  padding: 0 5px;',
  '  border-radius: var(--dsn-radius-pill);',
  '  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));',
  '  color: var(--dsw-alias-label-tertiary, #81858c);',
  '  font-size: 10.5px;',
  '  font-weight: 600;',
  '  line-height: 17px;',
  '  font-variant-numeric: tabular-nums;',
  '}',
  '',
  '.dsn-header-actions {',
  '  display: inline-flex;',
  '  align-items: center;',
  '  gap: 2px;',
  '  margin-left: auto;',
  '  flex: 0 0 auto;',
  '}',
  '',
  '.dsn-body {',
  '  position: relative;',
  '  flex: 1 1 auto;',
  '  min-height: 0;',
  '  display: flex;',
  '  flex-direction: column;',
  '  overflow: hidden;',
  '  border-bottom-left-radius: var(--dsn-radius-panel);',
  '  border-bottom-right-radius: var(--dsn-radius-panel);',
  '}',
  '',
  '.dsn-panel.is-embedded .dsn-body {',
  '  border-radius: 0;',
  '}',
  '',
  '.dsn-resize {',
  '  position: absolute;',
  '  right: 0;',
  '  bottom: 0;',
  '  z-index: 3;',
  '  width: 16px;',
  '  height: 16px;',
  '  color: var(--dsw-alias-label-caption, #adb2b8);',
  '  cursor: nwse-resize;',
  '  touch-action: none;',
  '}',
  '',
  '.dsn-resize::after {',
  '  content: "";',
  '  position: absolute;',
  '  right: 3px;',
  '  bottom: 3px;',
  '  width: 9px;',
  '  height: 9px;',
  '  border-right: 1.5px solid currentColor;',
  '  border-bottom: 1.5px solid currentColor;',
  '  border-bottom-right-radius: 3px;',
  '  opacity: 0.5;',
  '  transition: opacity 0.16s ease;',
  '}',
  '',
  '.dsn-resize:hover {',
  '  color: var(--dsw-alias-label-secondary, #61666b);',
  '}',
  '',
  '.dsn-resize:hover::after,',
  '.dsn-panel.is-resizing .dsn-resize::after {',
  '  opacity: 1;',
  '}',
  '',
  '/* ---------------------------------------------------------------- */',
  '/* 3. Toast + selection chip (also used standalone in the PiP window) */',
  '/* ---------------------------------------------------------------- */',
  '',
  '.dsn-toast-host {',
  '  position: absolute;',
  '  left: 50%;',
  '  bottom: 12px;',
  '  transform: translateX(-50%);',
  '  z-index: 2147483004;',
  '  display: flex;',
  '  flex-direction: column-reverse;',
  '  align-items: center;',
  '  gap: 6px;',
  '  width: max-content;',
  '  max-width: calc(100% - 24px);',
  '  pointer-events: none;',
  '}',
  '',
  '.dsn-panel.is-collapsed .dsn-toast-host {',
  '  top: 100%;',
  '  bottom: auto;',
  '  margin-top: 6px;',
  '}',
  '',
  '.dsn-toast {',
  '  pointer-events: auto;',
  '  display: flex;',
  '  align-items: center;',
  '  gap: 7px;',
  '  max-width: 100%;',
  '  padding: 7px 12px;',
  '  border-radius: 9px;',
  '  background: var(--dsw-alias-toast-bg, #2c2c2e);',
  '  color: var(--dsw-alias-toast-label, #ffffff);',
  '  font-size: 12px;',
  '  font-weight: 500;',
  '  line-height: 1.4;',
  '  box-shadow: 0 0 0 1px var(--dsw-alias-border-inverted, rgba(255, 255, 255, 0.06)), 0 8px 22px -8px var(--dsw-alias-bg-mask-3, rgba(0, 0, 0, 0.48));',
  '  cursor: pointer;',
  '  animation: dsn-toast-in 0.22s cubic-bezier(0.2, 0.8, 0.3, 1) both;',
  '}',
  '',
  '.dsn-toast.is-error {',
  '  background: var(--dsw-alias-state-error-primary, #ec1313);',
  '  color: var(--dsw-alias-toast-label, #ffffff);',
  '}',
  '',
  '.dsn-toast-text {',
  '  min-width: 0;',
  '  overflow: hidden;',
  '  text-overflow: ellipsis;',
  '  white-space: nowrap;',
  '}',
  '',
  '.dsn-toast svg {',
  '  display: block;',
  '  flex: 0 0 auto;',
  '  pointer-events: none;',
  '  opacity: 0.85;',
  '}',
  '',
  '@keyframes dsn-toast-in {',
  '  from { opacity: 0; transform: translateY(8px) scale(0.97); }',
  '  to { opacity: 1; transform: none; }',
  '}',
  '',
  '@keyframes dsn-pop-in {',
  '  from { opacity: 0; transform: translateY(4px) scale(0.96); }',
  '  to { opacity: 1; transform: none; }',
  '}',
  '',
  '.dsn-fade-in {',
  '  animation: dsn-fade-in 0.2s ease both;',
  '}',
  '',
  '@keyframes dsn-fade-in {',
  '  from { opacity: 0; }',
  '  to { opacity: 1; }',
  '}',
  '',
  '/* ---------------------------------------------------------------- */',
  '/* 4. Panel body: toolbar, tabs, search, sections, composer, footer   */',
  '/* ---------------------------------------------------------------- */',
  '',
  '.dsn-app {',
  '  display: flex;',
  '  flex-direction: column;',
  '  height: 100%;',
  '  min-height: 0;',
  '}',
  '',
  '.dsn-toolbar {',
  '  flex: 0 0 auto;',
  '  display: flex;',
  '  align-items: center;',
  '  gap: 8px;',
  '  padding: 10px 12px 8px;',
  '}',
  '',
  '.dsn-tabs {',
  '  display: inline-flex;',
  '  align-items: center;',
  '  gap: 2px;',
  '  padding: 2px;',
  '  border-radius: 9px;',
  '  background: var(--dsw-alias-bg-module-platform, #f9fafb);',
  '  flex: 0 0 auto;',
  '}',
  '',
  '.dsn-tab {',
  '  display: inline-flex;',
  '  align-items: center;',
  '  gap: 5px;',
  '  height: 24px;',
  '  padding: 0 9px;',
  '  border: 0;',
  '  border-radius: 7px;',
  '  background: transparent;',
  '  color: var(--dsw-alias-label-tertiary, #81858c);',
  '  font-size: 12px;',
  '  font-weight: 500;',
  '  line-height: 1;',
  '  white-space: nowrap;',
  '  transition: background-color 0.16s ease, color 0.16s ease, box-shadow 0.16s ease;',
  '}',
  '',
  '.dsn-tab:hover {',
  '  color: var(--dsw-alias-label-primary, #0f1115);',
  '}',
  '',
  '.dsn-tab.is-active {',
  '  background: var(--dsw-alias-bg-layer-1, #ffffff);',
  '  color: var(--dsw-alias-label-primary, #0f1115);',
  '  box-shadow: 0 0 0 1px var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.04)), 0 1px 2px var(--dsw-alias-bg-mask-2, rgba(0, 0, 0, 0.12));',
  '}',
  '',
  '.dsn-tab-count {',
  '  font-size: 10.5px;',
  '  font-weight: 600;',
  '  font-variant-numeric: tabular-nums;',
  '  color: var(--dsw-alias-label-caption, #adb2b8);',
  '}',
  '',
  '.dsn-tab.is-active .dsn-tab-count {',
  '  color: var(--dsw-alias-label-tertiary, #81858c);',
  '}',
  '',
  '.dsn-search {',
  '  position: relative;',
  '  display: flex;',
  '  align-items: center;',
  '  flex: 1 1 auto;',
  '  min-width: 0;',
  '}',
  '',
  '.dsn-search-icon {',
  '  position: absolute;',
  '  left: 8px;',
  '  display: inline-flex;',
  '  color: var(--dsw-alias-label-caption, #adb2b8);',
  '  pointer-events: none;',
  '}',
  '',
  '.dsn-search-input {',
  '  width: 100%;',
  '  height: 28px;',
  '  padding: 0 26px 0 28px;',
  '  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));',
  '  border-radius: 9px;',
  '  background: var(--dsw-alias-bg-module-platform, #f9fafb);',
  '  color: var(--dsw-alias-label-primary, #0f1115);',
  '  font-size: 12px;',
  '  outline: none;',
  '  transition: border-color 0.16s ease, background-color 0.16s ease, box-shadow 0.16s ease;',
  '}',
  '',
  '.dsn-search-input::placeholder {',
  '  color: var(--dsw-alias-label-caption, #adb2b8);',
  '}',
  '',
  '.dsn-search-input:focus {',
  '  border-color: var(--dsw-alias-state-business-primary, #4176e6);',
  '  background: var(--dsw-alias-bg-layer-1, #ffffff);',
  '  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 16%, transparent);',
  '}',
  '',
  '.dsn-search-clear {',
  '  position: absolute;',
  '  right: 3px;',
  '  display: inline-flex;',
  '  align-items: center;',
  '  justify-content: center;',
  '  width: 22px;',
  '  height: 22px;',
  '  border: 0;',
  '  border-radius: 6px;',
  '  background: transparent;',
  '  color: var(--dsw-alias-label-caption, #adb2b8);',
  '}',
  '',
  '.dsn-search-clear:hover {',
  '  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));',
  '  color: var(--dsw-alias-label-primary, #0f1115);',
  '}',
  '',
  '.dsn-sections {',
  '  flex: 0 0 auto;',
  '  display: flex;',
  '  flex-wrap: wrap;',
  '  align-items: center;',
  '  gap: 6px;',
  '  row-gap: 6px;',
  '  padding: 0 12px 8px;',
  '  max-height: 92px;',
  '  overflow-y: auto;',
  '  scrollbar-width: none;',
  '}',
  '',
  '.dsn-sections::-webkit-scrollbar {',
  '  display: none;',
  '}',
  '',
  '.dsn-section-chip {',
  '  display: inline-flex;',
  '  align-items: center;',
  '  gap: 6px;',
  '  flex: 0 0 auto;',
  '  height: 26px;',
  '  padding: 0 10px;',
  '  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));',
  '  border-radius: var(--dsn-radius-pill);',
  '  background: transparent;',
  '  color: var(--dsw-alias-label-secondary, #61666b);',
  '  font-size: 12px;',
  '  font-weight: 500;',
  '  line-height: 1;',
  '  white-space: nowrap;',
  '  user-select: none;',
  '  transition: background-color 0.16s ease, color 0.16s ease, border-color 0.16s ease, transform 0.12s ease, box-shadow 0.16s ease;',
  '}',
  '',
  '.dsn-section-chip:hover {',
  '  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));',
  '  color: var(--dsw-alias-label-primary, #0f1115);',
  '}',
  '',
  '.dsn-section-chip.is-active {',
  '  border-color: var(--dsw-alias-brand-primary, #0f1115);',
  '  background: var(--dsw-alias-brand-primary, #0f1115);',
  '  color: var(--dsw-alias-label-primary-inverted, #ffffff);',
  '  box-shadow: 0 1px 3px var(--dsw-alias-bg-mask-2, rgba(0, 0, 0, 0.12));',
  '}',
  '',
  '.dsn-section-chip.is-over {',
  '  border-color: var(--dsw-alias-state-business-primary, #4176e6);',
  '  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 12%, transparent);',
  '  color: var(--dsw-alias-label-primary, #0f1115);',
  '  transform: translateY(-1px);',
  '}',
  '',
  '.dsn-section-chip.is-add {',
  '  border-style: dashed;',
  '  color: var(--dsw-alias-label-tertiary, #81858c);',
  '}',
  '',
  '.dsn-section-count {',
  '  display: inline-flex;',
  '  align-items: center;',
  '  justify-content: center;',
  '  min-width: 16px;',
  '  height: 16px;',
  '  padding: 0 4px;',
  '  border-radius: var(--dsn-radius-pill);',
  '  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));',
  '  color: var(--dsw-alias-label-caption, #adb2b8);',
  '  font-size: 10px;',
  '  font-weight: 600;',
  '  font-variant-numeric: tabular-nums;',
  '}',
  '',
  '.dsn-section-chip.is-active .dsn-section-count {',
  '  background: color-mix(in srgb, var(--dsw-alias-label-primary-inverted, #ffffff) 22%, transparent);',
  '  color: inherit;',
  '}',
  '',
  '.dsn-composer {',
  '  flex: 0 0 auto;',
  '  margin: 0 12px 10px;',
  '  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));',
  '  border-radius: 12px;',
  '  background: var(--dsw-alias-bg-layer-1, #ffffff);',
  '  box-shadow: 0 1px 2px var(--dsw-alias-bg-mask-2, rgba(0, 0, 0, 0.12));',
  '  transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease, background-color 0.18s ease;',
  '}',
  '',
  '.dsn-composer:focus-within {',
  '  border-color: var(--dsw-alias-state-business-primary, #4176e6);',
  '  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 14%, transparent), 0 2px 6px var(--dsw-alias-bg-mask-2, rgba(0, 0, 0, 0.12));',
  '}',
  '',
  '.dsn-composer.is-over {',
  '  border-color: var(--dsw-alias-state-business-primary, #4176e6);',
  '  border-style: dashed;',
  '  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 6%, var(--dsw-alias-bg-layer-1, #ffffff));',
  '  transform: translateY(-1px);',
  '}',
  '',
  '.dsn-composer-foot {',
  '  display: flex;',
  '  align-items: center;',
  '  gap: 8px;',
  '  padding: 6px 8px 8px;',
  '}',
  '',
  '.dsn-composer-hint {',
  '  flex: 1 1 auto;',
  '  min-width: 0;',
  '  font-size: 11px;',
  '  color: var(--dsw-alias-label-caption, #adb2b8);',
  '  white-space: nowrap;',
  '  overflow: hidden;',
  '  text-overflow: ellipsis;',
  '}',
  '',
  '.dsn-stream {',
  '  flex: 1 1 auto;',
  '  min-height: 0;',
  '  display: flex;',
  '  flex-direction: column;',
  '  gap: 8px;',
  '  padding: 2px 12px 12px;',
  '  overflow-x: hidden;',
  '  overflow-y: auto;',
  '}',
  '',
  '.dsn-footer {',
  '  flex: 0 0 auto;',
  '  display: flex;',
  '  align-items: center;',
  '  flex-wrap: nowrap;',
  '  gap: 8px;',
  '  padding: 7px 12px;',
  '  border-top: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.04));',
  '  background: color-mix(in srgb, var(--dsw-alias-bg-module-platform, #f9fafb) 45%, transparent);',
  '  color: var(--dsw-alias-label-caption, #adb2b8);',
  '  font-size: 11px;',
  '  line-height: 1.5;',
  '  overflow: hidden;',
  '}',
  '',
  '.dsn-footer > span:not(.dsn-footer-hint) {',
  '  flex: none;',
  '  white-space: nowrap;',
  '}',
  '',
  '.dsn-footer-hint {',
  '  margin-left: auto;',
  '  flex: 0 1 auto;',
  '  min-width: 0;',
  '  overflow: hidden;',
  '  text-overflow: ellipsis;',
  '  white-space: nowrap;',
  '}',
  '',
  '.dsn-sync {',
  '  display: inline-flex;',
  '  align-items: center;',
  '  gap: 5px;',
  '  flex: none;',
  '  max-width: 45%;',
  '  margin: 0;',
  '  padding: 2px 7px 2px 6px;',
  '  border: none;',
  '  border-radius: 999px;',
  '  background: transparent;',
  '  color: inherit;',
  '  font: inherit;',
  '  cursor: pointer;',
  '  transition: background-color 0.15s ease, color 0.15s ease;',
  '}',
  '',
  '.dsn-sync:hover {',
  '  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));',
  '  color: var(--dsw-alias-label-secondary, rgba(27, 27, 31, 0.62));',
  '}',
  '',
  '.dsn-sync:focus-visible {',
  '  outline: 2px solid var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.16));',
  '  outline-offset: 1px;',
  '}',
  '',
  '.dsn-sync-dot {',
  '  flex: none;',
  '  width: 6px;',
  '  height: 6px;',
  '  border-radius: 50%;',
  '  background: currentColor;',
  '  opacity: 0.55;',
  '}',
  '',
  '.dsn-sync-label {',
  '  min-width: 0;',
  '  overflow: hidden;',
  '  text-overflow: ellipsis;',
  '  white-space: nowrap;',
  '}',
  '',
  '.dsn-sync--saved .dsn-sync-dot {',
  '  background: var(--dsw-alias-state-business-primary, #4176e6);',
  '  opacity: 1;',
  '}',
  '',
  '.dsn-sync--saving .dsn-sync-dot,',
  '.dsn-sync--loading .dsn-sync-dot {',
  '  background: var(--dsw-alias-state-business-primary, #4176e6);',
  '  opacity: 0.5;',
  '}',
  '',
  '.dsn-sync--error {',
  '  color: var(--dsw-alias-label-error, #d92626);',
  '}',
  '',
  '.dsn-sync--error .dsn-sync-dot {',
  '  background: var(--dsw-alias-label-error, #d92626);',
  '  opacity: 1;',
  '}',
  '',
  '.dsn-sync--local .dsn-sync-dot {',
  '  background: var(--dsw-alias-label-warning, #c98a12);',
  '  opacity: 1;',
  '}',
  '',
  '/* ---------------------------------------------------------------- */',
  '/* 5. Note cards                                                      */',
  '/* ---------------------------------------------------------------- */',
  '',
  '.dsn-note {',
  '  position: relative;',
  '  flex: 0 0 auto;',
  '  display: flex;',
  '  flex-direction: column;',
  '  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));',
  '  border-radius: var(--dsn-radius-card);',
  '  background: var(--dsw-alias-bg-layer-1, #ffffff);',
  '  box-shadow: 0 1px 2px var(--dsw-alias-bg-mask-2, rgba(0, 0, 0, 0.12));',
  '  outline: none;',
  '  transition: box-shadow 0.18s ease, border-color 0.18s ease, transform 0.18s ease, opacity 0.18s ease;',
  '}',
  '',
  '.dsn-note:hover {',
  '  transform: translateY(-1px);',
  '  border-color: var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.12));',
  '  box-shadow: 0 2px 4px var(--dsw-alias-bg-mask-2, rgba(0, 0, 0, 0.12)), 0 14px 26px -16px var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.24));',
  '}',
  '',
  '.dsn-note:focus-visible {',
  '  border-color: var(--dsw-alias-state-business-primary, #4176e6);',
  '}',
  '',
  '.dsn-note.is-dragging {',
  '  opacity: 0.5;',
  '  transform: scale(0.985);',
  '}',
  '',
  '.dsn-note.is-pinned {',
  '  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #0f1115) 22%, var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1)));',
  '  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #0f1115) 3.5%, var(--dsw-alias-bg-layer-1, #ffffff));',
  '}',
  '',
  '/* Pinned accent: a 2px marker on the leading edge. */',
  '.dsn-note.is-pinned::before {',
  '  content: "";',
  '  position: absolute;',
  '  left: -1px;',
  '  top: 9px;',
  '  bottom: 9px;',
  '  width: 2px;',
  '  border-radius: 2px;',
  '  background: var(--dsw-alias-brand-primary, #0f1115);',
  '}',
  '',
  '.dsn-note-head {',
  '  display: flex;',
  '  align-items: center;',
  '  gap: 6px;',
  '  min-height: 26px;',
  '  padding: 7px 8px 0 10px;',
  '}',
  '',
  '.dsn-note-kind {',
  '  display: inline-flex;',
  '  align-items: center;',
  '  gap: 4px;',
  '  height: 18px;',
  '  padding: 0 6px;',
  '  border-radius: 5px;',
  '  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));',
  '  color: var(--dsw-alias-label-tertiary, #81858c);',
  '  font-size: 10px;',
  '  font-weight: 600;',
  '  letter-spacing: 0.02em;',
  '  line-height: 1;',
  '  text-transform: uppercase;',
  '  white-space: nowrap;',
  '}',
  '',
  '.dsn-note-kind svg {',
  '  display: block;',
  '  opacity: 0.9;',
  '}',
  '',
  '.dsn-note-age {',
  '  font-size: 11px;',
  '  color: var(--dsw-alias-label-caption, #adb2b8);',
  '  font-variant-numeric: tabular-nums;',
  '  white-space: nowrap;',
  '}',
  '',
  '.dsn-note-flag {',
  '  display: inline-flex;',
  '  align-items: center;',
  '  gap: 3px;',
  '  height: 17px;',
  '  padding: 0 6px 0 5px;',
  '  border-radius: 999px;',
  '  font-size: 10.5px;',
  '  font-weight: 600;',
  '  color: var(--dsw-alias-state-business-primary, #4176e6);',
  '  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 12%, transparent);',
  '  white-space: nowrap;',
  '}',
  '',
  '/* Hover action row: hidden until the card is hovered or focused. */',
  '.dsn-note-actions {',
  '  display: flex;',
  '  align-items: center;',
  '  gap: 1px;',
  '  margin-left: auto;',
  '  opacity: 0;',
  '  transform: translateY(-1px);',
  '  transition: opacity 0.16s ease, transform 0.16s ease;',
  '}',
  '',
  '.dsn-note:hover .dsn-note-actions,',
  '.dsn-note:focus-within .dsn-note-actions,',
  '.dsn-note.is-focused .dsn-note-actions {',
  '  opacity: 1;',
  '  transform: none;',
  '}',
  '',
  '.dsn-note-actions .dsn-iconbtn {',
  '  width: 22px;',
  '  height: 22px;',
  '  border-radius: 6px;',
  '}',
  '',
  '.dsn-note-actions .dsn-iconbtn.is-active {',
  '  color: var(--dsw-alias-state-business-primary, #4176e6);',
  '  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 12%, transparent);',
  '}',
  '',
  '.dsn-note-body {',
  '  position: relative;',
  '  padding: 5px 10px 8px;',
  '  color: var(--dsw-alias-label-primary, #0f1115);',
  '  font-size: 12.5px;',
  '  line-height: 1.55;',
  '}',
  '',
  '/* 8 lines (8 x 1.55em) then a gradient fade instead of a hard cut. */',
  '.dsn-note-clamp {',
  '  position: relative;',
  '  max-height: 12.4em;',
  '  overflow: hidden;',
  '}',
  '',
  '/* Only content that actually overflows fades out; short notes stay crisp. */',
  '.dsn-note-clamp.is-clamped {',
  '  -webkit-mask-image: linear-gradient(to bottom, currentColor 66%, transparent 100%);',
  '  mask-image: linear-gradient(to bottom, currentColor 66%, transparent 100%);',
  '}',
  '',
  '.dsn-note-clamp.is-expanded {',
  '  max-height: none;',
  '  -webkit-mask-image: none;',
  '  mask-image: none;',
  '}',
  '',
  '.dsn-note-expand {',
  '  display: inline-flex;',
  '  align-items: center;',
  '  gap: 4px;',
  '  margin-top: 3px;',
  '  padding: 0;',
  '  border: 0;',
  '  background: transparent;',
  '  color: var(--dsw-alias-state-business-primary, #4176e6);',
  '  font-size: 11px;',
  '  font-weight: 500;',
  '}',
  '',
  '.dsn-note-expand:hover {',
  '  text-decoration: underline;',
  '}',
  '',
  '.dsn-note-foot {',
  '  display: flex;',
  '  align-items: center;',
  '  gap: 6px;',
  '  padding: 0 10px 8px;',
  '  min-width: 0;',
  '}',
  '',
  '.dsn-note-source {',
  '  max-width: 100%;',
  '  overflow: hidden;',
  '  text-overflow: ellipsis;',
  '  white-space: nowrap;',
  '  color: var(--dsw-alias-label-caption, #adb2b8);',
  '}',
  '',
  '.dsn-note-edit {',
  '  padding: 2px 8px 8px;',
  '}',
  '',
  '.dsn-note-editbar {',
  '  display: flex;',
  '  align-items: center;',
  '  gap: 6px;',
  '  padding: 0 2px;',
  '}',
  '',
  '/* ---------------------------------------------------------------- */',
  '/* 6. Drop zones, empty states, skeletons                             */',
  '/* ---------------------------------------------------------------- */',
  '',
  '.dsn-dropzone {',
  '  flex: 0 0 auto;',
  '  display: flex;',
  '  align-items: center;',
  '  justify-content: center;',
  '  gap: 8px;',
  '  margin: 0 12px 8px;',
  '  height: 34px;',
  '  border: 1.5px dashed var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.12));',
  '  border-radius: var(--dsn-radius-card);',
  '  color: var(--dsw-alias-label-tertiary, #81858c);',
  '  font-size: 12px;',
  '  font-weight: 500;',
  '  background: transparent;',
  '  transition: border-color 0.16s ease, background-color 0.16s ease, color 0.16s ease, transform 0.16s ease;',
  '}',
  '',
  '.dsn-dropzone.is-over {',
  '  border-color: var(--dsw-alias-state-error-primary, #ec1313);',
  '  background: var(--dsw-alias-interactive-bg-hover-danger, rgba(236, 19, 19, 0.05));',
  '  color: var(--dsw-alias-state-error-primary, #ec1313);',
  '  transform: scale(1.01);',
  '}',
  '',
  '.dsn-stream.is-drop-target {',
  '  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 4%, transparent);',
  '}',
  '',
  '.dsn-empty {',
  '  display: flex;',
  '  flex-direction: column;',
  '  align-items: center;',
  '  justify-content: center;',
  '  gap: 8px;',
  '  padding: 30px 22px;',
  '  text-align: center;',
  '  color: var(--dsw-alias-label-tertiary, #81858c);',
  '  font-size: 12px;',
  '  line-height: 1.6;',
  '}',
  '',
  '.dsn-empty-icon {',
  '  display: inline-flex;',
  '  align-items: center;',
  '  justify-content: center;',
  '  width: 34px;',
  '  height: 34px;',
  '  border-radius: 10px;',
  '  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));',
  '  color: var(--dsw-alias-label-caption, #adb2b8);',
  '}',
  '',
  '.dsn-empty-text {',
  '  max-width: 26em;',
  '}',
  '',
  '.dsn-loading {',
  '  display: flex;',
  '  align-items: center;',
  '  justify-content: center;',
  '  gap: 8px;',
  '  flex: 1 1 auto;',
  '  padding: 26px 18px;',
  '  color: var(--dsw-alias-label-caption, #adb2b8);',
  '  font-size: 12px;',
  '  animation: dsn-breathe 1.6s ease-in-out infinite;',
  '}',
  '',
  '@keyframes dsn-breathe {',
  '  0%, 100% { opacity: 0.55; }',
  '  50% { opacity: 1; }',
  '}',
  '',
  '/* ---------------------------------------------------------------- */',
  '/* 7. Companion classes for DSN.Content and DSN.Editor                */',
  '/*    (30-content.js owns the markup; these rules are additive only)   */',
  '/* ---------------------------------------------------------------- */',
  '',
  '.dsn-content strong,',
  '.dsn-content b {',
  '  font-weight: 600;',
  '}',
  '',
  '.dsn-content samp {',
  '  padding: 0.08em 0.34em;',
  '  border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.04));',
  '  border-radius: 4px;',
  '  background: var(--dsw-alias-markdown-inline-code, #fafafa);',
  '  font-family: var(--dsn-font-code);',
  '  font-size: 0.92em;',
  '}',
  '',
  '.dsn-content-scroll {',
  '  max-width: 100%;',
  '  overflow-x: auto;',
  '  overscroll-behavior-x: contain;',
  '}',
  '',
  '.dsn-content-scroll > :first-child {',
  '  margin-top: 0;',
  '}',
  '',
  '.dsn-content-scroll > :last-child {',
  '  margin-bottom: 0;',
  '}',
  '',
  '/* Rich text editor: same flow as the rendered content, plus a placeholder. */',
  '.dsn-editor {',
  '  cursor: text;',
  '}',
  '',
  '.dsn-editor:focus-visible {',
  '  outline: none;',
  '}',
  '',
  '.dsn-editor[data-empty="true"]::before {',
  '  text-overflow: ellipsis;',
  '}',
  '',
  '.dsn-editor:empty::after {',
  '  content: "";',
  '}',
  '',
  '/* ---------------------------------------------------------------- */',
  '/* 8. Theme independence and reduced motion                           */',
  '/* ---------------------------------------------------------------- */',
  '',
  '/* Token values are copied into the PiP document, so the plugin follows',
  '   whatever theme the host resolved. A surface that must NOT follow the',
  '   surrounding document can pin its own appearance with data-dsn-theme:',
  '   the subtree redeclares the aliases it reads, and nothing outside the',
  '   subtree changes. */',
  '',
  ".dsn-root[data-dsn-theme='light'] {",
  '  color-scheme: light;',
  '  --dsw-alias-bg-base: rgb(255, 255, 255);',
  '  --dsw-alias-bg-layer-1: rgb(255, 255, 255);',
  '  --dsw-alias-bg-layer-2: rgb(255, 255, 255);',
  '  --dsw-alias-bg-overlay: rgb(233, 236, 242);',
  '  --dsw-alias-bg-module-platform: rgb(249, 250, 251);',
  '  --dsw-alias-bg-skeleton: rgba(0, 0, 0, 0.04);',
  '  --dsw-alias-label-primary: rgb(15, 17, 21);',
  '  --dsw-alias-label-secondary: rgb(97, 102, 107);',
  '  --dsw-alias-label-tertiary: rgb(129, 133, 140);',
  '  --dsw-alias-label-caption: rgb(173, 178, 184);',
  '  --dsw-alias-label-primary-inverted: rgb(255, 255, 255);',
  '  --dsw-alias-border-l1: rgba(0, 0, 0, 0.04);',
  '  --dsw-alias-border-l2: rgba(0, 0, 0, 0.1);',
  '  --dsw-alias-border-l3: rgba(0, 0, 0, 0.12);',
  '  --dsw-alias-border-l4: rgba(0, 0, 0, 0.16);',
  '  --dsw-alias-interactive-bg-hover: rgba(38, 49, 72, 0.06);',
  '  --dsw-alias-interactive-bg-active: rgba(38, 49, 72, 0.1);',
  '  --dsw-alias-button-floating-fill: rgb(255, 255, 255);',
  '  --dsw-alias-interactive-bg-hover-danger: rgba(236, 19, 19, 0.05);',
  '  --dsw-alias-brand-primary: rgb(15, 17, 21);',
  '  --dsw-alias-button-primary-fill: rgb(15, 17, 21);',
  '  --dsw-alias-button-primary-hover: rgb(67, 69, 74);',
  '  --dsw-alias-button-floating-hover: rgb(241, 243, 245);',
  '  --dsw-alias-button-ghost-active-fill: rgb(235, 238, 242);',
  '  --dsw-alias-toast-bg: rgb(53, 54, 56);',
  '  --dsw-alias-toast-label: rgb(255, 255, 255);',
  '  --dsw-alias-tooltip-bg: rgb(44, 44, 46);',
  '  --dsw-alias-scrollbar-bg-l2: rgb(229, 229, 229);',
  '  --dsw-alias-scrollbar-hover-l2: rgb(212, 212, 212);',
  '  --dsw-alias-markdown-inline-code: rgb(250, 250, 250);',
  '  --dsw-alias-markdown-tag: rgb(241, 243, 245);',
  '}',
  '',
  ".dsn-root[data-dsn-theme='dark'] {",
  '  color-scheme: dark;',
  '  --dsw-alias-bg-base: rgb(21, 21, 23);',
  '  --dsw-alias-bg-layer-1: rgb(35, 35, 36);',
  '  --dsw-alias-bg-layer-2: rgb(44, 44, 46);',
  '  --dsw-alias-bg-overlay: rgb(97, 102, 107);',
  '  --dsw-alias-bg-module-platform: rgb(53, 54, 56);',
  '  --dsw-alias-bg-skeleton: rgba(255, 255, 255, 0.08);',
  '  --dsw-alias-label-primary: rgb(249, 250, 251);',
  '  --dsw-alias-label-secondary: rgb(207, 211, 214);',
  '  --dsw-alias-label-tertiary: rgb(173, 178, 184);',
  '  --dsw-alias-label-caption: rgb(129, 133, 140);',
  '  --dsw-alias-label-primary-inverted: rgb(53, 54, 56);',
  '  --dsw-alias-border-l1: rgba(255, 255, 255, 0.06);',
  '  --dsw-alias-border-l2: rgba(255, 255, 255, 0.12);',
  '  --dsw-alias-border-l3: rgba(255, 255, 255, 0.16);',
  '  --dsw-alias-border-l4: rgba(255, 255, 255, 0.2);',
  '  --dsw-alias-interactive-bg-hover: rgba(255, 255, 255, 0.08);',
  '  --dsw-alias-interactive-bg-active: rgba(255, 255, 255, 0.14);',
  '  --dsw-alias-button-floating-fill: rgb(44, 44, 46);',
  '  --dsw-alias-interactive-bg-hover-danger: rgba(242, 90, 90, 0.15);',
  '  --dsw-alias-brand-primary: rgb(249, 250, 251);',
  '  --dsw-alias-button-primary-fill: rgb(249, 250, 251);',
  '  --dsw-alias-button-primary-hover: rgb(235, 238, 242);',
  '  --dsw-alias-button-floating-hover: rgb(53, 54, 56);',
  '  --dsw-alias-button-ghost-active-fill: rgb(67, 69, 74);',
  '  --dsw-alias-toast-bg: rgb(67, 69, 74);',
  '  --dsw-alias-toast-label: rgb(255, 255, 255);',
  '  --dsw-alias-tooltip-bg: rgb(67, 69, 74);',
  '  --dsw-alias-scrollbar-bg-l2: rgb(84, 85, 87);',
  '  --dsw-alias-scrollbar-hover-l2: rgb(101, 103, 107);',
  '  --dsw-alias-markdown-inline-code: rgb(41, 41, 41);',
  '  --dsw-alias-markdown-tag: rgb(44, 44, 46);',
  '}',
  '',
  '/* The picture-in-picture document has no host stylesheet at all. */',
  'body.dsn-pip {',
  '  margin: 0;',
  '  height: 100vh;',
  '  overflow: hidden;',
  '  background: var(--dsw-alias-bg-base, #ffffff);',
  '  color: var(--dsw-alias-label-primary, #0f1115);',
  '  font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif);',
  '  -webkit-font-smoothing: antialiased;',
  '}',
  '',
  'body.dsn-pip .dsn-pip-root {',
  '  display: flex;',
  '  width: 100%;',
  '  height: 100%;',
  '  min-height: 0;',
  '}',
  '',
  '@media (prefers-reduced-motion: reduce) {',
  '  .dsn-root *,',
  '  .dsn-root *::before,',
  '  .dsn-root *::after {',
  '    animation-duration: 0.01ms !important;',
  '    animation-iteration-count: 1 !important;',
  '    transition-duration: 0.01ms !important;',
  '    scroll-behavior: auto !important;',
  '  }',
  '}',
  '',
  '/* ------------------------------------------------------------------ */',
  '/* Compatibility bridge.                                            */',
  '/*                                                                 */',
  '/* The board, capture and sidebar fragments reference a handful of  */',
  '/* alias names this host does not ship (bg-secondary, brand-soft,   */',
  '/* border-default, label-on-brand, ...). Left undefined they always */',
  '/* paint their literal fallback -- a light-mode colour inside a dark */',
  '/* panel: invisible fills, white cards, white-on-white buttons.      */',
  '/* Defining them here in token terms puts those subtrees back on the */',
  '/* live theme without touching their files. Every value is derived   */',
  '/* from a real token, so light/dark/high-contrast follow for free;   */',
  '/* a real token is never redefined.                                  */',
  '/* ------------------------------------------------------------------ */',
  '.dsn-root,',
  '.dsn-pip-root,',
  '.dsn-chip-layer,',
  '.dsn-capture-chip,',
  '.dsn-capture-action {',
  '  --dsw-alias-bg-secondary: color-mix(in srgb, var(--dsw-alias-label-primary, #0f1115) 5%, transparent);',
  '  --dsw-alias-bg-tertiary: color-mix(in srgb, var(--dsw-alias-label-primary, #0f1115) 8%, transparent);',
  '  --dsw-alias-border-subtle: var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.04));',
  '  --dsw-alias-border-default: var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.12));',
  '  --dsw-alias-border-focus: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 55%, transparent);',
  '  --dsw-alias-brand-soft: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 12%, transparent);',
  '  --dsw-alias-brand-primary-hover: var(--dsw-alias-button-primary-hover, rgb(67, 69, 74));',
  '  --dsw-alias-label-error: var(--dsw-alias-state-error-primary, #ec1313);',
  '  --dsw-alias-danger-soft: color-mix(in srgb, var(--dsw-alias-state-error-primary, #ec1313) 12%, transparent);',
  '  --dsw-alias-label-on-brand: var(--dsw-alias-label-primary-inverted, #ffffff);',
  '  --dsw-alias-shadow-overlay: var(--dsw-alias-bg-mask-2, rgba(0, 0, 0, 0.12));',
  '}',
].join('\n')

DSN.addCss('base', DSN.CSS.base)

/* ================= 45-panel.js ================= */
/* ------------------------------------------------------------------ *
 * Panel chrome: the floating window, its toast host, and the store hook.
 *
 * DSN.Panel is the only component 90-apply.js mounts into the shell
 * overlay. Everything inside its body comes from the board fragment and
 * is resolved lazily at render time, so fragment load order never
 * matters. Everything visual comes from the `base` CSS chunk.
 *
 * The PiP window mounts the very same DSN.Panel with embedded:true: no
 * floating geometry, no drag, no collapse, no PiP toggle — it fills the
 * container the PiP document gives it.
 * ------------------------------------------------------------------ */

DSN.addStrings(
  {
    'panel.resize': '拖动调整大小',
    'panel.loading': '正在载入便签…',
  },
  {
    'panel.resize': 'Drag to resize',
    'panel.loading': 'Loading notes…',
  }
)

;(function () {
  var MARGIN = 8
  var MIN_W = 300
  var MIN_H = 220
  var HEADER_H = 44
  var DEFAULT_W = 400
  var MAX_H = 620
  var DRAG_THRESHOLD = 3

  /* -------------------------------------------------------------- *
   * Geometry: pure helpers over a {w,h} viewport box.
   * -------------------------------------------------------------- */

  function viewportSize() {
    var w = 1024
    var h = 768
    try {
      var doc = document
      w = window.innerWidth || (doc && doc.documentElement && doc.documentElement.clientWidth) || w
      h = window.innerHeight || (doc && doc.documentElement && doc.documentElement.clientHeight) || h
    } catch (error) { DSN.log('viewport read failed', error) }
    return { w: Math.max(320, Math.round(w)), h: Math.max(240, Math.round(h)) }
  }

  function clampRect(rect, viewport) {
    var source = rect || {}
    if (!viewport) viewport = viewportSize()
    var maxW = Math.max(MIN_W, viewport.w - MARGIN * 2)
    var maxH = Math.max(MIN_H, viewport.h - MARGIN * 2)
    var w = DSN.clamp(Math.round(source.w || DEFAULT_W), MIN_W, maxW)
    var h = DSN.clamp(Math.round(source.h || MAX_H), MIN_H, maxH)
    var x = DSN.clamp(Math.round(source.x || 0), MARGIN, Math.max(MARGIN, viewport.w - w - MARGIN))
    var y = DSN.clamp(Math.round(source.y || 0), MARGIN, Math.max(MARGIN, viewport.h - h - MARGIN))
    return { x: x, y: y, w: w, h: h }
  }

  function defaultRect(viewport) {
    if (!viewport) viewport = viewportSize()
    var w = Math.min(DEFAULT_W, Math.max(MIN_W, viewport.w - MARGIN * 2))
    var h = DSN.clamp(Math.min(MAX_H, viewport.h - 120), MIN_H, MAX_H)
    var x = viewport.w - w - MARGIN
    var y = Math.round((viewport.h - h) / 2)
    return clampRect({ x: x, y: y, w: w, h: h }, viewport)
  }

  function resolveRect(stored, viewport) {
    if (stored && typeof stored === 'object' && typeof stored.w === 'number' && typeof stored.h === 'number') {
      return clampRect(stored, viewport)
    }
    return defaultRect(viewport)
  }

  /* The pip fragment is concatenated after this one, so every reference
     to it is resolved when a handler runs, never while loading. */
  function pipSupportedNow() {
    try {
      return typeof DSN.pipSupported === 'function' ? !!DSN.pipSupported() : false
    } catch (error) {
      DSN.log('pipSupported failed', error)
      return false
    }
  }

  function pipOpenNow() {
    try {
      return typeof DSN.isPipOpen === 'function' ? !!DSN.isPipOpen() : false
    } catch (error) {
      DSN.log('isPipOpen failed', error)
      return false
    }
  }

  function pipEventName() {
    return DSN.PIP_EVENT || 'dsn:pipchange'
  }

  /** True when the pointer landed on a control that must not start a drag. */
  function isControl(node) {
    return !!DSN.closest(node, 'button, a, input, textarea, select, [data-dsn-nodrag]')
  }

  function iconButton(h, name, label, onClick, state) {
    var pressed = state == null ? undefined : state ? 'true' : 'false'
    return h(
      'button',
      {
        type: 'button',
        className: 'dsn-iconbtn' + (state ? ' is-active' : ''),
        title: label,
        'aria-label': label,
        'aria-pressed': pressed,
        onClick: onClick,
      },
      h(DSN.Icon, { name: name, size: 14 })
    )
  }

  DSN._geometry = {
    MARGIN: MARGIN,
    MIN_W: MIN_W,
    MIN_H: MIN_H,
    HEADER_H: HEADER_H,
    DEFAULT_W: DEFAULT_W,
    MAX_H: MAX_H,
    DRAG_THRESHOLD: DRAG_THRESHOLD,
    viewportSize: viewportSize,
    clampRect: clampRect,
    defaultRect: defaultRect,
    resolveRect: resolveRect,
    pipSupportedNow: pipSupportedNow,
    pipOpenNow: pipOpenNow,
    pipEventName: pipEventName,
    isControl: isControl,
    iconButton: iconButton,
  }
})()

/* ------------------------------------------------------------------ *
 * Store subscription: the one place that turns model state into render
 * state. Components below never subscribe on their own.
 * ------------------------------------------------------------------ */

DSN.useStore = function useStore(store) {
  var React = DSN.React
  var subscribe = React.useCallback(
    function (notify) {
      return store.subscribe(notify)
    },
    [store]
  )
  var read = React.useCallback(function () {
    return store.getSnapshot()
  }, [store])
  return React.useSyncExternalStore(subscribe, read, read)
}

/* ------------------------------------------------------------------ *
 * Toast host. Subscribes to the shared bus, keeps at most 3 stacked
 * entries and clears each one after 2.6 s. Standalone by design: it
 * needs nothing but `t`, so the PiP window can mount it as well.
 * ------------------------------------------------------------------ */

DSN.ToastHost = function ToastHost(props) {
  var React = DSN.React
  var h = DSN.h
  var pair = React.useState([])
  var items = pair[0]
  var setItems = pair[1]

  React.useEffect(function () {
    var MAX_TOASTS = 3
    var DISMISS_MS = 2600
    var timers = {}

    function clearTimer(id) {
      if (timers[id]) {
        clearTimeout(timers[id])
        delete timers[id]
      }
    }

    function removeById(id) {
      clearTimer(id)
      setItems(function (prev) {
        var next = []
        for (var i = 0; i < prev.length; i++) if (prev[i].id !== id) next.push(prev[i])
        return next.length === prev.length ? prev : next
      })
    }

    function schedule(id) {
      clearTimer(id)
      timers[id] = setTimeout(function () {
        delete timers[id]
        removeById(id)
      }, DISMISS_MS)
    }

    var off = DSN.bus.subscribe(function (event) {
      if (!event || event.type !== 'toast' || !event.text) return
      if (event.duration === 0) return
      var text = String(event.text)
      var kind = event.kind === 'error' ? 'error' : 'info'
      var item = { id: event.id ? String(event.id) : DSN.uid('toast'), text: text, kind: kind }
      setItems(function (prev) {
        var next = []
        for (var i = 0; i < prev.length; i++) {
          if (prev[i].text !== text || prev[i].kind !== kind) next.push(prev[i])
        }
        next.push(item)
        return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next
      })
      schedule(item.id)
    })

    return function () {
      off()
      for (var id in timers) {
        if (Object.prototype.hasOwnProperty.call(timers, id)) clearTimeout(timers[id])
      }
      timers = {}
    }
  }, [setItems])

  if (!items || !items.length) return null

  var nodes = []
  for (var i = 0; i < items.length; i++) {
    nodes.push(
      (function (item) {
        return h(
          'div',
          {
            key: item.id,
            className: 'dsn-toast' + (item.kind === 'error' ? ' is-error' : ''),
            onClick: function () {
              setItems(function (prev) {
                var next = []
                for (var j = 0; j < prev.length; j++) if (prev[j].id !== item.id) next.push(prev[j])
                return next.length === prev.length ? prev : next
              })
            },
          },
          h(DSN.Icon, { name: item.kind === 'error' ? 'close' : 'check', size: 12 }),
          h('span', { className: 'dsn-toast-text' }, item.text)
        )
      })(items[i])
    )
  }

  return h(
    'div',
    { className: 'dsn-toast-host', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'false' },
    nodes
  )
}

/* ------------------------------------------------------------------ *
 * DSN.Panel({ store, t, ctx, embedded })
 * ------------------------------------------------------------------ */

DSN.Panel = function Panel(props) {
  var React = DSN.React
  var h = DSN.h
  var geometry = DSN._geometry
  var store = props.store
  var t = typeof props.t === 'function' ? props.t : DSN.fallbackT
  var ctx = props.ctx
  var embedded = props.embedded === true

  var snapshot = DSN.useStore(store)
  var sizePair = React.useState(geometry.viewportSize)
  var size = sizePair[0]
  var setSize = sizePair[1]
  var livePair = React.useState(null)
  var liveRect = livePair[0]
  var setLiveRect = livePair[1]
  var dragPair = React.useState(null)
  var dragMode = dragPair[0]
  var setDragMode = dragPair[1]
  var pipPair = React.useState(geometry.pipOpenNow)
  var pipOpen = pipPair[0]
  var setPipOpen = pipPair[1]
  var dragRef = React.useRef(null)

  var ui = (snapshot && snapshot.ui) || {}
  var open = embedded ? true : !!ui.open
  var collapsed = embedded ? false : !!ui.collapsed
  var storedRect = ui.panel && typeof ui.panel === 'object' ? ui.panel : null
  var rect = liveRect || geometry.resolveRect(storedRect, size)

  /* --- keep the floating rect inside a shrinking viewport --------- */
  React.useEffect(function () {
    if (embedded) return undefined
    var timer = 0
    function onResize() {
      if (timer) return
      timer = setTimeout(function () {
        timer = 0
        setSize(geometry.viewportSize())
      }, 80)
    }
    var off = DSN.on(window, 'resize', onResize)
    return function () {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [embedded, setSize, geometry])

  /* --- Escape closes the floating window -------------------------- */
  React.useEffect(function () {
    if (embedded || !open) return undefined
    function onKey(event) {
      if (!event || (event.key !== 'Escape' && event.key !== 'Esc')) return
      if (event.defaultPrevented) return
      if (event.altKey || event.ctrlKey || event.metaKey) return
      var target = event.target || document.activeElement
      if (DSN.isEditable(target) || DSN.isEditable(document.activeElement)) return
      try {
        store.actions.setOpen(false)
      } catch (error) { DSN.log('close on Escape failed', error) }
    }
    return DSN.on(document, 'keydown', onKey)
  }, [embedded, open, store])

  /* --- PiP state, announced by the pip fragment ------------------- */
  React.useEffect(function () {
    function onPip(event) {
      var detail = event && event.detail
      setPipOpen(detail && typeof detail.open === 'boolean' ? detail.open : geometry.pipOpenNow())
    }
    var off = DSN.on(document, geometry.pipEventName(), onPip)
    setPipOpen(geometry.pipOpenNow())
    return off
  }, [setPipOpen, geometry])

  /* --- the pointer loop; move and resize share it ----------------- */
  React.useEffect(function () {
    if (!dragMode) return undefined

    function onMove(event) {
      var drag = dragRef.current
      if (!drag) return
      if (drag.pointerId != null && event.pointerId != null && drag.pointerId !== event.pointerId) return
      var dx = event.clientX - drag.sx
      var dy = event.clientY - drag.sy
      if (!drag.active) {
        if (Math.abs(dx) < geometry.DRAG_THRESHOLD && Math.abs(dy) < geometry.DRAG_THRESHOLD) return
        drag.active = true
      }
      var origin = drag.origin
      var next
      if (drag.mode === 'resize') {
        next = geometry.clampRect({ x: origin.x, y: origin.y, w: origin.w + dx, h: origin.h + dy }, drag.viewport)
      } else {
        next = geometry.clampRect({ x: origin.x + dx, y: origin.y + dy, w: origin.w, h: origin.h }, drag.viewport)
      }
      drag.last = next
      setLiveRect(next)
    }

    function onUp() {
      var drag = dragRef.current
      dragRef.current = null
      setDragMode(null)
      if (!drag || !drag.last || !drag.active) {
        setLiveRect(null)
        return
      }
      try {
        store.actions.setPanelRect({ x: drag.last.x, y: drag.last.y, w: drag.last.w, h: drag.last.h })
        setLiveRect(null)
      } catch (error) {
        DSN.log('setPanelRect failed', error)
        setLiveRect(drag.last)
      }
    }

    var offMove = DSN.on(window, 'pointermove', onMove)
    var offUp = DSN.on(window, 'pointerup', onUp)
    var offCancel = DSN.on(window, 'pointercancel', onUp)
    return function () {
      offMove()
      offUp()
      offCancel()
    }
  }, [dragMode, store, setDragMode, setLiveRect, geometry])

  function beginDrag(event, mode) {
    if (embedded) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    dragRef.current = {
      mode: mode,
      pointerId: event.pointerId,
      sx: event.clientX,
      sy: event.clientY,
      origin: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
      viewport: size,
      active: false,
      last: null,
    }
    try {
      if (event.currentTarget && event.currentTarget.setPointerCapture && event.pointerId != null) {
        event.currentTarget.setPointerCapture(event.pointerId)
      }
    } catch (error) { DSN.log('setPointerCapture failed', error) }
    try { event.preventDefault() } catch (error) { /* not cancelable */ }
    setDragMode(mode)
  }

  function onHeaderPointerDown(event) {
    if (embedded || geometry.isControl(event.target)) return
    beginDrag(event, 'move')
  }

  function onHeaderDoubleClick(event) {
    if (embedded || geometry.isControl(event.target)) return
    try {
      store.actions.setCollapsed(!collapsed)
    } catch (error) { DSN.log('toggle collapsed failed', error) }
  }

  function onResizePointerDown(event) {
    if (embedded) return
    beginDrag(event, 'resize')
  }

  function closePanel() {
    try {
      store.actions.setOpen(false)
    } catch (error) { DSN.log('close panel failed', error) }
  }

  function toggleCollapse() {
    try {
      store.actions.setCollapsed(!collapsed)
    } catch (error) { DSN.log('toggle collapsed failed', error) }
  }

  function togglePip() {
    var toggle = DSN.togglePip
    if (typeof toggle !== 'function') return
    var result = null
    try {
      result = toggle({ store: store, t: t, ctx: ctx })
    } catch (error) {
      DSN.log('togglePip failed', error)
    }
    Promise.resolve(result).then(
      function () { setPipOpen(geometry.pipOpenNow()) },
      function () { setPipOpen(geometry.pipOpenNow()) }
    )
  }

  if (!open) return null

  var notes = (snapshot && snapshot.notes) || []
  var count = 0
  for (var i = 0; i < notes.length; i++) if (!notes[i].deletedAt) count++

  var rootClass = 'dsn-root dsn-panel'
  if (embedded) rootClass += ' is-embedded'
  if (collapsed) rootClass += ' is-collapsed'
  if (dragMode === 'move') rootClass += ' is-dragging'
  if (dragMode === 'resize') rootClass += ' is-resizing'

  var rootStyle = embedded
    ? null
    : {
        left: rect.x + 'px',
        top: rect.y + 'px',
        width: rect.w + 'px',
        height: (collapsed ? geometry.HEADER_H : rect.h) + 'px',
      }

  var actions = null
  if (!embedded) {
    actions = h(
      'div',
      { className: 'dsn-header-actions', 'data-dsn-nodrag': '1' },
      geometry.pipSupportedNow()
        ? geometry.iconButton(h, 'float', t('panel.pip'), togglePip, pipOpen)
        : null,
      geometry.iconButton(
        h,
        collapsed ? 'expand' : 'collapse',
        collapsed ? t('panel.expand') : t('panel.collapse'),
        toggleCollapse,
        collapsed
      ),
      geometry.iconButton(h, 'close', t('panel.close'), closePanel, null)
    )
  }

  var children = [
    h(
      'div',
      {
        key: 'header',
        className: 'dsn-header',
        onPointerDown: onHeaderPointerDown,
        onDoubleClick: onHeaderDoubleClick,
      },
      h('span', { className: 'dsn-header-icon', 'aria-hidden': 'true' }, h(DSN.Icon, { name: 'note', size: 13 })),
      h(
        'span',
        { className: 'dsn-header-title', title: embedded ? t('panel.title') : t('panel.dragHint') },
        t('panel.title')
      ),
      h('span', { className: 'dsn-header-badge', title: String(count) }, String(count)),
      actions
    ),
  ]

  if (!collapsed) {
    var notesApp = DSN.NotesApp
    var bodyChild = typeof notesApp === 'function'
      ? h(notesApp, { store: store, t: t, bridge: DSN.bridge, ctx: ctx })
      : h('div', { className: 'dsn-loading' }, t('panel.loading'))
    children.push(h('div', { key: 'body', className: 'dsn-body' }, bodyChild))
  }

  if (!embedded && !collapsed) {
    children.push(
      h('div', {
        key: 'resize',
        className: 'dsn-resize',
        title: t('panel.resize'),
        'aria-hidden': 'true',
        onPointerDown: onResizePointerDown,
      })
    )
  }

  /* Toasts are owned by 90-apply.js, which mounts one DSN.ToastHost at the
     application overlay -- rendering a second copy in the floating panel
     would show every toast twice. The PiP window has no such host, so the
     embedded instance carries its own. */
  if (embedded) children.push(h(DSN.ToastHost, { key: 'toasts', t: t }))

  return h(
    'div',
    {
      className: rootClass,
      style: rootStyle,
      role: embedded ? 'region' : 'dialog',
      'aria-label': t('panel.title'),
      'data-dsn-panel': embedded ? 'embedded' : 'floating',
    },
    children
  )
}

/* ================= 50-board.js ================= */
/* ================================================================== *
 * 50-board.js — the notes panel body.
 *
 * Vertical order (see CONTRACT.md): toolbar (view tabs + search + add
 * section), section rail, composer, note stream, footer.
 *
 * Markup deliberately reuses the shared `.dsn-*` vocabulary defined by
 * 40-styles.js (`.dsn-app`, `.dsn-toolbar`, `.dsn-tabs`, `.dsn-search`,
 * `.dsn-sections`, `.dsn-section-chip`, `.dsn-composer`, `.dsn-stream`,
 * `.dsn-note`, `.dsn-note-clamp`, `.dsn-dropzone`, `.dsn-empty`, `.dsn-menu`,
 * `.dsn-iconbtn`, `.dsn-btn`, `.dsn-input`, `.dsn-footer`, ...) so the board
 * matches the panel shell and the PiP window. This fragment only registers
 * the few board-specific rules those classes do not cover.
 *
 * Rendering always comes from `useSyncExternalStore(store.subscribe,
 * store.getSnapshot)`; the snapshot is never copied into component
 * state. Only ephemeral UI state (drafts, menus, drag hover, expanded
 * cards) lives in local `useState`.
 *
 * Depends on (documented external fragments, written in parallel):
 *   DSN.Content, DSN.Editor, DSN.sanitizeHtml, DSN.readDragContent,
 *   DSN.dragHasContent, DSN.useStore (local fallback below), DSN.bridge.
 * ================================================================== */

DSN.addStrings({
  'board.expandNote': '展开全文',
  'board.collapseNote': '收起',
  'board.editPlaceholder': '编辑这条便签…',
  'board.noResults': '没有匹配的便签',
  'board.more': '更多操作',
  'board.confirm': '确定',
  'board.moved': '已移动到「{name}」',
}, {
  'board.expandNote': 'Show more',
  'board.collapseNote': 'Show less',
  'board.editPlaceholder': 'Edit this note…',
  'board.noResults': 'No matching notes',
  'board.more': 'More actions',
  'board.confirm': 'Confirm',
  'board.moved': 'Moved to "{name}"',
})

/* ------------------------------------------------------------------ *
 * constants and small helpers
 * ------------------------------------------------------------------ */

var BOARD_NOTE_MIME = 'application/x-dsn-note'

/* A drag payload is copied by the browser for every drop target it visits, so a
 * note holding inline base64 images must not be handed over verbatim. Keep the
 * rich payload under a small budget: first drop the inline sources, then the
 * images themselves, and as a last resort fall back to plain text. */
var BOARD_DRAG_HTML_BUDGET = 64 * 1024
var BOARD_DRAG_TEXT_LIMIT = 2000

function boardDragHtml(note) {
  var html = note.html || DSN.textToHtml(note.text || '')
  if (!html) return ''
  if (html.length <= BOARD_DRAG_HTML_BUDGET) return html
  var slim = html.replace(/(<img\b[^>]*?)\ssrc\s*=\s*("|')data:[\s\S]*?\2/gi, '$1')
  if (slim.length <= BOARD_DRAG_HTML_BUDGET) return slim
  slim = slim.replace(/<img\b[^>]*>/gi, '')
  if (slim.length <= BOARD_DRAG_HTML_BUDGET) return slim
  var text = String(note.text || '').slice(0, BOARD_DRAG_TEXT_LIMIT)
  return DSN.textToHtml(text)
}

var BOARD_KIND_ICONS = {
  text: 'note',
  table: 'table',
  image: 'image',
  code: 'sections',
  mixed: 'sections',
  link: 'float',
}

function boardTranslate(t) {
  return typeof t === 'function' ? t : DSN.fallbackT
}

function boardHasType(dataTransfer, type) {
  var types = dataTransfer && dataTransfer.types
  if (!types) return false
  for (var i = 0; i < types.length; i++) {
    if (types[i] === type) return true
  }
  return false
}

/** A card drag produced by this plugin (see the shared drag protocol). */
function boardIsNoteDrag(dataTransfer) {
  return boardHasType(dataTransfer, BOARD_NOTE_MIME)
}

/** Content dragged in from outside the panel (files, text, html). */
function boardIsExternalDrag(dataTransfer) {
  if (!dataTransfer) return false
  if (boardIsNoteDrag(dataTransfer)) return false
  if (typeof DSN.dragHasContent === 'function') {
    try {
      if (DSN.dragHasContent(dataTransfer)) return true
    } catch (error) {
      DSN.log('dragHasContent failed', error)
    }
  }
  return boardHasType(dataTransfer, 'Files') ||
    boardHasType(dataTransfer, 'text/html') ||
    boardHasType(dataTransfer, 'text/plain')
}

function boardReadNoteId(dataTransfer) {
  if (!dataTransfer) return ''
  try {
    return String(dataTransfer.getData(BOARD_NOTE_MIME) || '')
  } catch (error) {
    return ''
  }
}

/** Plain text of an HTML fragment (30-content provides htmlToText). */
function boardHtmlText(html) {
  if (typeof DSN.htmlToText === 'function') {
    try {
      return String(DSN.htmlToText(html) || '')
    } catch (error) {
      DSN.log('htmlToText failed', error)
    }
  }
  return String(html == null ? '' : html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function boardTextToHtml(text) {
  if (typeof DSN.textToHtml === 'function') {
    try {
      return String(DSN.textToHtml(String(text == null ? '' : text)) || '')
    } catch (error) {
      DSN.log('textToHtml failed', error)
    }
  }
  return DSN.escapeHtml(text).replace(/\r?\n/g, '<br>')
}

function boardIsEmptyHtml(html) {
  if (!html) return true
  if (boardHtmlText(html).replace(/\s+/g, '') !== '') return false
  return !/<(img|table|pre|blockquote|ul|ol)\b/i.test(String(html))
}

/** Case-insensitive match over the note title and text. */
function boardMatchesQuery(note, query) {
  if (!query) return true
  if (!note) return false
  var needle = String(query).toLowerCase()
  var title = String(note.title || '').toLowerCase()
  var text = String(note.text || '').toLowerCase()
  return title.indexOf(needle) >= 0 || text.indexOf(needle) >= 0
}

/** Pinned first, then most recently updated. */
function boardSortNotes(a, b) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  return (b.updatedAt || 0) - (a.updatedAt || 0)
}

/** Priority order: pinned, then urgency rank, then the usual newest-first. */
function boardSortByPriority(a, b) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  var rankA = DSN.PRIORITY_RANK[a.priority] === undefined ? 0 : DSN.PRIORITY_RANK[a.priority]
  var rankB = DSN.PRIORITY_RANK[b.priority] === undefined ? 0 : DSN.PRIORITY_RANK[b.priority]
  if (rankA !== rankB) return rankB - rankA
  return (b.updatedAt || 0) - (a.updatedAt || 0)
}

/** True when the note carries a checklist and every item in it is done. */
function boardAllDone(note) {
  var tasks = note && Array.isArray(note.tasks) ? note.tasks : null
  if (!tasks || !tasks.length) return false
  for (var i = 0; i < tasks.length; i += 1) if (!tasks[i].done) return false
  return true
}

/** Open checklist items of one note. */
function boardOpenTasks(note) {
  var tasks = note && Array.isArray(note.tasks) ? note.tasks : []
  var count = 0
  for (var i = 0; i < tasks.length; i += 1) if (!tasks[i].done) count += 1
  return count
}

function boardReadSections(state, t) {
  var list = state && Array.isArray(state.sections)
    ? state.sections.filter(function (item) { return item && item.id }).slice()
    : []
  if (!list.length) list = [{ id: '', name: t('section.inbox'), order: 0 }]
  list.sort(function (a, b) { return (a.order || 0) - (b.order || 0) })
  return list
}

function boardPickActiveId(sections, candidate) {
  for (var i = 0; i < sections.length; i++) {
    if (sections[i].id === candidate) return candidate
  }
  return sections.length ? sections[0].id : ''
}

/**
 * useSyncExternalStore binding. `DSN.useStore` comes from 45-panel.js and is
 * looked up lazily so the fragment order never matters; the local fallback
 * mirrors the documented helper.
 */
function boardUseStore(store) {
  var React = DSN.React
  var hook = DSN.useStore
  if (typeof hook !== 'function') {
    hook = function (target) {
      return React.useSyncExternalStore(target.subscribe, target.getSnapshot)
    }
  }
  return hook(store)
}

/** Hover state for an HTML5 drop target, counted so child events never flicker. */
function boardUseDragDepth() {
  var React = DSN.React
  var depthRef = React.useRef(0)
  var pair = React.useState(false)
  var active = pair[0]
  var setActive = pair[1]
  return {
    active: active,
    enter: function () {
      depthRef.current += 1
      if (depthRef.current === 1) setActive(true)
    },
    leave: function (event) {
      var node = event && event.currentTarget
      var related = event && event.relatedTarget
      if (node && related && typeof node.contains === 'function' && node.contains(related)) return
      depthRef.current = 0
      if (active) setActive(false)
    },
    reset: function () {
      depthRef.current = 0
      if (active) setActive(false)
    },
  }
}

function boardPrevent(event) {
  if (event && event.preventDefault) event.preventDefault()
}

function boardStop(event) {
  if (event && event.stopPropagation) event.stopPropagation()
}

/* ------------------------------------------------------------------ *
 * building blocks shared by the board
 * ------------------------------------------------------------------ */

function BoardIconButton(props) {
  var classes = 'dsn-iconbtn'
  if (props.className) classes += ' ' + props.className
  return h('button', {
    type: 'button',
    className: classes,
    'aria-label': props.label,
    title: props.title || props.label,
    'aria-pressed': props.pressed === undefined ? undefined : (props.pressed ? 'true' : 'false'),
    disabled: props.disabled === true,
    'data-dsn-nodrag': '1',
    onPointerDown: boardPrevent,
    onMouseDown: boardPrevent,
    onClick: function (event) {
      boardStop(event)
      boardPrevent(event)
      if (props.onClick) props.onClick(event)
    },
  }, h(DSN.Icon, { name: props.icon || 'note', size: props.size || 14 }))
}

function BoardEmpty(props) {
  return h('div', { className: 'dsn-empty' },
    h('span', { className: 'dsn-empty-icon', 'aria-hidden': 'true' },
      h(DSN.Icon, { name: props.icon || 'note', size: 20 })),
    h('p', { className: 'dsn-empty-text' }, props.message))
}

function boardTabButton(props) {
  return h('button', {
    type: 'button',
    role: 'tab',
    className: 'dsn-tab' + (props.active ? ' is-active' : ''),
    'aria-selected': props.active ? 'true' : 'false',
    onClick: function () { props.onClick() },
  },
    h('span', null, props.label),
    h('span', { className: 'dsn-tab-count' }, String(props.count || 0)))
}

function BoardToolbar(props) {
  var t = props.t
  var taskCount = props.taskCount || 0
  var filters = props.view === 'trash'
    ? null
    : h('div', { className: 'dsn-filters' },
      props.view === 'tasks' ? null : h('span', { className: 'dsn-filter-group', title: t('filter.sort') },
        h('span', { className: 'dsn-filter-label' }, t('filter.sort')),
        h(DSN.SelectMenu, {
          t: t,
          value: props.sort,
          ariaLabel: t('filter.sort'),
          onChange: function (value) { props.onSort(value) },
          options: [
            { value: 'time', label: t('filter.sortTime') },
            { value: 'priority', label: t('filter.sortPriority') },
          ],
        })),
      h('span', { className: 'dsn-filter-group', title: t('filter.priority') },
        h('span', { className: 'dsn-filter-label' }, t('filter.priority')),
        h(DSN.SelectMenu, {
          t: t,
          value: props.priorityFilter,
          ariaLabel: t('filter.priority'),
          onChange: function (value) { props.onPriorityFilter(value) },
          options: [{ value: 'all', label: t('filter.all') }].concat(DSN.PRIORITIES.map(function (name) {
            return { value: name, label: t('priority.' + name), dot: DSN.priorityMeta(name).token }
          })),
        })),
      h('button', {
        type: 'button',
        className: 'dsn-filter-toggle' + (props.hideDone ? ' is-on' : ''),
        'aria-pressed': props.hideDone ? 'true' : 'false',
        title: t('filter.hideDoneHint'),
        onClick: function () { props.onToggleHideDone() },
      }, t('filter.hideDone')))
  return h('div', null,
    h('div', { className: 'dsn-toolbar' },
      h('div', { className: 'dsn-tabs', role: 'tablist' },
        boardTabButton({
          active: props.view === 'board',
          label: t('tab.all'),
          count: props.liveCount,
          onClick: function () { props.onView('board') },
        }),
        boardTabButton({
          active: props.view === 'tasks',
          label: t('tab.tasks'),
          count: taskCount,
          onClick: function () { props.onView('tasks') },
        }),
        boardTabButton({
          active: props.view === 'trash',
          label: t('tab.trash'),
          count: props.trashCount,
          onClick: function () { props.onView('trash') },
        })),
      h('div', { className: 'dsn-search' },
        h('span', { className: 'dsn-search-icon', 'aria-hidden': 'true' },
          h(DSN.Icon, { name: 'search', size: 13 })),
        h('input', {
          className: 'dsn-search-input',
          type: 'search',
          value: props.search || '',
          placeholder: t('search.placeholder'),
          'aria-label': t('search.placeholder'),
          spellCheck: false,
          onChange: function (event) { props.onSearch(event.target.value) },
        }),
        props.search
          ? h('button', {
              type: 'button',
              className: 'dsn-search-clear',
              'aria-label': t('search.clear'),
              title: t('search.clear'),
              onClick: function () { props.onSearch('') },
            }, h(DSN.Icon, { name: 'close', size: 12 }))
          : null)),
    filters)
}

/* ------------------------------------------------------------------ *
 * section rail
 * ------------------------------------------------------------------ */

DSN.SectionRail = function SectionRail(props) {
  var React = DSN.React
  var store = props.store
  var t = boardTranslate(props.t)
  var sections = Array.isArray(props.sections) ? props.sections : []
  var activeId = props.activeSectionId

  var menuPair = React.useState('')
  var menuId = menuPair[0]
  var setMenuId = menuPair[1]
  var renamePair = React.useState('')
  var renamingId = renamePair[0]
  var setRenamingId = renamePair[1]
  var renameDraftPair = React.useState('')
  var renameDraft = renameDraftPair[0]
  var setRenameDraft = renameDraftPair[1]
  var addDraftPair = React.useState('')
  var addDraft = addDraftPair[0]
  var setAddDraft = addDraftPair[1]
  var overPair = React.useState('')
  var overId = overPair[0]
  var setOverId = overPair[1]
  var depthRef = React.useRef({})
  var addInputRef = React.useRef(null)
  var renameInputRef = React.useRef(null)
  var adding = props.adding === true

  React.useEffect(function () {
    if (!adding) return undefined
    var node = addInputRef.current
    if (node && typeof node.focus === 'function') node.focus()
    return undefined
  }, [adding])

  React.useEffect(function () {
    if (!renamingId) return undefined
    var node = renameInputRef.current
    if (node && typeof node.focus === 'function') {
      node.focus()
      if (typeof node.select === 'function') node.select()
    }
    return undefined
  }, [renamingId])

  /* Close the section action menu on any outside pointerdown / Escape. */
  React.useEffect(function () {
    if (!menuId) return undefined
    function onPointerDown(event) {
      if (event && event.target && DSN.closest(event.target, '.dsn-menu, .dsn-board-chip-more')) return
      setMenuId('')
    }
    function onKeyDown(event) {
      if (event && event.key === 'Escape') setMenuId('')
    }
    var offPointer = DSN.on(document, 'pointerdown', onPointerDown, true)
    var offKey = DSN.on(document, 'keydown', onKeyDown, true)
    return function () {
      offPointer()
      offKey()
    }
  }, [menuId])

  function notifyAdding(next) {
    if (typeof props.onAddingChange === 'function') props.onAddingChange(next)
  }

  function notifyMoved(noteId) {
    if (typeof props.onMoved === 'function') props.onMoved(noteId)
  }

  function selectSection(sectionId) {
    setMenuId('')
    setRenamingId('')
    if (store && store.actions && typeof store.actions.setActiveSection === 'function') {
      store.actions.setActiveSection(sectionId)
    }
  }

  function toggleMenu(sectionId) {
    setMenuId(menuId === sectionId ? '' : sectionId)
  }

  function beginRename(section) {
    if (!section) return
    setMenuId('')
    setRenamingId(section.id)
    setRenameDraft(section.name || '')
  }

  function commitRename() {
    if (!renamingId) return
    var name = String(renameDraft || '').trim()
    setRenamingId('')
    if (!name) return
    store.actions.renameSection(renamingId, name)
  }

  function cancelRename() {
    setRenamingId('')
  }

  function beginAdd() {
    setAddDraft('')
    notifyAdding(true)
  }

  function commitAdd() {
    var name = String(addDraft || '').trim()
    setAddDraft('')
    notifyAdding(false)
    if (!name) return
    store.actions.addSection(name)
  }

  function cancelAdd() {
    setAddDraft('')
    notifyAdding(false)
  }

  function deleteSectionById(sectionId) {
    setMenuId('')
    if (sections.length <= 1) return
    store.actions.deleteSection(sectionId)
  }

  function onAddKeyDown(event) {
    if (event.key === 'Enter') {
      boardPrevent(event)
      commitAdd()
    } else if (event.key === 'Escape') {
      boardPrevent(event)
      boardStop(event)
      cancelAdd()
    }
  }

  function onRenameKeyDown(event) {
    if (event.key === 'Enter') {
      boardPrevent(event)
      commitRename()
    } else if (event.key === 'Escape') {
      boardPrevent(event)
      boardStop(event)
      cancelRename()
    }
  }

  function chipEnter(sectionId, event) {
    if (!boardIsNoteDrag(event.dataTransfer)) return
    var map = depthRef.current
    map[sectionId] = (map[sectionId] || 0) + 1
    if (map[sectionId] === 1) setOverId(sectionId)
  }

  function chipOver(sectionId, event) {
    if (!boardIsNoteDrag(event.dataTransfer)) return
    boardPrevent(event)
    try {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    } catch (error) { /* ignore */ }
  }

  function chipLeave(sectionId, event) {
    if (!boardIsNoteDrag(event.dataTransfer)) return
    var node = event.currentTarget
    var related = event.relatedTarget
    if (node && related && typeof node.contains === 'function' && node.contains(related)) return
    depthRef.current[sectionId] = 0
    if (overId === sectionId) setOverId('')
  }

  function chipDrop(sectionId, event) {
    if (!boardIsNoteDrag(event.dataTransfer)) return
    boardPrevent(event)
    boardStop(event)
    depthRef.current[sectionId] = 0
    setOverId('')
    var noteId = boardReadNoteId(event.dataTransfer)
    if (!noteId) return
    store.actions.moveNote(noteId, sectionId, null)
    var section = null
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].id === sectionId) section = sections[i]
    }
    DSN.toast(t('board.moved', { name: section ? section.name : '' }), 'info')
    notifyMoved(noteId)
  }

  function SectionChip(section) {
    var active = section.id === activeId
    var count = props.counts && props.counts[section.id] ? props.counts[section.id] : 0
    var classes = 'dsn-section-chip'
    if (active) classes += ' is-active'
    if (overId === section.id) classes += ' is-over'
    if (renamingId === section.id) {
      return h('div', { key: section.id, className: 'dsn-section-chip is-editing' },
        h('input', {
          ref: renameInputRef,
          className: 'dsn-input dsn-board-chip-input',
          value: renameDraft,
          placeholder: t('section.namePlaceholder'),
          'aria-label': t('section.rename'),
          spellCheck: false,
          onChange: function (event) { setRenameDraft(event.target.value) },
          onKeyDown: onRenameKeyDown,
          onBlur: commitRename,
        }),
        h(BoardIconButton, {
          icon: 'check',
          size: 11,
          className: 'dsn-board-mini',
          label: t('board.confirm'),
          onClick: commitRename,
        }),
        h(BoardIconButton, {
          icon: 'close',
          size: 11,
          className: 'dsn-board-mini',
          label: t('note.cancel'),
          onClick: cancelRename,
        }))
    }
    return h('div', {
      key: section.id,
      className: classes,
      role: 'button',
      tabIndex: 0,
      'aria-pressed': active ? 'true' : 'false',
      title: t('section.count', { n: count }),
      onClick: function () { selectSection(section.id) },
      onKeyDown: function (event) {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
          boardPrevent(event)
          selectSection(section.id)
        } else if (event.key === 'F2') {
          boardPrevent(event)
          beginRename(section)
        }
      },
      onContextMenu: function (event) {
        boardPrevent(event)
        setMenuId(section.id)
      },
      onDragEnter: function (event) { chipEnter(section.id, event) },
      onDragOver: function (event) { chipOver(section.id, event) },
      onDragLeave: function (event) { chipLeave(section.id, event) },
      onDrop: function (event) { chipDrop(section.id, event) },
    },
      h('span', { className: 'dsn-board-chip-name' }, section.name || t('section.inbox')),
      count ? h('span', { className: 'dsn-section-count' }, String(count)) : null,
      h('button', {
        type: 'button',
        className: 'dsn-iconbtn dsn-board-chip-more',
        'aria-label': t('board.more'),
        title: t('board.more'),
        'data-dsn-nodrag': '1',
        onPointerDown: boardPrevent,
        onMouseDown: boardPrevent,
        onClick: function (event) {
          boardStop(event)
          toggleMenu(section.id)
        },
      }, h(DSN.Icon, { name: 'more', size: 12 })))
  }

  var chips = sections.map(SectionChip)
  if (adding) {
    chips.push(h('div', { key: '__board-add-section__', className: 'dsn-section-chip is-editing' },
      h('input', {
        ref: addInputRef,
        className: 'dsn-input dsn-board-chip-input',
        value: addDraft,
        placeholder: t('section.namePlaceholder'),
        'aria-label': t('section.add'),
        spellCheck: false,
        onChange: function (event) { setAddDraft(event.target.value) },
        onKeyDown: onAddKeyDown,
        onBlur: commitAdd,
      }),
      h(BoardIconButton, {
        icon: 'check',
        size: 11,
        className: 'dsn-board-mini',
        label: t('board.confirm'),
        onClick: commitAdd,
      }),
      h(BoardIconButton, {
        icon: 'close',
        size: 11,
        className: 'dsn-board-mini',
        label: t('note.cancel'),
        onClick: cancelAdd,
      })))
  } else {
    chips.push(h('button', {
      key: '__board-new-section__',
      type: 'button',
      className: 'dsn-section-chip is-add',
      'aria-label': t('section.add'),
      title: t('section.add'),
      onClick: beginAdd,
    },
      h(DSN.Icon, { name: 'plus', size: 13 }),
      h('span', { className: 'dsn-board-chip-name' }, t('section.add'))))
  }

  var menuSection = null
  for (var i = 0; i < sections.length; i++) {
    if (sections[i].id === menuId) menuSection = sections[i]
  }

  return h('div', { className: 'dsn-board-rail-block' },
    h('div', { className: 'dsn-sections' }, chips),
    menuSection
      ? h('div', { className: 'dsn-menu dsn-board-menu-inline', role: 'menu' },
          h('span', { className: 'dsn-board-menu-label', title: menuSection.name }, menuSection.name),
          h('button', {
            type: 'button',
            role: 'menuitem',
            className: 'dsn-menu-item',
            onClick: function () { beginRename(menuSection) },
          },
            h(DSN.Icon, { name: 'edit', size: 12 }),
            h('span', null, t('section.rename'))),
          h('button', {
            type: 'button',
            role: 'menuitem',
            className: 'dsn-menu-item is-danger',
            disabled: sections.length <= 1,
            title: sections.length <= 1 ? t('section.deleteHint') : t('section.delete'),
            onClick: function () { deleteSectionById(menuSection.id) },
          },
            h(DSN.Icon, { name: 'trash', size: 12 }),
            h('span', null, t('section.delete'))))
      : null)
}

/* ------------------------------------------------------------------ *
 * composer
 * ------------------------------------------------------------------ */

DSN.Composer = function Composer(props) {
  var React = DSN.React
  var store = props.store
  var t = boardTranslate(props.t)
  var draftPair = React.useState('')
  var draft = draftPair[0]
  var setDraft = draftPair[1]
  var empty = boardIsEmptyHtml(draft)
  var drop = boardUseDragDepth()

  /* Keep the highlight honest even when a drop is swallowed by the editor. */
  React.useEffect(function () {
    if (!drop.active) return undefined
    function clear() { drop.reset() }
    var offEnd = DSN.on(window, 'dragend', clear)
    var offDrop = DSN.on(window, 'drop', clear)
    var offBlur = DSN.on(window, 'blur', clear)
    return function () {
      offEnd()
      offDrop()
      offBlur()
    }
  }, [drop.active])

  function save() {
    if (empty) return
    var html = String(draft || '')
    var payload = { html: html, text: boardHtmlText(html) }
    if (props.sectionId) payload.sectionId = props.sectionId
    store.actions.addNote(payload)
    store.actions.setView('board')
    setDraft('')
    DSN.toast(t('note.saved'), 'info')
  }

  function change(html) {
    setDraft(typeof html === 'string' ? html : '')
  }

  return h('div', {
    className: 'dsn-composer' + (drop.active ? ' is-over' : ''),
    onDragEnter: function (event) {
      if (!boardIsExternalDrag(event.dataTransfer)) return
      boardPrevent(event)
      drop.enter()
    },
    onDragOver: function (event) {
      if (!boardIsExternalDrag(event.dataTransfer)) return
      boardPrevent(event)
      try {
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      } catch (error) { /* ignore */ }
    },
    onDragLeave: function (event) {
      if (!boardIsExternalDrag(event.dataTransfer)) return
      drop.leave(event)
    },
    onDrop: function () { drop.reset() },
  },
    h(DSN.Editor, {
      value: draft,
      onChange: change,
      onSubmit: save,
      placeholder: t('composer.placeholder'),
      minHeight: 56,
      t: t,
    }),
    h('div', { className: 'dsn-composer-foot' },
      h('span', { className: 'dsn-composer-hint' }, t('composer.richHint')),
      h('span', { className: 'dsn-board-save-hint' }, t('composer.saveHint')),
      h('button', {
        type: 'button',
        className: 'dsn-btn dsn-btn-primary dsn-btn-tiny',
        disabled: empty,
        title: t('composer.saveHint'),
        'data-dsn-nodrag': '1',
        onPointerDown: boardPrevent,
        onClick: function (event) {
          boardPrevent(event)
          save()
        },
      },
        h(DSN.Icon, { name: 'check', size: 12 }),
        h('span', null, t('composer.save')))))
}

/* ------------------------------------------------------------------ *
 * trash
 * ------------------------------------------------------------------ */

function BoardTrashItem(props) {
  var store = props.store
  var t = boardTranslate(props.t)
  var note = props.note
  if (!note) return null
  var kind = note.kind || 'text'
  var kindLabel = t('kind.' + kind)
  var safeHtml = ''
  if (typeof DSN.sanitizeHtml === 'function') {
    try {
      safeHtml = DSN.sanitizeHtml(note.html || '')
    } catch (error) {
      DSN.log('sanitizeHtml failed', error)
    }
  }
  return h('article', { className: 'dsn-note dsn-note--trash', 'data-note-id': note.id },
    h('div', { className: 'dsn-note-head' },
      h('span', { className: 'dsn-note-kind', title: kindLabel, 'aria-hidden': 'true' },
        h(DSN.Icon, { name: BOARD_KIND_ICONS[kind] || 'note', size: 13 })),
      h('span', { className: 'dsn-note-age' },
        DSN.formatAge(note.deletedAt || note.updatedAt, t)),
      h('div', { className: 'dsn-note-actions is-always' },
        h(BoardIconButton, {
          icon: 'restore',
          label: t('note.restore'),
          onClick: function () { store.actions.restoreNote(note.id) },
        }),
        h(BoardIconButton, {
          icon: 'trash',
          label: t('note.purge'),
          className: 'is-danger',
          onClick: function () { store.actions.purgeNote(note.id) },
        }))),
    h('div', { className: 'dsn-note-body' },
      h('div', { className: 'dsn-note-clamp' },
        h(DSN.Content, { html: safeHtml, kind: note.kind }))),
    note.source && note.source.sessionTitle
      ? h('div', { className: 'dsn-note-foot' },
          h('span', { className: 'dsn-chip dsn-note-source', title: note.source.sessionTitle },
            h(DSN.Icon, { name: 'note', size: 11 }),
            h('span', null, t('list.source', { name: note.source.sessionTitle }))))
      : null)
}

DSN.TrashView = function TrashView(props) {
  var React = DSN.React
  var store = props.store
  var t = boardTranslate(props.t)
  var notes = Array.isArray(props.notes) ? props.notes : []
  var armedPair = React.useState(false)
  var armed = armedPair[0]
  var setArmed = armedPair[1]

  function emptyAll() {
    if (!armed) {
      setArmed(true)
      return
    }
    setArmed(false)
    store.actions.emptyTrash()
  }

  function disarm() {
    setArmed(false)
  }

  if (!notes.length) {
    return h(BoardEmpty, {
      icon: props.query ? 'search' : 'trash',
      message: props.query ? t('board.noResults') : t('list.trashEmpty'),
    })
  }

  return h('div', { className: 'dsn-board-trash' },
    h('div', { className: 'dsn-board-trash-head' },
      h('span', { className: 'dsn-board-trash-title' }, t('tab.trash')),
      h('button', {
        type: 'button',
        className: 'dsn-btn dsn-btn-danger dsn-btn-tiny' + (armed ? ' is-armed' : ''),
        title: armed ? t('trash.confirmEmpty') : t('trash.emptyAll'),
        onClick: function (event) {
          boardPrevent(event)
          emptyAll()
        },
        onBlur: disarm,
      },
        h(DSN.Icon, { name: 'trash', size: 12 }),
        h('span', null, armed ? t('trash.confirmEmpty') : t('trash.emptyAll')))),
    notes.map(function (note) {
      return h(BoardTrashItem, { key: note.id, store: store, t: t, note: note })
    }))
}

/* ------------------------------------------------------------------ *
 * note card
 * ------------------------------------------------------------------ */

function NoteCardInner(props) {
  var React = DSN.React
  var store = props.store
  var t = boardTranslate(props.t)
  var note = props.note
  var bridge = props.bridge
  var drag = props.drag || {}

  var editPair = React.useState(null)
  var draft = editPair[0]
  var setDraft = editPair[1]
  var expandPair = React.useState(false)
  var expanded = expandPair[0]
  var setExpanded = expandPair[1]
  var overflowPair = React.useState(false)
  var overflowing = overflowPair[0]
  var setOverflowing = overflowPair[1]
  var suppressDragRef = React.useRef(false)
  var clampRef = React.useRef(null)

  var safeHtml = React.useMemo(function () {
    if (typeof DSN.sanitizeHtml !== 'function') return ''
    try {
      return DSN.sanitizeHtml(note.html || '')
    } catch (error) {
      DSN.log('sanitizeHtml failed', error)
      return ''
    }
  }, [note.html])

  /* The shared `.dsn-note-clamp` caps the body at 8 lines; detect overflow so
     the expand affordance only appears when there is more to read. */
  React.useEffect(function () {
    var alive = true
    function measure() {
      if (!alive) return
      var node = clampRef.current
      if (!node) return
      if (expanded) {
        setOverflowing(true)
        return
      }
      setOverflowing(node.scrollHeight > node.clientHeight + 2)
    }
    measure()
    var timer1 = setTimeout(measure, 120)
    var timer2 = setTimeout(measure, 650)
    var offResize = DSN.on(window, 'resize', measure)
    return function () {
      alive = false
      clearTimeout(timer1)
      clearTimeout(timer2)
      offResize()
    }
  }, [note.html, expanded])

  var editing = typeof draft === 'string'
  var kind = note.kind || 'text'
  var kindLabel = t('kind.' + kind)
  var title = note.title || DSN.headline(note.text || '', 64)
  var showExpand = overflowing || expanded
  var dragging = !!(drag.id && drag.id === note.id)
  var taskTotal = Array.isArray(note.tasks) ? note.tasks.length : 0
  var taskDone = 0
  if (taskTotal) {
    for (var taskIndex = 0; taskIndex < note.tasks.length; taskIndex += 1) {
      if (note.tasks[taskIndex].done) taskDone += 1
    }
  }
  var commentCount = Array.isArray(note.comments) ? note.comments.length : 0

  function openDetail(event) {
    if (event) {
      boardPrevent(event)
      boardStop(event)
    }
    store.actions.setDetail(note.id)
  }

  function startEdit(event) {
    if (event) {
      boardPrevent(event)
      boardStop(event)
    }
    setDraft(note.html || '')
  }

  function cancelEdit() {
    setDraft(null)
  }

  function saveEdit() {
    if (typeof draft !== 'string') return
    if (boardIsEmptyHtml(draft)) return
    store.actions.updateNote(note.id, { html: draft, text: boardHtmlText(draft) })
    setDraft(null)
    DSN.toast(t('note.updated'), 'info')
  }

  function changeDraft(html) {
    setDraft(typeof html === 'string' ? html : '')
  }

  function togglePin() {
    store.actions.togglePin(note.id)
  }

  function removeNote() {
    store.actions.deleteNote(note.id)
  }

  function copyNote() {
    DSN.copyRich(note.html || '', note.text || '').then(function (ok) {
      DSN.toast(ok ? t('status.copied') : t('status.copyFailed'), ok ? 'info' : 'error')
    }, function (error) {
      DSN.log('copyRich rejected', error)
      DSN.toast(t('status.copyFailed'), 'error')
    })
  }

  function insertNote() {
    var target = bridge || DSN.bridge || null
    function copyAsFallback() {
      DSN.copyRich(note.html || '', note.text || '').then(function () {
        DSN.toast(t('status.noSession'), 'error')
      }, function () {
        DSN.toast(t('status.noSession'), 'error')
      })
    }
    if (!target || typeof target.insert !== 'function') {
      copyAsFallback()
      return
    }
    var result
    try {
      result = target.insert(note.html || '', note.text || '', t)
    } catch (error) {
      DSN.log('bridge insert failed', error)
      copyAsFallback()
      return
    }
    if (result && typeof result.then === 'function') {
      result.then(function (ok) {
        if (ok) DSN.toast(t('status.inserted'), 'info')
        else DSN.toast(t('status.noSession'), 'error')
      }, function (error) {
        DSN.log('bridge insert rejected', error)
        DSN.toast(t('status.noSession'), 'error')
      })
      return
    }
    var inserted = result === true
    DSN.toast(inserted ? t('status.inserted') : t('status.noSession'), inserted ? 'info' : 'error')
  }

  /**
   * Insert the note as a real quote block (the host's own QuoteNode), i.e. the
   * same thing 引用文本 does — the text arrives as a Markdown blockquote. The
   * note's hidden `origin` only decides the toast wording: DSH quotes pure text,
   * so a note captured in another conversation still quotes fine here.
   */
  function quoteNote() {
    var target = bridge || DSN.bridge || null
    var text = note.text || ''
    if (!text && typeof DSN.htmlToText === 'function') text = DSN.htmlToText(note.html || '')
    if (!text) return
    var quoted = false
    try {
      if (target && typeof target.quote === 'function') quoted = target.quote(text) === true
    } catch (error) {
      DSN.log('quote note failed', error)
      quoted = false
    }
    if (!quoted) {
      DSN.copyRich(note.html || '', text).then(function (ok) {
        DSN.toast(ok ? t('status.quotedCopied') : t('status.copyFailed'), ok ? 'info' : 'error')
      }, function (error) {
        DSN.log('quote fallback rejected', error)
        DSN.toast(t('status.copyFailed'), 'error')
      })
      return
    }
    var handle = null
    try {
      handle = target && typeof target.get === 'function' ? target.get() : null
    } catch (error) {
      handle = null
    }
    var origin = note.origin || null
    var elsewhere = !!(handle && handle.sessionId && origin && origin.sessionId && origin.sessionId !== handle.sessionId)
    if (elsewhere) {
      var name = origin.sessionTitle || '#' + String(origin.sessionId).slice(0, 6)
      DSN.toast(t('status.quotedOther', { name: name }), 'info')
      return
    }
    DSN.toast(t('status.quoted'), 'info')
  }

  function toggleExpand(event) {
    boardStop(event)
    boardPrevent(event)
    setExpanded(!expanded)
  }

  function onKeyDown(event) {
    if (event.target !== event.currentTarget) return
    var key = event.key
    if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
      boardPrevent(event)
      startEdit()
    } else if (key === 'Delete') {
      boardPrevent(event)
      removeNote()
    }
  }

  function onPointerDown(event) {
    suppressDragRef.current = !!DSN.closest(event.target, '[data-dsn-nodrag]')
  }

  function onDragStart(event) {
    if (editing || suppressDragRef.current) {
      boardPrevent(event)
      return
    }
    var dataTransfer = event.dataTransfer
    if (!dataTransfer) return
    try {
      dataTransfer.effectAllowed = 'copyMove'
      dataTransfer.setData(BOARD_NOTE_MIME, note.id)
      dataTransfer.setData('text/plain', note.text || '')
      dataTransfer.setData('text/html', boardDragHtml(note))
    } catch (error) {
      DSN.log('drag payload failed', error)
    }
    if (typeof drag.start === 'function') drag.start(note.id)
  }

  function onDragEnd() {
    suppressDragRef.current = false
    if (typeof drag.end === 'function') drag.end()
  }

  var actions = editing
    ? null
    : h('div', { className: 'dsn-note-actions' },
        h(BoardIconButton, {
          icon: 'pin',
          label: note.pinned ? t('note.unpin') : t('note.pin'),
          pressed: !!note.pinned,
          className: note.pinned ? 'is-active' : '',
          onClick: togglePin,
        }),
        h(BoardIconButton, {
          icon: 'copy',
          label: t('note.copy'),
          onClick: copyNote,
        }),
        h(BoardIconButton, {
          icon: 'quote',
          label: t('note.quote'),
          onClick: quoteNote,
        }),
        h(BoardIconButton, {
          icon: 'insert',
          label: t('note.insert'),
          onClick: insertNote,
        }),
        h(BoardIconButton, {
          icon: 'edit',
          label: t('note.edit'),
          onClick: startEdit,
        }),
        h(BoardIconButton, {
          icon: 'trash',
          label: t('note.delete'),
          className: 'is-danger',
          onClick: removeNote,
        }))

  var body = editing
    ? h('div', { className: 'dsn-note-edit', 'data-dsn-nodrag': '1' },
        h(DSN.Editor, {
          value: draft,
          onChange: changeDraft,
          onSubmit: saveEdit,
          placeholder: t('board.editPlaceholder'),
          autoFocus: true,
          minHeight: 88,
          t: t,
        }),
        h('div', { className: 'dsn-note-editbar' },
          h('span', { className: 'dsn-composer-hint' }, t('composer.saveHint')),
          h('button', {
            type: 'button',
            className: 'dsn-btn dsn-btn-tiny',
            'data-dsn-nodrag': '1',
            onPointerDown: boardPrevent,
            onClick: function (event) {
              boardPrevent(event)
              cancelEdit()
            },
          }, h('span', null, t('note.cancel'))),
          h('button', {
            type: 'button',
            className: 'dsn-btn dsn-btn-tiny dsn-btn-primary',
            'data-dsn-nodrag': '1',
            disabled: boardIsEmptyHtml(draft),
            onPointerDown: boardPrevent,
            onClick: function (event) {
              boardPrevent(event)
              saveEdit()
            },
          }, h('span', null, t('note.save')))))
    : h('div', { className: 'dsn-note-body' },
        h('div', {
          className: 'dsn-note-clamp' +
            (expanded ? ' is-expanded' : '') +
            (!expanded && overflowing ? ' is-clamped' : ''),
          ref: clampRef,
        },
          h(DSN.Content, { html: safeHtml, kind: note.kind })),
        showExpand
          ? h('button', {
              type: 'button',
              className: 'dsn-note-expand',
              'data-dsn-nodrag': '1',
              'aria-expanded': expanded ? 'true' : 'false',
              title: expanded ? t('board.collapseNote') : t('board.expandNote'),
              onPointerDown: boardPrevent,
              onClick: toggleExpand,
            },
              h(DSN.Icon, { name: expanded ? 'collapse' : 'expand', size: 11 }),
              h('span', null, expanded ? t('board.collapseNote') : t('board.expandNote')))
          : null)

  return h('article', {
    className: 'dsn-note' +
      (note.pinned ? ' is-pinned' : '') +
      (dragging ? ' is-dragging' : '') +
      (editing ? ' is-editing' : ''),
    'data-note-id': note.id,
    role: 'button',
    tabIndex: 0,
    'aria-label': title || kindLabel,
    draggable: editing ? false : true,
    onKeyDown: onKeyDown,
    onPointerDown: onPointerDown,
    onDragStart: onDragStart,
    onDragEnd: onDragEnd,
  },
    h('div', { className: 'dsn-note-head' },
      h('span', { className: 'dsn-note-kind', title: kindLabel, 'aria-hidden': 'true' },
        h(DSN.Icon, { name: BOARD_KIND_ICONS[kind] || 'note', size: 13 })),
      h('span', { className: 'dsn-note-age' }, DSN.formatAge(note.updatedAt, t)),
      note.pinned
        ? h('span', { className: 'dsn-note-flag', title: t('list.pinned') },
            h(DSN.Icon, { name: 'pin', size: 10 }),
            h('span', null, t('list.pinned')))
        : null,
      typeof DSN.PrioritySelect === 'function'
        ? h(DSN.PrioritySelect, { store: store, t: t, note: note })
        : null,
      actions),
    body,
    h('div', { className: 'dsn-note-foot' },
      h('div', { className: 'dsn-note-meta' },
        taskTotal
          ? h('button', {
              type: 'button',
              className: 'dsn-chip dsn-chip--btn' + (taskDone === taskTotal ? ' dsn-chip--warn' : ''),
              'data-dsn-nodrag': '1',
              title: t('detail.open'),
              onPointerDown: boardPrevent,
              onClick: openDetail,
            },
              h(DSN.Icon, { name: 'check', size: 11 }),
              h('span', null, t('task.progress', { done: taskDone, total: taskTotal })))
          : null,
        h('button', {
          type: 'button',
          className: 'dsn-chip dsn-chip--btn',
          'data-dsn-nodrag': '1',
          title: t('detail.open'),
          onPointerDown: boardPrevent,
          onClick: openDetail,
        },
          h(DSN.Icon, { name: 'quote', size: 11 }),
          h('span', null, commentCount ? t('comment.title') + ' ' + commentCount : t('comment.title'))),
        note.source && note.source.sessionTitle
          ? h('span', { className: 'dsn-chip dsn-note-source', title: note.source.sessionTitle },
              h(DSN.Icon, { name: 'note', size: 11 }),
              h('span', null, t('list.source', { name: note.source.sessionTitle })))
          : null)))
}

DSN.NoteCard = function NoteCard(props) {
  if (!props || !props.note) return null
  return h(NoteCardInner, props)
}

/* ------------------------------------------------------------------ *
 * board body
 * ------------------------------------------------------------------ */

function TrashDropZone(props) {
  var t = boardTranslate(props.t)
  var depth = boardUseDragDepth()
  return h('div', {
    className: 'dsn-dropzone' + (depth.active ? ' is-over' : ''),
    onDragEnter: function (event) {
      if (!boardIsNoteDrag(event.dataTransfer)) return
      boardPrevent(event)
      depth.enter()
    },
    onDragOver: function (event) {
      if (!boardIsNoteDrag(event.dataTransfer)) return
      boardPrevent(event)
      try {
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      } catch (error) { /* ignore */ }
    },
    onDragLeave: function (event) {
      if (!boardIsNoteDrag(event.dataTransfer)) return
      depth.leave(event)
    },
    onDrop: function (event) {
      if (!boardIsNoteDrag(event.dataTransfer)) return
      boardPrevent(event)
      boardStop(event)
      depth.reset()
      var noteId = boardReadNoteId(event.dataTransfer)
      if (noteId && typeof props.onDelete === 'function') props.onDelete(noteId)
    },
  },
    h(DSN.Icon, { name: 'trash', size: 13 }),
    h('span', null, t('trash.dropHint')))
}

function BoardBody(props) {
  var React = DSN.React
  var store = props.store
  var t = boardTranslate(props.t)
  var state = boardUseStore(store)

  var tickPair = React.useState(0)
  var setTick = tickPair[1]
  var dragPair = React.useState('')
  var dragId = dragPair[0]
  var setDragId = dragPair[1]
  var addingPair = React.useState(false)
  var addingSection = addingPair[0]
  var setAddingSection = addingPair[1]
  var dropDepthRef = React.useRef(0)
  var dropActivePair = React.useState(false)
  var dropActive = dropActivePair[0]
  var setDropActive = dropActivePair[1]

  /* Keep relative ages fresh without touching the store. */
  React.useEffect(function () {
    var timer = setInterval(function () {
      setTick(function (value) { return value + 1 })
    }, 60000)
    return function () { clearInterval(timer) }
  }, [])

  /* A drag always ends somewhere — clear the drag-only affordances. */
  React.useEffect(function () {
    if (!dragId) return undefined
    function clearDrag() { setDragId('') }
    var offDragEnd = DSN.on(document, 'dragend', clearDrag)
    var offDrop = DSN.on(document, 'drop', clearDrag)
    var offBlur = DSN.on(window, 'blur', clearDrag)
    return function () {
      offDragEnd()
      offDrop()
      offBlur()
    }
  }, [dragId])

  React.useEffect(function () {
    function reset() {
      dropDepthRef.current = 0
      setDropActive(false)
    }
    var offDragEnd = DSN.on(window, 'dragend', reset)
    var offDrop = DSN.on(window, 'drop', reset)
    var offBlur = DSN.on(window, 'blur', reset)
    return function () {
      offDragEnd()
      offDrop()
      offBlur()
    }
  }, [])

  function resetDrop() {
    dropDepthRef.current = 0
    setDropActive(false)
  }

  function dragStartNote(noteId) {
    setDragId(noteId || '')
  }

  function dragEndNote() {
    setDragId('')
  }

  function changeView(next) {
    store.actions.setView(next)
  }

  function changeSearch(value) {
    store.actions.setSearch(value)
  }

  function handleNoteDropDelete(noteId) {
    if (!noteId) return
    store.actions.deleteNote(noteId)
    setDragId('')
  }

  function onBoardDragEnter(event) {
    if (!boardIsExternalDrag(event.dataTransfer)) return
    boardPrevent(event)
    dropDepthRef.current += 1
    if (dropDepthRef.current === 1) setDropActive(true)
  }

  function onBoardDragOver(event) {
    if (!boardIsExternalDrag(event.dataTransfer)) return
    boardPrevent(event)
    try {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    } catch (error) { /* ignore */ }
  }

  function onBoardDragLeave(event) {
    if (!boardIsExternalDrag(event.dataTransfer)) return
    var node = event.currentTarget
    var related = event.relatedTarget
    if (node && related && typeof node.contains === 'function' && node.contains(related)) {
      dropDepthRef.current = Math.max(dropDepthRef.current - 1, 1)
      return
    }
    resetDrop()
  }

  function saveDroppedContent(dataTransfer) {
    if (typeof DSN.readDragContent !== 'function') return
    var pending
    try {
      pending = DSN.readDragContent(dataTransfer)
    } catch (error) {
      DSN.log('readDragContent failed', error)
      return
    }
    if (!pending || typeof pending.then !== 'function') return
    pending.then(function (payload) {
      if (!payload) return
      var text = typeof payload.text === 'string' ? payload.text : ''
      var html = typeof payload.html === 'string' ? payload.html : ''
      if (!html && text) html = boardTextToHtml(text)
      if (!html && !text) return
      if (!text) text = boardHtmlText(html)
      store.actions.addNote({ html: html, text: text })
      var snapshot = typeof store.getSnapshot === 'function' ? store.getSnapshot() : null
      if (snapshot && snapshot.ui && snapshot.ui.view === 'trash') store.actions.setView('board')
      DSN.toast(t('note.saved'), 'info')
    }, function (error) {
      DSN.log('drop payload rejected', error)
    })
  }

  function onBoardDrop(event) {
    if (!boardIsExternalDrag(event.dataTransfer)) return
    boardPrevent(event)
    resetDrop()
    saveDroppedContent(event.dataTransfer)
  }

  if (!state) {
    return h('div', { className: 'dsn-app', 'data-dsn-board': '1' },
      h(BoardEmpty, { icon: 'note', message: t('list.empty') }))
  }

  var ui = state.ui && typeof state.ui === 'object' ? state.ui : {}
  var notes = Array.isArray(state.notes) ? state.notes : []
  var sections = boardReadSections(state, t)
  var activeId = boardPickActiveId(sections, ui.activeSectionId)
  var view = ui.view === 'trash' ? 'trash' : (ui.view === 'tasks' ? 'tasks' : 'board')
  var query = typeof ui.search === 'string' ? ui.search : ''
  var sortMode = ui.sort === 'priority' ? 'priority' : 'time'
  var priorityFilter = DSN.PRIORITY_RANK[ui.priorityFilter] === undefined ? 'all' : ui.priorityFilter
  var hideDone = ui.hideDone === true
  var bridge = props.bridge || DSN.bridge || null

  var liveCount = 0
  var trashCount = 0
  var taskCount = 0
  var sectionCounts = {}
  var i
  for (i = 0; i < notes.length; i++) {
    var item = notes[i]
    if (!item) continue
    if (item.deletedAt) {
      trashCount += 1
      continue
    }
    liveCount += 1
    taskCount += boardOpenTasks(item)
    var sectionKey = item.sectionId || ''
    sectionCounts[sectionKey] = (sectionCounts[sectionKey] || 0) + 1
  }

  var visible = []
  if (view === 'trash') {
    for (i = 0; i < notes.length; i++) {
      var deleted = notes[i]
      if (!deleted || !deleted.deletedAt) continue
      if (!boardMatchesQuery(deleted, query)) continue
      visible.push(deleted)
    }
    visible.sort(function (a, b) { return (b.deletedAt || 0) - (a.deletedAt || 0) })
  } else {
    for (i = 0; i < notes.length; i++) {
      var live = notes[i]
      if (!live || live.deletedAt) continue
      if (activeId && live.sectionId !== activeId) continue
      if (priorityFilter !== 'all' && live.priority !== priorityFilter) continue
      if (hideDone && boardAllDone(live)) continue
      if (!boardMatchesQuery(live, query)) continue
      visible.push(live)
    }
    visible.sort(sortMode === 'priority' ? boardSortByPriority : boardSortNotes)
  }

  var emptyMessage
  var emptyIcon
  if (view === 'trash') {
    emptyMessage = query ? t('board.noResults') : t('list.trashEmpty')
    emptyIcon = query ? 'search' : 'trash'
  } else if (view === 'tasks') {
    emptyMessage = t('tasks.empty')
    emptyIcon = 'check'
  } else if (query) {
    emptyMessage = t('board.noResults')
    emptyIcon = 'search'
  } else if (liveCount === 0) {
    emptyMessage = t('list.empty')
    emptyIcon = 'note'
  } else {
    emptyMessage = t('list.emptySection')
    emptyIcon = 'sections'
  }

  var cards = visible.map(function (note) {
    return h(DSN.NoteCard, {
      key: note.id,
      store: store,
      t: t,
      note: note,
      bridge: bridge,
      drag: { id: dragId, start: dragStartNote, end: dragEndNote },
    })
  })

  var stream
  if (view === 'trash') {
    stream = h(DSN.TrashView, { store: store, t: t, notes: visible, query: query })
  } else if (view === 'tasks') {
    stream = h(DSN.TasksView, {
      store: store,
      t: t,
      state: state,
      sectionId: activeId && sections.length > 1 ? '' : activeId,
    })
  } else {
    stream = cards.length ? cards : h(BoardEmpty, { icon: emptyIcon, message: emptyMessage })
  }

  /* The detail sheet is a view of one note: the card stays in the stream, the
     sheet adds the checklist and the comment thread on top of the panel. */
  var detailNote = null
  if (ui.detailNoteId) {
    for (i = 0; i < notes.length; i += 1) {
      var candidate = notes[i]
      if (candidate && !candidate.deletedAt && candidate.id === ui.detailNoteId) {
        detailNote = candidate
        break
      }
    }
  }

  return h('div', {
    className: 'dsn-app',
    'data-dsn-board': '1',
    'data-dsn-view': view,
    onDragEnter: onBoardDragEnter,
    onDragOver: onBoardDragOver,
    onDragLeave: onBoardDragLeave,
    onDrop: onBoardDrop,
  },
    h(BoardToolbar, {
      t: t,
      view: view,
      liveCount: liveCount,
      trashCount: trashCount,
      taskCount: taskCount,
      sort: sortMode,
      priorityFilter: priorityFilter,
      hideDone: hideDone,
      search: query,
      onView: changeView,
      onSearch: changeSearch,
      onSort: function (next) { store.actions.setSort(next) },
      onPriorityFilter: function (next) { store.actions.setPriorityFilter(next) },
      onToggleHideDone: function () { store.actions.toggleHideDone() },
    }),
    view === 'board'
      ? h(DSN.SectionRail, {
        store: store,
        t: t,
        sections: sections,
        activeSectionId: activeId,
        counts: sectionCounts,
        adding: addingSection,
        onAddingChange: setAddingSection,
        onMoved: function () { setDragId('') },
      })
      : null,
    view === 'board'
      ? h(DSN.Composer, { store: store, t: t, sectionId: activeId })
      : null,
    dragId && view === 'board'
      ? h(TrashDropZone, { t: t, onDelete: handleNoteDropDelete })
      : null,
    h('div', {
      className: 'dsn-stream' + (dragId && view === 'board' ? ' is-drop-target' : ''),
    }, stream),
    h('div', { className: 'dsn-footer' },
      h('span', null, t('list.count', { n: visible.length })),
      typeof DSN.SyncStatus === 'function' ? h(DSN.SyncStatus, { t: t }) : null,
      h('span', { className: 'dsn-footer-hint', title: t('shortcuts.hint') },
        t('shortcuts.hint'))),
    dropActive
      ? h('div', { className: 'dsn-board-drop', 'aria-hidden': 'true' },
          h('div', { className: 'dsn-board-drop-inner' },
            h(DSN.Icon, { name: 'insert', size: 22 }),
            h('span', { className: 'dsn-board-drop-title' }, t('capture.dropHere')),
            h('span', { className: 'dsn-board-drop-sub' }, t('capture.dropRich'))))
      : null,
    detailNote && typeof DSN.NoteSheet === 'function'
      ? h(DSN.NoteSheet, { store: store, t: t, note: detailNote })
      : null)
}

/* ------------------------------------------------------------------ *
 * exported entry point
 * ------------------------------------------------------------------ */

DSN.NotesApp = function NotesApp(props) {
  if (!props || !props.store || typeof props.store.getSnapshot !== 'function') return null
  return h(BoardBody, props)
}

/* ------------------------------------------------------------------ *
 * styles
 *
 * Everything structural comes from the base chunk in 40-styles.js; this
 * chunk only adds the few board-specific joint pieces. All colours are
 * `var(--dsw-alias-*, <literal>)` so the board also works inside the PiP
 * window (70-pip copies the token names listed in DSN.TOKENS).
 * ------------------------------------------------------------------ */

var BOARD_CSS = [
  '.dsn-app { position: relative; }',
  '.dsn-board-rail-block { flex: 0 0 auto; min-width: 0; }',

  /* action rows that must be visible without hover */
  '.dsn-note-actions.is-always { opacity: 1; transform: none; }',
  '.dsn-note-actions .dsn-iconbtn.is-danger:hover {',
  '  color: var(--dsw-alias-state-error-primary, #ec1313);',
  '  background: var(--dsw-alias-interactive-bg-hover-danger, rgba(236, 19, 19, 0.05));',
  '}',

  /* recycled cards in the trash */
  '.dsn-note--trash { background: var(--dsw-alias-bg-module-platform, #f9fafb); }',
  '.dsn-note--trash .dsn-note-clamp { max-height: 4.65em; }',
  '.dsn-note--trash .dsn-note-actions { opacity: 1; transform: none; }',

  /* section chip: name, count, overflow "…" button, inline editor */
  '.dsn-board-chip-name { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  '.dsn-section-chip.is-editing { padding: 0 3px 0 4px; cursor: default; }',
  '.dsn-board-chip-more {',
  '  width: 18px; height: 18px; min-width: 18px; border-radius: 5px;',
  '  opacity: 0; transition: opacity 0.12s ease;',
  '}',
  '.dsn-section-chip:hover .dsn-board-chip-more,',
  '.dsn-section-chip.is-active .dsn-board-chip-more,',
  '.dsn-section-chip.is-over .dsn-board-chip-more,',
  '.dsn-section-chip:focus-within .dsn-board-chip-more { opacity: 0.9; }',
  '.dsn-board-chip-input { width: 108px; height: 22px; padding: 0 6px; font-size: 12px; }',
  '.dsn-board-mini { width: 20px; height: 20px; min-width: 20px; border-radius: 5px; }',

  /* section action menu: inline under the rail instead of floating */
  '.dsn-board-menu-inline {',
  '  position: static;',
  '  display: flex;',
  '  align-items: center;',
  '  flex-wrap: wrap;',
  '  gap: 4px;',
  '  min-width: 0;',
  '  margin: 0 12px 8px;',
  '  padding: 4px 6px;',
  '}',
  '.dsn-board-menu-inline .dsn-menu-item { width: auto; height: 26px; padding: 0 8px; }',
  '.dsn-board-menu-inline .dsn-menu-item:disabled { opacity: 0.45; cursor: default; }',
  '.dsn-board-menu-inline .dsn-menu-item:disabled:hover {',
  '  background: transparent;',
  '  color: var(--dsw-alias-state-error-primary, #ec1313);',
  '}',
  '.dsn-board-menu-label {',
  '  flex: 1 1 auto;',
  '  min-width: 0;',
  '  overflow: hidden;',
  '  text-overflow: ellipsis;',
  '  white-space: nowrap;',
  '  padding: 0 4px;',
  '  font-size: 12px;',
  '  font-weight: 600;',
  '  color: var(--dsw-alias-label-primary, #0f1115);',
  '}',

  /* composer footer helper text */
  '.dsn-board-save-hint {',
  '  flex: 0 0 auto;',
  '  color: var(--dsw-alias-label-caption, #adb2b8);',
  '  font-size: 11px;',
  '  white-space: nowrap;',
  '}',
  '.dsn-composer-foot .dsn-btn { margin-left: 2px; }',

  /* trash view head */
  '.dsn-board-trash { display: flex; flex-direction: column; gap: 8px; min-width: 0; }',
  '.dsn-board-trash-head { display: flex; align-items: center; gap: 8px; padding: 0 2px; }',
  '.dsn-board-trash-title {',
  '  font-size: 12px;',
  '  font-weight: 600;',
  '  color: var(--dsw-alias-label-secondary, #61666b);',
  '}',
  '.dsn-board-trash-head .dsn-btn { margin-left: auto; }',
  '.dsn-btn.is-armed {',
  '  background: var(--dsw-alias-interactive-bg-hover-danger, rgba(236, 19, 19, 0.05));',
  '}',

  /* external content drop overlay */
  '.dsn-board-drop {',
  '  position: absolute;',
  '  inset: 8px;',
  '  z-index: 8;',
  '  display: flex;',
  '  align-items: center;',
  '  justify-content: center;',
  '  border: 1.5px dashed var(--dsw-alias-state-business-primary, #4176e6);',
  '  border-radius: var(--dsn-radius-card, 10px);',
  '  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 7%, transparent);',
  '  pointer-events: none;',
  '}',
  '.dsn-board-drop-inner {',
  '  display: flex;',
  '  flex-direction: column;',
  '  align-items: center;',
  '  gap: 6px;',
  '  color: var(--dsw-alias-state-business-primary, #4176e6);',
  '}',
  '.dsn-board-drop-title { font-size: 13px; font-weight: 600; }',
  '.dsn-board-drop-sub {',
  '  font-size: 11.5px;',
  '  color: var(--dsw-alias-label-secondary, #61666b);',
  '}',

  /* coarse pointers never hover: keep card actions visible */
  '@media (hover: none) {',
  '  .dsn-note-actions { opacity: 1; transform: none; }',
  '}',
  '@media (prefers-reduced-motion: reduce) {',
  '  .dsn-note, .dsn-note-actions, .dsn-board-chip-more { transition: none; }',
  '}',
].join('\n')

if (typeof DSN.addCss === 'function') DSN.addCss('board', BOARD_CSS)

/* ================= 55-note-extra.js ================= */
/* ------------------------------------------------------------------ *
 * Priorities, checklists and comments.
 *
 * Three small surfaces that all hang off one note:
 *   - priority: a four-step scale, shown as a coloured pill that is also a
 *     native <select> so choosing one costs exactly one interaction;
 *   - tasks: a checklist with progress, edited in place or from the sheet;
 *   - comments: the "note about the note" thread, rendered with the same
 *     sanitizer and typography as the note body.
 * They live in their own fragment so 50-board.js only has to place them.
 * ------------------------------------------------------------------ */

;(function () {
  'use strict'

  var ReactDOM = require('react-dom')

  /* The panel is a backdrop-filter container, so a `position: fixed` popover
   * rendered inside it would be positioned against the panel instead of the
   * viewport. Menus are therefore portalled into <body> and placed by hand. */

  DSN.addStrings({
    'priority.urgent': '紧急',
    'priority.high': '高',
    'priority.normal': '普通',
    'priority.low': '低',
    'priority.label': '优先级',
    'tab.tasks': '待办',
    'filter.sort': '排序',
    'filter.sortTime': '时间',
    'filter.sortPriority': '优先级',
    'filter.priority': '优先级',
    'filter.all': '全部',
    'filter.hideDone': '隐藏已完成',
    'filter.hideDoneHint': '隐藏所有待办都已勾选的便签',
    'task.add': '添加待办',
    'task.title': '待办',
    'task.placeholder': '添加一条待办，回车保存',
    'task.progress': '{done}/{total}',
    'task.clearDone': '清空已完成',
    'task.remove': '删除待办',
    'task.empty': '这条便签还没有待办',
    'task.note': '所属便签',
    'comment.title': '评论',
    'comment.placeholder': '写下评论，Enter 发送，Shift+Enter 换行',
    'comment.send': '发送',
    'comment.empty': '还没有评论',
    'comment.remove': '删除评论',
    'comment.author': '我',
    'comment.hint': 'Enter 发送 · Shift+Enter 换行',
    'detail.title': '便签详情',
    'detail.open': '打开评论与待办',
    'detail.close': '关闭详情',
    'detail.emptyTask': '还没有待办',
    'tasks.title': '待办',
    'tasks.openTasks': '{n} 条待办',
    'tasks.groupNote': '便签',
    'tasks.empty': '所有便签都没有未完成的待办',
    'tasks.summary': '{open} 条未完成 · {notes} 个便签',
    'tasks.emptySection': '这个分区还没有待办',
  }, {
    'priority.urgent': 'Urgent',
    'priority.high': 'High',
    'priority.normal': 'Normal',
    'priority.low': 'Low',
    'priority.label': 'Priority',
    'tab.tasks': 'To-dos',
    'filter.sort': 'Sort',
    'filter.sortTime': 'Time',
    'filter.sortPriority': 'Priority',
    'filter.priority': 'Priority',
    'filter.all': 'All',
    'filter.hideDone': 'Hide finished',
    'filter.hideDoneHint': 'Hide notes whose checklist is fully done',
    'task.add': 'Add to-do',
    'task.title': 'To-do',
    'task.placeholder': 'Add a to-do, press Enter',
    'task.progress': '{done}/{total}',
    'task.clearDone': 'Clear finished',
    'task.remove': 'Remove to-do',
    'task.empty': 'This note has no to-dos yet',
    'task.note': 'Note',
    'comment.title': 'Comments',
    'comment.placeholder': 'Write a comment — Enter sends, Shift+Enter breaks the line',
    'comment.send': 'Send',
    'comment.empty': 'No comments yet',
    'comment.remove': 'Remove comment',
    'comment.author': 'Me',
    'comment.hint': 'Enter sends · Shift+Enter breaks the line',
    'detail.title': 'Note details',
    'detail.open': 'Open comments and to-dos',
    'detail.close': 'Close details',
    'detail.emptyTask': 'No to-dos yet',
    'tasks.title': 'To-dos',
    'tasks.openTasks': '{n} open',
    'tasks.groupNote': 'Note',
    'tasks.empty': 'No open to-dos across all notes',
    'tasks.summary': '{open} open across {notes} notes',
    'tasks.emptySection': 'No to-dos in this section yet',
  })

  DSN.PRIORITY_META = {
    urgent: {
      token: 'var(--dsw-alias-label-error, #d9534f)',
      soft: 'color-mix(in srgb, var(--dsw-alias-label-error, #d9534f) 13%, transparent)',
    },
    high: {
      token: 'var(--dsw-alias-state-business-primary, #4176e6)',
      soft: 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 13%, transparent)',
    },
    normal: {
      token: 'var(--dsw-alias-label-secondary, #6b7280)',
      soft: 'color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 10%, transparent)',
    },
    low: {
      token: 'var(--dsw-alias-label-tertiary, #adb2b8)',
      soft: 'transparent',
    },
  }

  DSN.priorityMeta = function (priority) {
    return DSN.PRIORITY_META[priority] || DSN.PRIORITY_META.normal
  }

  function extraPrevent(event) {
    if (event && event.preventDefault) event.preventDefault()
  }

  function extraStop(event) {
    if (event && event.stopPropagation) event.stopPropagation()
  }

  /* ------------------------------------------------------------------ *
   * priority
   * ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ *
   * select menu
   *
   * A themed replacement for the native <select>: the browser control brings
   * its own OS styling that clashes with the board, so every choice is a pill
   * button plus a portalled popover that matches the rest of the UI.
   *
   * props: { t, value, options: [{ value, label, dot? }], onChange(value),
   *          variant: 'filter' | 'pill', ariaLabel?, title?, className? }
   * ------------------------------------------------------------------ */

  var MENU_Z = 2147483005

  DSN.SelectMenu = function SelectMenu(props) {
    var React = DSN.React
    var t = props.t || DSN.fallbackT
    var options = props.options || []
    var variant = props.variant === 'pill' ? 'pill' : 'filter'
    var openState = React.useState(false)
    var open = openState[0]
    var setOpen = openState[1]
    var activeState = React.useState(-1)
    var active = activeState[0]
    var setActive = activeState[1]
    var btnRef = React.useRef(null)
    var menuRef = React.useRef(null)

    var currentIndex = -1
    for (var i = 0; i < options.length; i += 1) {
      if (options[i].value === props.value) currentIndex = i
    }
    var currentOption = currentIndex >= 0 ? options[currentIndex] : null

    function closeMenu(refocus) {
      setOpen(false)
      setActive(-1)
      if (refocus && btnRef.current && typeof btnRef.current.focus === 'function') btnRef.current.focus()
    }

    function choose(index) {
      var option = options[index]
      closeMenu(true)
      if (!option) return
      if (option.value !== props.value && typeof props.onChange === 'function') props.onChange(option.value)
    }

    function placeMenu() {
      var button = btnRef.current
      var menu = menuRef.current
      if (!button || !menu || typeof button.getBoundingClientRect !== 'function') return
      var anchor = button.getBoundingClientRect()
      var box = menu.getBoundingClientRect()
      var vw = window.innerWidth || 1024
      var vh = window.innerHeight || 768
      var left = Math.min(Math.max(6, anchor.left), Math.max(6, vw - box.width - 6))
      var top = anchor.bottom + 4
      if (top + box.height > vh - 6) top = Math.max(6, anchor.top - box.height - 4)
      menu.style.left = Math.round(left) + 'px'
      menu.style.top = Math.round(top) + 'px'
      menu.style.minWidth = Math.round(Math.max(anchor.width, 132)) + 'px'
      menu.style.visibility = 'visible'
    }

    React.useEffect(function () {
      if (open) placeMenu()
    }, [open])

    React.useEffect(function () {
      if (!open) return undefined

      function onPointerDown(event) {
        var menu = menuRef.current
        var button = btnRef.current
        if (menu && menu.contains && menu.contains(event.target)) return
        if (button && button.contains && button.contains(event.target)) return
        setOpen(false)
        setActive(-1)
      }

      function onKeyDown(event) {
        var count = options.length
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          closeMenu(true)
          return
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          var step = event.key === 'ArrowDown' ? 1 : -1
          setActive(function (previous) {
            var base = previous < 0 ? (step > 0 ? -1 : 0) : previous
            return (base + step + count + count) % count
          })
          return
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          event.stopPropagation()
          choose(active >= 0 ? active : currentIndex)
          return
        }
        if (event.key === 'Tab') {
          setOpen(false)
          setActive(-1)
        }
      }

      document.addEventListener('pointerdown', onPointerDown, true)
      document.addEventListener('keydown', onKeyDown, true)
      window.addEventListener('resize', placeMenu)
      window.addEventListener('scroll', placeMenu, true)
      return function () {
        document.removeEventListener('pointerdown', onPointerDown, true)
        document.removeEventListener('keydown', onKeyDown, true)
        window.removeEventListener('resize', placeMenu)
        window.removeEventListener('scroll', placeMenu, true)
      }
    }, [open, active, props.value, options.length])

    function toggle() {
      if (open) {
        closeMenu(false)
        return
      }
      setActive(currentIndex)
      setOpen(true)
    }

    var triggerClass = variant === 'pill'
      ? 'dsn-prio dsn-prio--' + (currentOption ? currentOption.value : DSN.DEFAULT_PRIORITY) + ' dsn-prio--pick dsn-select--pill'
      : 'dsn-select dsn-select--filter'

    var trigger = h('button', {
      ref: btnRef,
      type: 'button',
      className: triggerClass + (open ? ' is-open' : '') + (props.className ? ' ' + props.className : ''),
      title: props.title || props.ariaLabel || undefined,
      'aria-haspopup': 'listbox',
      'aria-expanded': open ? 'true' : 'false',
      'aria-label': props.ariaLabel || undefined,
      'data-dsn-nodrag': '1',
      'data-dsn-select': variant,
      'data-value': props.value,
      onPointerDown: function (event) { event.preventDefault(); event.stopPropagation() },
      onClick: function (event) { event.preventDefault(); event.stopPropagation(); toggle() },
    },
      currentOption && currentOption.dot
        ? h('span', { className: 'dsn-prio-dot', style: { background: currentOption.dot }, 'aria-hidden': 'true' })
        : null,
      h('span', { className: 'dsn-select-text' }, currentOption ? currentOption.label : ''),
      h('span', { className: 'dsn-select-chevron', 'aria-hidden': 'true' }, h(DSN.Icon, { name: 'chevron', size: 10 })))

    var menu = open ? ReactDOM.createPortal(
      h('div', {
        ref: menuRef,
        className: 'dsn-menu',
        role: 'listbox',
        'aria-label': props.ariaLabel || undefined,
        'data-dsn-menu': '1',
        style: { zIndex: MENU_Z, visibility: 'hidden' },
      },
        options.map(function (option, index) {
          var selected = option.value === props.value
          return h('button', {
            key: option.value,
            type: 'button',
            role: 'option',
            className: 'dsn-menu-item' + (selected ? ' is-selected' : '') + (index === active ? ' is-active' : ''),
            'aria-selected': selected ? 'true' : 'false',
            'data-value': option.value,
            onPointerDown: function (event) { event.preventDefault() },
            onMouseEnter: function () { setActive(index) },
            onClick: function (event) { event.preventDefault(); event.stopPropagation(); choose(index) },
          },
            option.dot ? h('span', { className: 'dsn-menu-dot', style: { background: option.dot }, 'aria-hidden': 'true' }) : null,
            h('span', { className: 'dsn-menu-label' }, option.label),
            selected ? h('span', { className: 'dsn-menu-check', 'aria-hidden': 'true' }, h(DSN.Icon, { name: 'check', size: 12 })) : null)
        })),
      document.body) : null

    return h('span', { className: 'dsn-select-wrap' }, trigger, menu)
  }

  /** Coloured read-only pill (used in the tasks view and the sheet header). */
  DSN.PriorityPill = function PriorityPill(props) {
    var t = props.t || DSN.fallbackT
    var priority = DSN.PRIORITY_RANK[props.priority] === undefined ? DSN.DEFAULT_PRIORITY : props.priority
    var meta = DSN.priorityMeta(priority)
    return h('span', {
      className: 'dsn-prio dsn-prio--' + priority + (props.className ? ' ' + props.className : ''),
      title: t('priority.label') + ' · ' + t('priority.' + priority),
      'data-priority': priority,
    },
      h('span', { className: 'dsn-prio-dot', 'aria-hidden': 'true' }),
      h('span', { className: 'dsn-prio-text' }, t('priority.' + priority)))
  }

  /** Priority pill that opens the four-step menu. */
  DSN.PrioritySelect = function PrioritySelect(props) {
    var t = props.t || DSN.fallbackT
    var note = props.note || {}
    var priority = DSN.PRIORITY_RANK[note.priority] === undefined ? DSN.DEFAULT_PRIORITY : note.priority
    return h(DSN.SelectMenu, {
      t: t,
      variant: 'pill',
      value: priority,
      className: props.className,
      ariaLabel: t('priority.label'),
      title: t('priority.label'),
      options: DSN.PRIORITIES.map(function (name) {
        return { value: name, label: t('priority.' + name), dot: DSN.priorityMeta(name).token }
      }),
      onChange: function (next) {
        if (props.store && props.store.actions) props.store.actions.setPriority(note.id, next)
      },
    })
  }

  /* ------------------------------------------------------------------ *
   * checklist
   * ------------------------------------------------------------------ */

  DSN.TaskList = function TaskList(props) {
    var React = DSN.React
    var store = props.store
    var t = props.t || DSN.fallbackT
    var note = props.note || {}
    var tasks = Array.isArray(note.tasks) ? note.tasks : []
    var done = 0
    for (var i = 0; i < tasks.length; i += 1) if (tasks[i].done) done += 1
    var inputRef = React.useRef(null)

    function addFromInput() {
      var node = inputRef.current
      if (!node) return
      var value = String(node.value || '').trim()
      if (!value) return
      if (store.actions.addTask(note.id, value)) node.value = ''
      node.focus()
    }

    function onAddKeyDown(event) {
      if (event.key === 'Enter') {
        extraPrevent(event)
        extraStop(event)
        addFromInput()
      } else if (event.key === 'Escape') {
        extraStop(event)
        if (inputRef.current) inputRef.current.value = ''
      }
    }

    var rows = tasks.map(function (task) {
      return h('div', {
        key: task.id,
        className: 'dsn-task' + (task.done ? ' is-done' : ''),
        'data-dsn-nodrag': '1',
      },
        h('input', {
          className: 'dsn-task-check',
          type: 'checkbox',
          checked: task.done === true,
          'aria-label': task.text,
          onChange: function () { store.actions.toggleTask(note.id, task.id) },
        }),
        h('span', { className: 'dsn-task-text', title: task.text }, task.text),
        h('button', {
          type: 'button',
          className: 'dsn-task-remove',
          'aria-label': t('task.remove'),
          title: t('task.remove'),
          tabIndex: -1,
          onPointerDown: extraPrevent,
          onClick: function (event) {
            extraStop(event)
            store.actions.removeTask(note.id, task.id)
          },
        }, h(DSN.Icon, { name: 'close', size: 11 })))
    })

    var showTitle = !!props.sheet
    var head = (showTitle || tasks.length)
      ? h('div', { className: 'dsn-tasks-head' },
        showTitle ? h('span', { className: 'dsn-tasks-title' }, t('task.title')) : null,
        tasks.length
          ? h('span', { className: 'dsn-tasks-progress' }, t('task.progress', { done: done, total: tasks.length }))
          : null,
        tasks.length
          ? h('span', { className: 'dsn-tasks-bar', 'aria-hidden': 'true' },
            h('span', {
              className: 'dsn-tasks-bar-fill',
              style: { width: (tasks.length ? Math.round((done / tasks.length) * 100) : 0) + '%' },
            }))
          : null,
        done > 0
          ? h('button', {
            type: 'button',
            className: 'dsn-tasks-clear',
            'data-dsn-nodrag': '1',
            onPointerDown: extraPrevent,
            onClick: function (event) {
              extraStop(event)
              store.actions.clearDoneTasks(note.id)
            },
          }, t('task.clearDone'))
          : null)
      : null

    return h('div', { className: 'dsn-tasks' + (props.sheet ? ' dsn-tasks--sheet' : ''), 'data-dsn-nodrag': '1' },
      head,
      rows,
      h('div', { className: 'dsn-task-add' },
        h(DSN.Icon, { name: 'plus', size: 12 }),
        h('input', {
          ref: inputRef,
          className: 'dsn-task-input',
          type: 'text',
          placeholder: t('task.placeholder'),
          'aria-label': t('task.add'),
          spellCheck: false,
          'data-dsn-nodrag': '1',
          onKeyDown: onAddKeyDown,
        })))
  }

  /* ------------------------------------------------------------------ *
   * comments
   * ------------------------------------------------------------------ */

  DSN.CommentThread = function CommentThread(props) {
    var React = DSN.React
    var store = props.store
    var t = props.t || DSN.fallbackT
    var note = props.note || {}
    var comments = Array.isArray(note.comments) ? note.comments : []
    var compact = props.compact === true
    var draftRef = React.useRef(null)

    function send() {
      var node = draftRef.current
      if (!node) return
      var value = String(node.value || '').trim()
      if (!value) return
      var html = typeof DSN.textToHtml === 'function' ? DSN.textToHtml(value) : value
      var id = store.actions.addComment(note.id, html, value)
      if (!id) return
      node.value = ''
      node.focus()
      DSN.toast(t('comment.send'), 'info')
    }

    function onDraftKeyDown(event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        extraPrevent(event)
        extraStop(event)
        send()
      }
    }

    var rows = comments.map(function (comment) {
      var safe = ''
      try {
        safe = typeof DSN.sanitizeHtml === 'function' ? DSN.sanitizeHtml(comment.html || '') : ''
      } catch (error) {
        DSN.log('comment render failed', error)
      }
      return h('div', { key: comment.id, className: 'dsn-comment', 'data-dsn-nodrag': '1' },
        h('div', { className: 'dsn-comment-main' },
          h('div', { className: 'dsn-comment-head' },
            h('span', { className: 'dsn-comment-name' }, t('comment.author')),
            h('span', { className: 'dsn-comment-dot', 'aria-hidden': 'true' }, '·'),
            h('span', { className: 'dsn-comment-age' }, DSN.formatAge(comment.createdAt, t)),
            h('button', {
              type: 'button',
              className: 'dsn-comment-remove',
              'aria-label': t('comment.remove'),
              title: t('comment.remove'),
              tabIndex: -1,
              onPointerDown: extraPrevent,
              onClick: function (event) {
                extraStop(event)
                store.actions.removeComment(note.id, comment.id)
              },
            }, h(DSN.Icon, { name: 'close', size: 11 }))),
          h('div', { className: 'dsn-comment-body' },
            h(DSN.Content, { html: safe, kind: 'text' }))))
    })

    return h('div', {
      className: 'dsn-comments' + (compact ? ' dsn-comments--compact' : ''),
      'data-dsn-comments': '1',
      'data-dsn-comments-compact': compact ? '1' : undefined,
    },
      h('div', { className: 'dsn-comments-head' },
        h('span', { className: 'dsn-comments-title' }, t('comment.title')),
        h('span', { className: 'dsn-comments-count' }, String(comments.length))),
      comments.length
        ? h('div', { className: 'dsn-comment-list' }, rows)
        : h('p', { className: 'dsn-comments-empty' }, t('comment.empty')),
      h('div', { className: 'dsn-comment-form', 'data-dsn-nodrag': '1' },
        h('textarea', {
          ref: draftRef,
          className: 'dsn-comment-input',
          rows: compact ? 1 : 2,
          placeholder: t('comment.placeholder'),
          'aria-label': t('comment.title'),
          spellCheck: false,
          'data-dsn-nodrag': '1',
          onKeyDown: onDraftKeyDown,
          onPointerDown: function (event) { event.stopPropagation() },
        }),
        h('div', { className: 'dsn-comment-formbar' },
          h('span', { className: 'dsn-comment-hint' }, t('comment.hint')),
          h('button', {
            type: 'button',
            className: 'dsn-btn dsn-btn-tiny dsn-btn-primary',
            'data-dsn-nodrag': '1',
            onPointerDown: extraPrevent,
            onClick: function (event) {
              extraStop(event)
              send()
            },
          }, h('span', null, t('comment.send'))))))
  }

  /* ------------------------------------------------------------------ *
   * detail sheet — the full note: body, checklist, comments
   * ------------------------------------------------------------------ */

  DSN.NoteSheet = function NoteSheet(props) {
    var React = DSN.React
    var t = props.t || DSN.fallbackT
    var note = props.note
    if (!note) return null
    var store = props.store
    var cardRef = React.useRef(null)
    /* Focus the sheet so Escape lands here first: we preventDefault before the
       document handler sees the key, which keeps the panel itself open. */
    React.useEffect(function () {
      var node = cardRef.current
      if (!node) return undefined
      try {
        node.focus({ preventScroll: true })
      } catch (error) { /* older engines ignore the options object */ }
      function onKeyDown(event) {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        store.actions.setDetail(null)
      }
      node.addEventListener('keydown', onKeyDown)
      return function () { node.removeEventListener('keydown', onKeyDown) }
    }, [note.id])
    var safe = ''
    try {
      safe = typeof DSN.sanitizeHtml === 'function' ? DSN.sanitizeHtml(note.html || '') : ''
    } catch (error) {
      DSN.log('sheet sanitize failed', error)
    }
    var title = note.title || DSN.headline(note.text || '', 80) || t('detail.title')
    return h('div', {
      className: 'dsn-sheet',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': t('detail.title'),
      onPointerDown: function (event) { event.stopPropagation() },
    },
      h('div', { className: 'dsn-sheet-card', ref: cardRef, tabIndex: -1 },
        h('div', { className: 'dsn-sheet-head' },
          h('span', { className: 'dsn-sheet-title', title: title }, title),
          h(DSN.PrioritySelect, { store: store, t: t, note: note }),
          h('button', {
            type: 'button',
            className: 'dsn-sheet-close',
            'aria-label': t('detail.close'),
            title: t('detail.close'),
            onPointerDown: extraPrevent,
            onClick: function (event) {
              extraStop(event)
              store.actions.setDetail(null)
            },
          }, h(DSN.Icon, { name: 'close', size: 13 }))),
        h('div', { className: 'dsn-sheet-meta' },
          h('span', { className: 'dsn-comment-age' }, DSN.formatAge(note.updatedAt, t)),
          note.source && note.source.sessionTitle
            ? h('span', { className: 'dsn-chip dsn-note-source', title: note.source.sessionTitle },
              h(DSN.Icon, { name: 'note', size: 11 }),
              h('span', null, t('list.source', { name: note.source.sessionTitle })))
            : null),
        h('div', { className: 'dsn-sheet-body' },
          safe ? h('div', { className: 'dsn-sheet-content' }, h(DSN.Content, { html: safe, kind: note.kind })) : null,
          h(DSN.TaskList, { store: store, t: t, note: note, sheet: true }),
          h(DSN.CommentThread, { store: store, t: t, note: note }))))
  }

  /* ------------------------------------------------------------------ *
   * aggregated to-do view
   * ------------------------------------------------------------------ */

  DSN.TasksView = function TasksView(props) {
    var t = props.t || DSN.fallbackT
    var store = props.store
    var state = props.state || {}
    var ui = state.ui || {}
    var notes = Array.isArray(state.notes) ? state.notes : []
    var query = typeof ui.search === 'string' ? ui.search.toLowerCase() : ''
    var hideDone = ui.hideDone === true
    var sectionId = props.sectionId || ''
    var groups = []
    var openCount = 0
    var i
    var j

    for (i = 0; i < notes.length; i += 1) {
      var note = notes[i]
      if (!note || note.deletedAt) continue
      if (sectionId && note.sectionId !== sectionId) continue
      var tasks = Array.isArray(note.tasks) ? note.tasks : []
      if (!tasks.length) continue
      var rows = []
      var open = 0
      for (j = 0; j < tasks.length; j += 1) {
        if (hideDone && tasks[j].done) continue
        if (!tasks[j].done) open += 1
        rows.push({ note: note, task: tasks[j] })
      }
      if (!rows.length) continue
      if (query && String(note.text || '').toLowerCase().indexOf(query) < 0) {
        var matched = rows.filter(function (row) {
          return String(row.task.text || '').toLowerCase().indexOf(query) >= 0
        })
        rows = matched
        if (!rows.length) continue
      }
      openCount += open
      groups.push({ note: note, rows: rows, open: open })
    }

    groups.sort(function (a, b) {
      var rankA = DSN.PRIORITY_RANK[a.note.priority] || 0
      var rankB = DSN.PRIORITY_RANK[b.note.priority] || 0
      if (rankA !== rankB) return rankB - rankA
      return (b.note.updatedAt || 0) - (a.note.updatedAt || 0)
    })

    if (!groups.length) {
      return h('div', { className: 'dsn-tasksview' },
        h('div', { className: 'dsn-empty' },
          h('span', { className: 'dsn-empty-icon', 'aria-hidden': 'true' },
            h(DSN.Icon, { name: 'check', size: 20 })),
          h('p', { className: 'dsn-empty-text' }, t('tasks.empty'))))
    }

    return h('div', { className: 'dsn-tasksview', 'data-open-tasks': String(openCount) },
      h('div', { className: 'dsn-tasks-summary' },
        h(DSN.Icon, { name: 'check', size: 12 }),
        h('span', null, t('tasks.summary', { open: openCount, notes: groups.length }))),
      groups.map(function (group) {
        var note = group.note
        var title = note.title || DSN.headline(note.text || '', 48) || t('detail.title')
        return h('div', { key: note.id, className: 'dsn-tasksgroup' },
          h('button', {
            type: 'button',
            className: 'dsn-tasksgroup-title',
            title: t('detail.open'),
            onClick: function () { store.actions.setDetail(note.id) },
          },
            h(DSN.PriorityPill, { t: t, priority: note.priority }),
            h('span', { className: 'dsn-tasksgroup-label' }, title),
            h('span', { className: 'dsn-tasksgroup-count' }, t('tasks.openTasks', { n: group.open }))),
          group.rows.map(function (row) {
            return h('div', {
              key: row.task.id,
              className: 'dsn-task' + (row.task.done ? ' is-done' : ''),
            },
              h('input', {
                className: 'dsn-task-check',
                type: 'checkbox',
                checked: row.task.done === true,
                'aria-label': row.task.text,
                onChange: function () { store.actions.toggleTask(note.id, row.task.id) },
              }),
              h('span', { className: 'dsn-task-text' }, row.task.text))
          }))
      }))
  }

  /* ------------------------------------------------------------------ *
   * styles
   * ------------------------------------------------------------------ */

  DSN.addCss('extra', [
    /* priority pill */
    '.dsn-prio { display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto;',
    '  height: 18px; padding: 0 7px; border-radius: 999px; border: none;',
    '  background: transparent; color: var(--dsw-alias-label-secondary, #6b7280);',
    '  font-family: inherit; font-size: 11px; font-weight: 500; line-height: 18px; white-space: nowrap; }',
    '.dsn-prio--urgent { color: var(--dsw-alias-label-error, #d9534f); background: color-mix(in srgb, var(--dsw-alias-label-error, #d9534f) 13%, transparent); }',
    '.dsn-prio--high { color: var(--dsw-alias-state-business-primary, #4176e6); background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 13%, transparent); }',
    '.dsn-prio--normal { background: color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 10%, transparent); }',
    '.dsn-prio--low { color: var(--dsw-alias-label-tertiary, #adb2b8); background: color-mix(in srgb, var(--dsw-alias-label-tertiary, #adb2b8) 8%, transparent); }',
    '.dsn-prio-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: 0 0 auto; }',
    '.dsn-prio-text { max-width: 44px; overflow: hidden; text-overflow: ellipsis; }',
    '.dsn-prio--pick { padding: 0 5px 0 7px; gap: 4px; cursor: pointer; transition: background-color 0.14s ease; }',
    '.dsn-prio--pick:hover { background: color-mix(in srgb, currentColor 18%, transparent); }',
    '.dsn-prio--pick:focus-visible { outline: 2px solid var(--dsw-alias-interactive-bg-hover-accent, #b9c6f5); outline-offset: -1px; }',
    '.dsn-prio--pick .dsn-select-text { max-width: 44px; overflow: hidden; text-overflow: ellipsis; }',
    /* select trigger + popover menu */
    '.dsn-select-wrap { display: inline-flex; align-items: center; flex: 0 0 auto; }',
    '.dsn-select { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 5px 0 7px;',
    '  border: 1px solid transparent; border-radius: 7px; background: transparent;',
    '  color: var(--dsw-alias-label-secondary, #6b7280); font-family: inherit; font-size: 11.5px;',
    '  font-weight: 500; line-height: 1; cursor: pointer; transition: background-color 0.14s ease, color 0.14s ease; }',
    '.dsn-select:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(15,17,21,0.06)); color: var(--dsw-alias-label-primary, #0f1115); }',
    '.dsn-select.is-open { background: var(--dsw-alias-interactive-bg-hover, rgba(15,17,21,0.06)); color: var(--dsw-alias-label-primary, #0f1115); }',
    '.dsn-select:focus-visible { outline: 2px solid var(--dsw-alias-interactive-bg-hover-accent, #b9c6f5); outline-offset: -1px; }',
    '.dsn-select-text { max-width: 76px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.dsn-select-chevron { display: inline-flex; align-items: center; opacity: 0.55; transition: transform 0.14s ease; }',
    '.dsn-select.is-open .dsn-select-chevron { transform: rotate(180deg); opacity: 0.8; }',
    '.dsn-menu { position: fixed; z-index: 2147483005; display: block; padding: 4px; margin: 0;',
    '  min-width: 132px; max-width: 240px; box-sizing: border-box; border-radius: 10px;',
    '  background: var(--dsw-alias-bg-layer-1, #ffffff); border: 1px solid var(--dsw-alias-border-l2, rgba(11,12,15,0.12));',
    '  box-shadow: 0 10px 28px color-mix(in srgb, #000 18%, transparent), 0 1px 2px color-mix(in srgb, #000 10%, transparent); }',
    '.dsn-menu-item { display: flex; align-items: center; gap: 7px; width: 100%; box-sizing: border-box;',
    '  height: 28px; padding: 0 8px; border: 0; border-radius: 7px; background: transparent;',
    '  color: var(--dsw-alias-label-primary, #0f1115); font-family: inherit; font-size: 12px;',
    '  font-weight: 500; line-height: 1; text-align: left; cursor: pointer; }',
    '.dsn-menu-item:hover, .dsn-menu-item.is-active { background: var(--dsw-alias-interactive-bg-hover, rgba(15,17,21,0.06)); }',
    '.dsn-menu-item.is-selected { font-weight: 600; }',
    '.dsn-menu-dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }',
    '.dsn-menu-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.dsn-menu-check { flex: 0 0 auto; display: inline-flex; align-items: center;',
    '  color: var(--dsw-alias-state-business-primary, #4176e6); }',
    /* checklist */
    '.dsn-tasks { display: flex; flex-direction: column; gap: 2px; padding: 6px 0 0; }',
    '.dsn-tasks--sheet { padding-top: 10px; border-top: 1px solid var(--dsw-alias-border-l2, rgba(11,12,15,0.08)); margin-top: 10px; }',
    '.dsn-tasks-head { display: flex; align-items: center; gap: 6px; padding: 0 2px 4px; }',
    '.dsn-tasks-title { flex: 0 0 auto; font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary, #6b7280); letter-spacing: 0.02em; }',
    '.dsn-tasks-progress { font-size: 10.5px; color: var(--dsw-alias-label-tertiary, #adb2b8); flex: 0 0 auto; }',
    '.dsn-tasks-bar { flex: 1 1 auto; height: 3px; border-radius: 2px; background: color-mix(in srgb, var(--dsw-alias-label-primary, #0f1115) 10%, transparent); overflow: hidden; }',
    '.dsn-tasks-bar-fill { display: block; height: 100%; border-radius: 2px; background: var(--dsw-alias-state-business-primary, #4176e6); transition: width 160ms ease; }',
    '.dsn-tasks-clear { border: 0; background: transparent; color: var(--dsw-alias-label-tertiary, #adb2b8);',
    '  font-size: 10.5px; cursor: pointer; padding: 2px 4px; border-radius: 4px; }',
    '.dsn-tasks-clear:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(15,17,21,0.06)); color: var(--dsw-alias-label-secondary, #6b7280); }',
    '.dsn-task { display: flex; align-items: flex-start; gap: 6px; padding: 2px 2px; border-radius: 5px; }',
    '.dsn-task:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(15,17,21,0.04)); }',
    '.dsn-task-check { width: 13px; height: 13px; margin: 2px 0 0; flex: 0 0 auto; accent-color: var(--dsw-alias-state-business-primary, #4176e6); cursor: pointer; }',
    '.dsn-task-text { flex: 1 1 auto; font-size: 12px; line-height: 1.55; color: var(--dsw-alias-label-primary, #0f1115);',
    '  word-break: break-word; min-width: 0; }',
    '.dsn-task.is-done .dsn-task-text { color: var(--dsw-alias-label-tertiary, #adb2b8); text-decoration: line-through; }',
    '.dsn-task-remove { flex: 0 0 auto; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center;',
    '  border: 0; background: transparent; color: var(--dsw-alias-label-tertiary, #adb2b8); opacity: 0; cursor: pointer;',
    '  border-radius: 4px; padding: 0; }',
    '.dsn-task:hover .dsn-task-remove, .dsn-task-remove:focus-visible { opacity: 1; }',
    '.dsn-task-add { display: flex; align-items: center; gap: 6px; padding: 3px 2px 0; color: var(--dsw-alias-label-tertiary, #adb2b8); }',
    '.dsn-task-input { flex: 1 1 auto; border: 0; background: transparent; outline: none; font-size: 12px;',
    '  color: var(--dsw-alias-label-primary, #0f1115); padding: 3px 0; min-width: 0; }',
    '.dsn-task-input::placeholder { color: var(--dsw-alias-label-tertiary, #adb2b8); }',
    /* comments */
    '.dsn-comments { display: flex; flex-direction: column; gap: 6px; padding: 10px 0 0; margin-top: 10px;',
    '  border-top: 1px solid var(--dsw-alias-border-l2, rgba(11,12,15,0.08)); }',
    '.dsn-comments-head { display: flex; align-items: center; gap: 6px; }',
    '.dsn-comments-title { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary, #6b7280); letter-spacing: 0.02em; }',
    '.dsn-comments-count { font-size: 10.5px; color: var(--dsw-alias-label-tertiary, #adb2b8); }',
    '.dsn-comments-empty { margin: 0; font-size: 11.5px; color: var(--dsw-alias-label-tertiary, #adb2b8); }',
    '.dsn-comment-list { display: flex; flex-direction: column; gap: 8px; }',
    '.dsn-comment { display: flex; gap: 7px; align-items: flex-start; }',
    '.dsn-comment-main { flex: 1 1 auto; min-width: 0; }',
    '.dsn-comment-head { display: flex; align-items: center; gap: 5px; }',
    '.dsn-comment-name { font-size: 11.5px; font-weight: 600; color: var(--dsw-alias-label-primary, #0f1115); }',
    '.dsn-comment-dot { font-size: 10.5px; color: var(--dsw-alias-label-tertiary, #adb2b8); }',
    '.dsn-comment-age { font-size: 10.5px; color: var(--dsw-alias-label-tertiary, #adb2b8); }',
    '.dsn-comment-remove { margin-left: auto; width: 16px; height: 16px; border: 0; background: transparent;',
    '  color: var(--dsw-alias-label-tertiary, #adb2b8); opacity: 0; cursor: pointer; border-radius: 4px; padding: 0;',
    '  display: inline-flex; align-items: center; justify-content: center; }',
    '.dsn-comment:hover .dsn-comment-remove { opacity: 1; }',
    '.dsn-comment-body { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-primary, #0f1115); word-break: break-word; }',
    '.dsn-comment-body .dsn-content { font-size: 12px; line-height: 1.6; }',
    '.dsn-comment-form { display: flex; flex-direction: column; gap: 4px; padding-top: 2px; }',
    '.dsn-comment-input { width: 100%; box-sizing: border-box; resize: vertical; min-height: 44px; max-height: 140px;',
    '  border: 1px solid var(--dsw-alias-border-l2, rgba(11,12,15,0.12)); border-radius: 8px; padding: 6px 8px;',
    '  font-size: 12px; line-height: 1.55; color: var(--dsw-alias-label-primary, #0f1115);',
    '  background: var(--dsw-alias-bg-layer-1, #fff); outline: none; font-family: inherit; }',
    '.dsn-comment-input:focus { border-color: var(--dsw-alias-border-l4, rgba(15,17,21,0.3)); }',
    '.dsn-comment-input::placeholder { color: var(--dsw-alias-label-tertiary, #adb2b8); }',
    '.dsn-comment-formbar { display: flex; align-items: center; gap: 6px; }',
    '.dsn-comment-hint { flex: 1 1 auto; font-size: 10px; color: var(--dsw-alias-label-tertiary, #adb2b8); }',
    /* compact thread (detached windows) */
    '.dsn-comments--compact { gap: 4px; padding-top: 8px; margin-top: 8px; }',
    '.dsn-comments--compact .dsn-comments-title { font-size: 10.5px; }',
    '.dsn-comments--compact .dsn-comments-count { font-size: 10px; }',
    '.dsn-comments--compact .dsn-comment { gap: 6px; }',
    '.dsn-comments--compact .dsn-comment-name { font-size: 11px; }',
    '.dsn-comments--compact .dsn-comment-age { font-size: 10px; }',
    '.dsn-comments--compact .dsn-comment-body,',
    '.dsn-comments--compact .dsn-comment-body .dsn-content { font-size: 11.5px; line-height: 1.5; }',
    '.dsn-comments--compact .dsn-comment-input { min-height: 32px; padding: 5px 7px; font-size: 11.5px; }',
    '.dsn-comments--compact .dsn-comment-formbar { gap: 4px; }',
    '.dsn-comments--compact .dsn-comment-hint { font-size: 9.5px; }',
    '.dsn-comments--compact .dsn-btn-tiny { height: 22px; padding: 0 8px; font-size: 11px; }',
    /* detail sheet */
    '.dsn-sheet { position: absolute; inset: 0; z-index: 6; display: flex; align-items: flex-start; justify-content: center;',
    '  padding: 8px; background: var(--dsw-alias-bg-mask-1, rgba(15,17,21,0.3)); }',
    '.dsn-sheet-card { flex: 0 1 auto; display: flex; flex-direction: column; min-height: 0; max-height: 100%;',
    '  border-radius: 12px; border: 1px solid var(--dsw-alias-border-l2, rgba(11,12,15,0.1));',
    '  background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: var(--dsw-elevation-panel, 0 12px 32px rgba(0,0,0,0.18));',
    '  overflow: hidden; outline: none; }',
    '.dsn-sheet-card:focus, .dsn-sheet-card:focus-visible { outline: none; }',
    '.dsn-sheet-head { display: flex; align-items: center; gap: 8px; padding: 9px 10px 7px; }',
    '.dsn-sheet-title { flex: 1 1 auto; min-width: 0; font-size: 13px; font-weight: 600;',
    '  color: var(--dsw-alias-label-primary, #0f1115); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.dsn-sheet-close { flex: 0 0 auto; width: 22px; height: 22px; border: 0; background: transparent; padding: 0;',
    '  border-radius: 6px; color: var(--dsw-alias-label-secondary, #6b7280); cursor: pointer;',
    '  display: inline-flex; align-items: center; justify-content: center; }',
    '.dsn-sheet-close:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(15,17,21,0.06)); }',
    '.dsn-sheet-meta { display: flex; align-items: center; gap: 6px; padding: 0 10px 8px; flex-wrap: wrap; }',
    '.dsn-sheet-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 0 10px 12px; }',
    '.dsn-sheet-content { font-size: 12.5px; }',
    /* aggregated to-do view */
    '.dsn-tasksview { display: flex; flex-direction: column; gap: 10px; padding: 2px 0 6px; }',
    '.dsn-tasks-summary { display: flex; align-items: center; gap: 5px; padding: 0 2px;',
    '  font-size: 11px; color: var(--dsw-alias-label-tertiary, #adb2b8); }',
    '.dsn-tasksgroup { display: flex; flex-direction: column; gap: 1px; }',
    '.dsn-tasksgroup-title { display: flex; align-items: center; gap: 6px; width: 100%; box-sizing: border-box;',
    '  border: 0; background: transparent; padding: 3px 2px; border-radius: 6px; cursor: pointer; text-align: left; }',
    '.dsn-tasksgroup-title:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(15,17,21,0.04)); }',
    '.dsn-tasksgroup-label { flex: 1 1 auto; min-width: 0; font-size: 11.5px; font-weight: 600;',
    '  color: var(--dsw-alias-label-secondary, #6b7280); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.dsn-tasksgroup-count { flex: 0 0 auto; font-size: 10.5px; color: var(--dsw-alias-label-tertiary, #adb2b8); }',
    /* card meta chips */
    '.dsn-note-meta { display: flex; align-items: center; gap: 5px; padding: 2px 0 0; flex-wrap: wrap; }',
    '.dsn-chip--btn { border: 0; cursor: pointer; background: color-mix(in srgb, var(--dsw-alias-label-primary, #0f1115) 6%, transparent);',
    '  color: var(--dsw-alias-label-secondary, #6b7280); font: inherit; }',
    '.dsn-chip--btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(15,17,21,0.08)); color: var(--dsw-alias-label-primary, #0f1115); }',
    '.dsn-chip--warn { color: var(--dsw-alias-state-business-primary, #4176e6);',
    '  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 12%, transparent); }',
    '.dsn-chip--warn:hover { background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 20%, transparent); color: var(--dsw-alias-state-business-primary, #4176e6); }',
    /* filters row */
    '.dsn-filters { display: flex; align-items: center; gap: 2px; padding: 0 12px 8px; flex-wrap: wrap; }',
    '.dsn-filter-group { display: inline-flex; align-items: center; gap: 1px; height: 22px;',
    '  padding: 0; border-radius: 999px; background: transparent; }',
    '.dsn-filter-label { padding-left: 6px; font-size: 10.5px; color: var(--dsw-alias-label-tertiary, #adb2b8); }',
    '.dsn-filter-toggle { height: 22px; padding: 0 9px; margin-left: 4px; border-radius: 999px; border: 0; cursor: pointer;',
    '  background: color-mix(in srgb, var(--dsw-alias-label-primary, #0f1115) 5%, transparent);',
    '  color: var(--dsw-alias-label-secondary, #6b7280); font: inherit; font-size: 11px;',
    '  transition: background-color 0.14s ease, color 0.14s ease; }',
    '.dsn-filter-toggle.is-on { background: var(--dsw-alias-label-primary, #0f1115); color: var(--dsw-alias-label-primary-inverted, #fff); }',
    '.dsn-filter-toggle:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(15,17,21,0.08)); }',
    '.dsn-filter-toggle:focus-visible { outline: 2px solid var(--dsw-alias-interactive-bg-hover-accent, #b9c6f5); outline-offset: -1px; }',
  ].join('\n'))
})()

/* ================= 60-capture.js ================= */
/* ------------------------------------------------------------------ *
 * Selection capture: the floating chip, the Alt+Shift chords, the
 * context-menu surface button, and the composer bridge the panel uses to
 * insert a note into the active input.
 * ------------------------------------------------------------------ */

;(function () {
  'use strict'

  var CHIP_GAP = 8
  var CHIP_MARGIN = 8
  var CHIP_LAYER_SELECTOR = '.dsn-chip-layer'

  /* ------------------------------- styles --------------------------- */

  var CAPTURE_CSS = [
    '.dsn-chip-layer { position: fixed; inset: 0; overflow: visible; z-index: 2147483003; pointer-events: none; }',
    '.dsn-capture-chip { position: absolute; top: 0; left: 0; display: inline-flex; align-items: center; gap: 6px; box-sizing: border-box; height: 30px; padding: 0 10px; margin: 0; border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1)); border-radius: 8px; background: var(--dsw-alias-button-floating-fill, var(--dsw-alias-bg-overlay, #ffffff)); color: var(--dsw-alias-label-primary, #1b1b1f); box-shadow: 0 1px 2px var(--dsw-alias-bg-mask-2, rgba(0, 0, 0, 0.12)), 0 10px 24px -10px var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.24)); font-family: inherit; font-size: 12px; font-weight: 500; line-height: 1; letter-spacing: 0.01em; white-space: nowrap; cursor: pointer; pointer-events: auto; -webkit-user-select: none; user-select: none; touch-action: manipulation; animation: dsn-pop-in 160ms cubic-bezier(0.2, 0.8, 0.3, 1) both; transition: background-color 120ms ease, border-color 120ms ease; }',
    '.dsn-capture-chip:hover { background: var(--dsw-alias-button-floating-hover, var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06))); }',
    '.dsn-capture-chip:active { transform: translateY(1px); }',
    '.dsn-capture-chip:focus-visible { outline: 2px solid var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.16)); outline-offset: 2px; }',
    '.dsn-capture-chip__icon, .dsn-capture-action__icon { flex: none; opacity: 0.9; }',
    '.dsn-capture-chip__label, .dsn-capture-action__label { display: inline-block; }',
    '.dsn-capture-action { display: inline-flex; align-items: center; gap: 6px; box-sizing: border-box; height: 28px; padding: 0 10px; margin: 0; border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1)); border-radius: 8px; background: var(--dsw-alias-button-floating-fill, var(--dsw-alias-bg-overlay, #ffffff)); color: var(--dsw-alias-label-primary, #1b1b1f); font-family: inherit; font-size: 12px; font-weight: 500; line-height: 1; white-space: nowrap; cursor: pointer; -webkit-user-select: none; user-select: none; }',
    '.dsn-capture-action:hover { background: var(--dsw-alias-button-floating-hover, var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06))); }',
    '.dsn-capture-action:focus-visible { outline: 2px solid var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.16)); outline-offset: 2px; }',
    // The host renders this popover inside its own selection surface, so it only
    // has to look like a compact floating group — placement is the host's job.
    // Both actions are the same button the host renders for 引用文本: one
    // floating pill (button-floating-fill / label-primary) split into two
    // segments, so 存便签 can never read as "white in a dark menu".
    '.dsn-surface { display: inline-flex; align-items: center; gap: 0; box-sizing: border-box; padding: 2px; margin: 0; border: none; border-radius: 999px; background: var(--dsw-alias-button-floating-fill, var(--dsw-alias-bg-overlay, #ffffff)); color: var(--dsw-alias-label-primary, #1b1b1f); box-shadow: var(--dsw-elevation-panel, 0 1px 2px rgba(0, 0, 0, 0.12), 0 10px 24px -10px rgba(0, 0, 0, 0.24)); font-family: inherit; }',
    '.dsn-surface-btn { display: inline-flex; align-items: center; gap: 5px; box-sizing: border-box; height: 26px; padding: 0 10px; margin: 0; border: none; border-radius: 999px; background: transparent; color: inherit; font-family: inherit; font-size: 13px; font-weight: 500; line-height: 1; letter-spacing: 0.01em; white-space: nowrap; cursor: pointer; -webkit-user-select: none; user-select: none; touch-action: manipulation; transition: background-color 120ms ease; }',
    '.dsn-surface-btn:hover { background: var(--dsw-alias-button-floating-hover, rgba(38, 49, 72, 0.08)); }',
    '.dsn-surface-btn:active { opacity: 0.82; }',
    '.dsn-surface-btn:focus-visible { outline: 2px solid var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.16)); outline-offset: 1px; }',
    '.dsn-surface-btn + .dsn-surface-btn { position: relative; }',
    '.dsn-surface-btn + .dsn-surface-btn::before { content: ""; position: absolute; left: 0; top: 50%; width: 1px; height: 14px; margin-top: -7px; background: var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1)); }',
    '.dsn-surface-btn__icon { flex: none; opacity: 0.8; }',
    '.dsn-surface-btn__label { display: inline-block; }',
  ].join('\n')

  try {
    if (typeof DSN.addCss === 'function') {
      DSN.addCss('capture', CAPTURE_CSS)
    } else if (typeof DSN.injectStyle === 'function' && typeof document !== 'undefined' && document.head) {
      DSN.injectStyle(document, CAPTURE_CSS)
    }
  } catch (error) {
    DSN.log('capture styles failed', error)
  }

  /* ------------------------------ helpers --------------------------- */

  function asText(value) {
    return value == null ? '' : String(value)
  }

  function isElement(node) {
    return !!(node && node.nodeType === 1)
  }

  function translateOf(value) {
    return typeof value === 'function' ? value : DSN.fallbackT
  }

  function textFromHtml(html) {
    if (!html || typeof DSN.htmlToText !== 'function') return ''
    try {
      return asText(DSN.htmlToText(html))
    } catch (error) {
      DSN.log('htmlToText failed', error)
      return ''
    }
  }

  function isExcludedNode(element) {
    if (!isElement(element)) return true
    if (typeof DSN.isEditable === 'function' && DSN.isEditable(element)) return true
    if (typeof DSN.closest !== 'function') return false
    if (DSN.closest(element, '.dsn-root')) return true
    if (DSN.closest(element, '.dsn-pip')) return true
    if (DSN.closest(element, CHIP_LAYER_SELECTOR)) return true
    return false
  }

  function richHtmlFromRange(range) {
    try {
      var holder = document.createElement('div')
      holder.appendChild(range.cloneContents())
      var raw = holder.innerHTML
      if (!raw) return ''
      if (typeof DSN.sanitizeHtml !== 'function') return raw
      try {
        var clean = DSN.sanitizeHtml(raw)
        return clean == null ? '' : asText(clean)
      } catch (error) {
        DSN.log('selection sanitize failed', error)
        return ''
      }
    } catch (error) {
      DSN.log('selection clone failed', error)
      return ''
    }
  }

  function collapseSelection() {
    try {
      var selection = window.getSelection()
      if (selection && typeof selection.removeAllRanges === 'function' && selection.rangeCount > 0) {
        selection.removeAllRanges()
      }
    } catch (error) {
      DSN.log('selection collapse failed', error)
    }
  }

  /**
   * Read the live document selection. Returns `{ text, html, rect }` only when
   * the selection lives in the main document, is non-collapsed, carries some
   * content, and does not sit inside our own surfaces or an editable field.
   */
  /**
   * Transcript coordinate of the element a selection started in. The chat flow
   * stamps every node with `data-chat-turn` / `data-chat-node-key` /
   * `data-chat-anchor-key`; those are the only stable handles DSH exposes, and
   * they are what a later "回到原文" needs.
   */
  function seatOf(element) {
    if (!element || typeof element.closest !== 'function') return null
    var node = null
    try {
      node = element.closest('[data-chat-node-key]')
    } catch (error) {
      DSN.log('seat lookup failed', error)
      return null
    }
    if (!node) {
      try {
        node = element.closest('[data-chat-turn]')
      } catch (error) {
        DSN.log('turn lookup failed', error)
        return null
      }
    }
    if (!node) return null
    function read(name) {
      var value = ''
      try {
        value = node.getAttribute(name) || ''
      } catch (error) {
        value = ''
      }
      return value || null
    }
    var turn = Number(read('data-chat-turn'))
    var seat = {
      nodeKey: read('data-chat-node-key'),
      anchorKey: read('data-chat-anchor-key'),
      turn: isFinite(turn) && turn >= 0 ? turn : null,
    }
    if (!seat.nodeKey && !seat.anchorKey && seat.turn === null) return null
    return seat
  }

  function readDocumentSelection() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null
    var selection = null
    try {
      selection = window.getSelection()
    } catch (error) {
      DSN.log('selection read failed', error)
      return null
    }
    if (!selection || selection.rangeCount < 1 || selection.isCollapsed) return null
    var range = null
    try {
      range = selection.getRangeAt(0)
    } catch (error) {
      DSN.log('selection range failed', error)
      return null
    }
    if (!range || range.collapsed) return null
    var anchorNode = selection.anchorNode || range.startContainer
    if (!anchorNode) return null
    var anchorDocument = anchorNode.ownerDocument || (anchorNode.nodeType === 9 ? anchorNode : null)
    if (anchorDocument && anchorDocument !== document) return null
    var anchorElement = isElement(anchorNode) ? anchorNode : anchorNode.parentElement
    if (!anchorElement || isExcludedNode(anchorElement)) return null
    var text = ''
    try {
      text = asText(selection.toString()).trim()
    } catch (error) {
      DSN.log('selection text failed', error)
    }
    var html = richHtmlFromRange(range)
    if (!text && !html) return null
    var rect = null
    try {
      var box = range.getBoundingClientRect()
      if (box && (box.width > 0 || box.height > 0)) {
        rect = {
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          right: box.right,
          bottom: box.bottom,
        }
      }
    } catch (error) {
      DSN.log('selection rect failed', error)
    }
    return { text: text, html: html, rect: rect, seat: seatOf(anchorElement) }
  }

  /* ---------------------------- chip store -------------------------- */

  var chipHidden = { visible: false, rect: null }
  var chipState = chipHidden
  var chipListeners = new Set()
  var chipMount = null

  /**
   * How many of our in-surface menus are mounted right now. The chat flow owns
   * text selections: it renders `conversation.chat.text-interaction`, and our
   * component there already offers both actions — so while one is on screen the
   * floating chip stays hidden, and it comes back the moment the surface goes
   * away (other panes, tool output, anything the flow does not own).
   */
  var surfaceMounts = 0

  function surfaceActive() {
    return surfaceMounts > 0
  }

  /** The single capture environment shared by the chip and the menu surface. */
  var captureEnv = { store: null, t: null, getSession: null, activate: null }

  function chipSnapshot() {
    return chipState
  }

  function sameRect(a, b) {
    if (!a || !b) return a === b
    return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height
  }

  function setChipState(next) {
    if (next.visible === chipState.visible && sameRect(next.rect, chipState.rect)) return
    chipState = next
    chipListeners.forEach(function (listener) {
      try {
        listener()
      } catch (error) {
        DSN.log('chip listener failed', error)
      }
    })
  }

  function subscribeChip(listener) {
    if (typeof listener !== 'function') return function () {}
    chipListeners.add(listener)
    return function () {
      chipListeners.delete(listener)
    }
  }

  function normalizeRect(rect) {
    if (!rect) return null
    var left = Number(rect.left)
    var top = Number(rect.top)
    var width = Number(rect.width)
    var height = Number(rect.height)
    if (!isFinite(left) || !isFinite(top) || !isFinite(width) || !isFinite(height)) return null
    if (width <= 0 && height <= 0) return null
    return {
      left: left,
      top: top,
      width: width,
      height: height,
      right: isFinite(Number(rect.right)) ? Number(rect.right) : left + width,
      bottom: isFinite(Number(rect.bottom)) ? Number(rect.bottom) : top + height,
    }
  }

  var chipLayer = null

  function ensureChipContainer() {
    if (chipLayer && chipLayer.parentNode) return chipLayer
    if (typeof document === 'undefined' || !document.body) return null
    try {
      var existing = document.querySelector(CHIP_LAYER_SELECTOR)
      if (existing) {
        chipLayer = existing
        return existing
      }
      var container = document.createElement('div')
      container.className = 'dsn-chip-layer'
      container.setAttribute('data-dsn-chip-layer', '1')
      document.body.appendChild(container)
      chipLayer = container
      return container
    } catch (error) {
      DSN.log('chip layer mount failed', error)
      return null
    }
  }

  function ensureChipMounted() {
    if (chipMount) return chipMount
    var container = ensureChipContainer()
    if (!container) return null
    var ReactDOM = DSN.ReactDOM
    if (!ReactDOM || typeof ReactDOM.createRoot !== 'function') return null
    var root = ReactDOM.createRoot(container)
    root.render(DSN.h(ChipButton, { env: captureEnv }))
    chipMount = { root: root, container: container }
    return chipMount
  }

  function unmountChip() {
    var mount = chipMount
    chipMount = null
    if (mount) {
      try {
        mount.root.unmount()
      } catch (error) {
        DSN.log('chip unmount failed', error)
      }
    }
    var container = (mount && mount.container) || chipLayer
    chipLayer = null
    if (!container) return
    try {
      if (container.parentNode) container.parentNode.removeChild(container)
    } catch (error) {
      DSN.log('chip layer removal failed', error)
    }
  }

  function showChip(rect) {
    var box = normalizeRect(rect)
    if (!box) {
      hideChip()
      return
    }
    setChipState({ visible: true, rect: box })
    ensureChipMounted()
  }

  function hideChip() {
    setChipState(chipHidden)
  }

  function positionChip(node, snapshot) {
    if (!node || !snapshot || !snapshot.visible || !snapshot.rect) return
    try {
      var rect = snapshot.rect
      var width = node.offsetWidth || 0
      var height = node.offsetHeight || 0
      var viewportWidth = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 0
      var viewportHeight = window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 0
      // Sit at the selection's bottom-right corner rather than centred above it:
      // the host popover takes the centred-above slot, so this never covers it.
      var left = rect.left + rect.width - width
      var top = rect.bottom + CHIP_GAP
      if (top + height > viewportHeight - CHIP_MARGIN) top = rect.top - height - CHIP_GAP
      var maxLeft = Math.max(CHIP_MARGIN, viewportWidth - width - CHIP_MARGIN)
      var maxTop = Math.max(CHIP_MARGIN, viewportHeight - height - CHIP_MARGIN)
      left = Math.min(Math.max(left, CHIP_MARGIN), maxLeft)
      top = Math.min(Math.max(top, CHIP_MARGIN), maxTop)
      node.style.left = Math.round(left) + 'px'
      node.style.top = Math.round(top) + 'px'
    } catch (error) {
      DSN.log('chip position failed', error)
    }
  }

  /* ---------------------------- chip button ------------------------- */

  function useChipState() {
    var React = DSN.React
    if (React && typeof React.useSyncExternalStore === 'function') {
      return React.useSyncExternalStore(subscribeChip, chipSnapshot)
    }
    var pair = React.useState(chipSnapshot())
    React.useEffect(function () {
      return subscribeChip(function () {
        pair[1](chipSnapshot())
      })
    }, [])
    return pair[0]
  }

  function ChipButton(props) {
    var React = DSN.React
    var env = (props && props.env) || captureEnv
    var snapshot = useChipState()
    var buttonRef = React.useRef(null)
    var pointedRef = React.useRef(false)
    var visible = snapshot.visible === true && !!snapshot.rect
    React.useLayoutEffect(function () {
      positionChip(buttonRef.current, snapshot)
    }, [snapshot])
    var t = translateOf(env.t)

    function activate() {
      try {
        if (typeof env.activate === 'function') env.activate()
      } catch (error) {
        DSN.log('chip activate failed', error)
      }
    }

    return DSN.h('button', {
      ref: buttonRef,
      type: 'button',
      className: 'dsn-chip dsn-capture-chip',
      style: visible ? null : { display: 'none' },
      title: t('capture.chipTitle'),
      'aria-label': t('capture.chipTitle'),
      onPointerDown: function (event) {
        try {
          event.preventDefault()
        } catch (error) {
          DSN.log('chip pointerdown failed', error)
        }
        pointedRef.current = true
        activate()
      },
      onClick: function () {
        if (pointedRef.current) {
          pointedRef.current = false
          return
        }
        activate()
      },
      onKeyDown: function (event) {
        var key = event && event.key
        if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar') return
        try {
          event.preventDefault()
        } catch (error) {
          DSN.log('chip keydown failed', error)
        }
        pointedRef.current = false
        activate()
      },
    },
      DSN.Icon({ name: 'note', size: 14, className: 'dsn-capture-chip__icon' }),
      DSN.h('span', { className: 'dsn-capture-chip__label' }, t('capture.chip')),
    )
  }

  /* ------------------------------ capture --------------------------- */

  function captureSelection(info, options) {
    var opts = options || {}
    var translate = translateOf(opts.t)
    try {
      var store = opts.store || captureEnv.store
      if (!store || !store.actions || typeof store.actions.addNote !== 'function') {
        DSN.log('capture skipped: store unavailable')
        return false
      }
      var text = asText(opts.text != null ? opts.text : info && info.text)
      var html = asText(opts.html != null ? opts.html : info && info.html)
      if (!text && !html) return false
      // The context-menu fallback only has plain text; give the note an html
      // body so the board renders it instead of an empty card.
      if (!html && text && typeof DSN.textToHtml === 'function') {
        try {
          html = asText(DSN.textToHtml(text))
        } catch (error) {
          DSN.log('textToHtml failed', error)
        }
      }
      var getSession = typeof opts.getSession === 'function' ? opts.getSession : captureEnv.getSession
      var source = null
      if (typeof getSession === 'function') {
        try {
          source = getSession()
        } catch (error) {
          DSN.log('getSession failed', error)
        }
      }
      var seat = info && info.seat ? info.seat : null
      var origin = null
      if (typeof DSN.normalizeOrigin === 'function') {
        origin = DSN.normalizeOrigin({
          sessionId: source && source.sessionId,
          sessionTitle: source && source.sessionTitle,
          turn: seat ? seat.turn : null,
          nodeKey: seat ? seat.nodeKey : null,
          anchorKey: seat ? seat.anchorKey : null,
        })
      }
      var noteId = store.actions.addNote({ html: html, text: text, source: source || null, origin: origin })
      if (!noteId) return false
      DSN.toast(translate('note.saved'))
      return true
    } catch (error) {
      DSN.log('capture failed', error)
      return false
    }
  }

  function activateChip() {
    var info = readDocumentSelection()
    if (!info) {
      hideChip()
      return
    }
    var ok = captureSelection(info, {
      store: captureEnv.store,
      t: captureEnv.t,
      getSession: captureEnv.getSession,
    })
    if (!ok) {
      hideChip()
      return
    }
    collapseSelection()
    hideChip()
  }

  /* ------------- host text-interaction surface (quote + save) -------- */

  /**
   * Rendered inside `conversation.chat.text-interaction` — the popover the chat
   * flow positions next to the current selection. It carries the built-in quote
   * action (this definition owns the gesture now, so 引用文本 moves here) right
   * next to the note-capture action.
   */
  DSN.CaptureAction = function CaptureAction(props) {
    var p = props || {}
    var t = translateOf(p.t)
    // The quote action is gated by the same session conditions as the built-in
    // one: never inside a removed session or an unreachable subagent thread.
    var quoteSession = true
    if (typeof p.useSession === 'function') {
      quoteSession = p.useSession(function (session) {
        if (!session || session.removed) return false
        if (!session.subagent) return true
        return session.subagent.address.mode === 'continuable' && session.subagent.parentAvailable === true
      })
    }
    var actions = p.inputActions || null
    var canQuote = quoteSession !== false && !!actions && typeof actions.insertQuote === 'function'

    // Publishing the mount count is what silences the free-floating chip: while
    // this menu is on screen our actions are already where the user is looking.
    var React = DSN.React
    if (React && typeof React.useEffect === 'function') {
      React.useEffect(function () {
        surfaceMounts += 1
        if (surfaceMounts === 1) hideChip()
        return function () {
          surfaceMounts = Math.max(0, surfaceMounts - 1)
        }
      }, [])
    }

    function stop(event) {
      try {
        if (event && typeof event.preventDefault === 'function') event.preventDefault()
        if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
      } catch (error) {
        DSN.log('surface event guard failed', error)
      }
    }

    function settle() {
      try {
        if (typeof p.clearSelection === 'function') p.clearSelection()
      } catch (error) {
        DSN.log('clearSelection failed', error)
      }
      try {
        if (typeof p.dismiss === 'function') p.dismiss()
      } catch (error) {
        DSN.log('dismiss failed', error)
      }
    }

    function selectionText() {
      var text = ''
      try {
        if (typeof p.readText === 'function') text = asText(p.readText()).trim()
      } catch (error) {
        DSN.log('readText failed', error)
      }
      if (text) return text
      var info = readDocumentSelection()
      return info ? info.text : ''
    }

    function quote(event) {
      try {
        stop(event)
        if (!canQuote) return
        var text = selectionText()
        if (!text) return
        var ok = false
        try {
          ok = actions.insertQuote(text)
        } catch (error) {
          DSN.log('insertQuote failed', error)
        }
        if (!ok) return
        settle()
      } catch (error) {
        DSN.log('quote action failed', error)
      }
    }

    function save(event) {
      try {
        stop(event)
        var info = readDocumentSelection()
        if (!info) {
          var text = selectionText()
          info = text ? { text: text, html: '', rect: null } : null
        }
        if (!info) return
        var store = p.store || captureEnv.store
        var getSession = typeof p.getSession === 'function' ? p.getSession : captureEnv.getSession
        var ok = captureSelection(info, { store: store, t: t, getSession: getSession })
        if (!ok) return
        settle()
      } catch (error) {
        DSN.log('capture action failed', error)
      }
    }

    function actionButton(name, labelKey, handler) {
      return DSN.h('button', {
        type: 'button',
        key: name,
        className: 'dsn-surface-btn',
        title: t(labelKey),
        'aria-label': t(labelKey),
        'data-dsn-action': name,
        onPointerDown: function (event) {
          try {
            event.preventDefault()
          } catch (error) {
            DSN.log('surface pointerdown failed', error)
          }
        },
        onClick: handler,
        onKeyDown: function (event) {
          var key = event && event.key
          if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar') return
          handler(event)
        },
      },
        DSN.Icon({ name: name === 'quote' ? 'quote' : 'note', size: 14, className: 'dsn-surface-btn__icon' }),
        DSN.h('span', { className: 'dsn-surface-btn__label' }, t(labelKey)),
      )
    }

    var buttons = []
    if (canQuote) buttons.push(actionButton('quote', 'capture.quote', quote))
    buttons.push(actionButton('note', 'capture.chip', save))
    return DSN.h('div', { className: 'dsn-surface', role: 'group', 'aria-label': t('capture.chipTitle') }, buttons)
  }

  /* -------------------------- capture installer --------------------- */

  DSN.installCapture = function (options) {
    var opts = options || {}
    var ctx = opts.ctx || null
    var store = opts.store || null
    var translate = translateOf(opts.t)
    var getSession = typeof opts.getSession === 'function' ? opts.getSession : function () { return null }
    var disposers = []
    var disposed = false

    // The chip is a "selection is finished" affordance. `selectionchange` keeps
    // firing while the pointer is still down (or Shift+Arrow is held), so a flag
    // tracks the in-flight gesture and keeps the chip out of the way until the
    // user lets go.
    var gestureActive = false

    function track(disposer) {
      if (typeof disposer === 'function') disposers.push(disposer)
      return disposer
    }

    captureEnv.store = store
    captureEnv.t = translate
    captureEnv.getSession = getSession
    captureEnv.activate = activateChip
    // The layer exists as soon as capture is armed; the React root inside it is
    // still mounted lazily, on the first selection.
    ensureChipContainer()

    function evaluateNow() {
      if (disposed) return
      try {
        var info = readDocumentSelection()
        // The chat flow opens its own selection surface and that surface carries
        // our actions, so a floating chip there would only cover it. Anywhere
        // else the chip is the way in.
        if (!info || !info.rect || surfaceActive()) {
          hideChip()
          return
        }
        showChip(info.rect)
      } catch (error) {
        DSN.log('selection evaluate failed', error)
      }
    }

    var evaluateSoon = DSN.debounce(evaluateNow, 120)

    // A finished gesture (pointer release / key release) is the only moment the
    // chip may appear; the debounce then lets the chat flow's own surface win the
    // race, because a mounted surface silences the chip.
    function settleGesture() {
      if (disposed) return
      gestureActive = false
      evaluateSoon()
    }

    function onPointerDown(event) {
      try {
        var target = event && event.target
        if (target && typeof target.closest === 'function' && target.closest(CHIP_LAYER_SELECTOR)) return
        gestureActive = true
        hideChip()
      } catch (error) {
        DSN.log('pointerdown hide failed', error)
      }
    }

    function onKeyDown(event) {
      if (disposed) return
      try {
        if (!event || event.repeat || event.isComposing) return
        var key = asText(event.key)
        if (key === 'Escape') {
          hideChip()
          return
        }
        // Keyboard selection (Shift+Arrow/Home/End/PageDown) is a gesture too:
        // keep the chip away until the key is released.
        if (event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
          gestureActive = true
          hideChip()
          return
        }
        if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return
        var code = asText(event.code)
        var toggleChord = code === 'KeyN' || key.toLowerCase() === 'n'
        var captureChord = code === 'KeyS' || key.toLowerCase() === 's'
        if (toggleChord) {
          if (store && store.actions && typeof store.actions.toggleOpen === 'function') {
            try {
              event.preventDefault()
            } catch (error) {
              DSN.log('toggle preventDefault failed', error)
            }
            store.actions.toggleOpen()
          }
          return
        }
        if (!captureChord) return
        var target = event.target
        if (target && typeof DSN.isEditable === 'function' && DSN.isEditable(target)) return
        var info = readDocumentSelection()
        if (!info) return
        var ok = captureSelection(info, { store: store, t: translate, getSession: getSession })
        if (!ok) return
        try {
          event.preventDefault()
          event.stopPropagation()
        } catch (error) {
          DSN.log('capture preventDefault failed', error)
        }
        collapseSelection()
        hideChip()
      } catch (error) {
        DSN.log('capture shortcut failed', error)
      }
    }

    if (typeof document !== 'undefined') {
      track(DSN.on(document, 'selectionchange', function () {
        // Mid-gesture the selection is still growing: show nothing, and drop any
        // chip left over from the previous selection.
        if (gestureActive) {
          hideChip()
          return
        }
        evaluateSoon()
      }))
      // Any of these ends the gesture; pointer release is the common one, the
      // others cover mouse-only browsers, dragging, and touch.
      track(DSN.on(document, 'pointerup', settleGesture))
      track(DSN.on(document, 'mouseup', settleGesture))
      track(DSN.on(document, 'touchend', settleGesture))
      track(DSN.on(document, 'pointercancel', settleGesture))
      track(DSN.on(document, 'dragend', function () { gestureActive = false; hideChip() }))
      track(DSN.on(document, 'selectstart', function () { gestureActive = true }))
      track(DSN.on(document, 'scroll', function () { hideChip() }, true))
      track(DSN.on(document, 'pointerdown', onPointerDown, true))
      track(DSN.on(document, 'mousedown', onPointerDown, true))
      track(DSN.on(document, 'keydown', onKeyDown))
      track(DSN.on(document, 'keyup', settleGesture))
    }
    if (typeof window !== 'undefined') {
      track(DSN.on(window, 'pointerup', settleGesture))
      track(DSN.on(window, 'resize', function () { hideChip() }))
      track(DSN.on(window, 'blur', function () { gestureActive = false; hideChip() }))
    }

    /* Our surface carries the built-in quote action next to the note action, so
     * it claims the 'selection' trigger as well as 'contextmenu'. Nothing of the
     * host feature is lost: 引用文本 is one of the two buttons we render. */
    var conversation = null
    try {
      if (ctx && ctx.uiConversation) conversation = ctx.uiConversation
    } catch (error) {
      DSN.log('uiConversation lookup failed', error)
    }
    if (!conversation && ctx && typeof ctx.get === 'function') {
      try {
        conversation = ctx.get('uiConversation')
      } catch (error) {
        DSN.log('uiConversation service lookup failed', error)
      }
    }
    if (conversation && conversation.interactions && typeof conversation.interactions.register === 'function') {
      try {
        track(conversation.interactions.register({
          id: 'dsh-sticky-board',
          onInteraction: function (request) {
            try {
              if (!request) return
              if (request.hasSelection === false) return
              var text = ''
              try {
                text = typeof request.readText === 'function' ? asText(request.readText()).trim() : ''
              } catch (error) {
                DSN.log('interaction readText failed', error)
              }
              if (!text) return
              request.open()
            } catch (error) {
              DSN.log('capture interaction failed', error)
            }
          },
        }))
      } catch (error) {
        DSN.log('capture interaction registration failed', error)
      }
    }

    return function dispose() {
      if (disposed) return
      disposed = true
      try {
        hideChip()
      } catch (error) {
        DSN.log('chip hide on dispose failed', error)
      }
      unmountChip()
      while (disposers.length > 0) {
        var disposer = disposers.pop()
        try {
          disposer()
        } catch (error) {
          DSN.log('capture disposer failed', error)
        }
      }
      if (captureEnv.store === store) {
        captureEnv.store = null
        captureEnv.t = null
        captureEnv.getSession = null
        if (captureEnv.activate === activateChip) captureEnv.activate = null
      }
    }
  }

  /* --------------------------- composer bridge ---------------------- */

  var bridgeBus = { handles: [], listeners: new Set() }

  function activeBridge() {
    var list = bridgeBus.handles
    return list.length > 0 ? list[list.length - 1] : null
  }

  function notifyBridge() {
    var snapshot = activeBridge()
    bridgeBus.listeners.forEach(function (listener) {
      try {
        listener(snapshot)
      } catch (error) {
        DSN.log('bridge listener failed', error)
      }
    })
  }

  function publishBridge(handle) {
    if (!handle) return
    var list = bridgeBus.handles
    var index = list.indexOf(handle)
    if (index >= 0) list.splice(index, 1)
    list.push(handle)
    notifyBridge()
  }

  function releaseBridge(handle) {
    var list = bridgeBus.handles
    var index = list.indexOf(handle)
    if (index < 0) return
    list.splice(index, 1)
    notifyBridge()
  }

  function insertIntoComposer(actions, html, text) {
    if (!actions || typeof actions.insertText !== 'function') return false
    var payload = asText(text)
    if (!payload) payload = textFromHtml(html)
    if (!payload) return false
    try {
      var span = null
      if (typeof actions.captureInsertion === 'function') span = actions.captureInsertion()
      if (span == null) return false
      return actions.insertText(payload, span) === true
    } catch (error) {
      DSN.log('composer insert failed', error)
      return false
    }
  }

  function copyFallback(html, text, translate) {
    var copy = null
    try {
      copy = typeof DSN.copyRich === 'function' ? DSN.copyRich(html, text) : false
    } catch (error) {
      DSN.log('copy fallback failed', error)
      copy = false
    }
    var promise = copy && typeof copy.then === 'function' ? copy : Promise.resolve(copy)
    return promise.then(function (ok) {
      try {
        DSN.toast(translate(ok ? 'status.noSession' : 'status.copyFailed'), ok ? 'info' : 'error')
      } catch (error) {
        DSN.log('toast failed', error)
      }
      return false
    }, function (error) {
      DSN.log('clipboard fallback rejected', error)
      return false
    })
  }

  function bridgeInsert(html, text, t) {
    var translate = translateOf(t)
    var rich = asText(html)
    var plain = asText(text)
    if (!plain && rich) plain = textFromHtml(rich)
    if (!rich && !plain) return Promise.resolve(false)
    var handle = activeBridge()
    if (handle) {
      var inserted = false
      try {
        inserted = handle.insert(rich, plain) === true
      } catch (error) {
        DSN.log('bridge insert failed', error)
      }
      if (inserted) return Promise.resolve(true)
    }
    return copyFallback(rich, plain, translate)
  }

  DSN.bridge = {
    get: function () {
      try {
        return activeBridge()
      } catch (error) {
        DSN.log('bridge get failed', error)
        return null
      }
    },
    insert: function (html, text, t) {
      return bridgeInsert(html, text, t)
    },
    /** Quote the text into the active composer exactly like 引用文本 does. */
    quote: function (text) {
      try {
        var handle = activeBridge()
        if (!handle || typeof handle.quote !== 'function') return false
        return handle.quote(text) === true
      } catch (error) {
        DSN.log('bridge quote failed', error)
        return false
      }
    },
    subscribe: function (listener) {
      if (typeof listener !== 'function') return function () {}
      bridgeBus.listeners.add(listener)
      return function () {
        bridgeBus.listeners.delete(listener)
      }
    },
  }

  /**
   * Invisible dock entry: publishes the active composer's session and insert
   * callback so the panel can hand a note to the input the user is typing in.
   * Every mounted instance registers itself; the last one mounted wins and any
   * other mounted instance stays available as a fallback.
   */
  function ComposerBridgeComponent(props) {
    var p = props || {}
    var React = DSN.React
    if (!React || typeof React.useRef !== 'function' || typeof React.useMemo !== 'function' || typeof React.useEffect !== 'function') {
      return null
    }

    var session = p.session && typeof p.session === 'object' ? p.session : null
    var sessionId = (session && session.sessionId) || p.sessionId || ''
    var title = session && typeof session.title === 'string' ? session.title : ''

    if (typeof p.useSessions === 'function') {
      var summary = p.useSessions(function (list) {
        if (!list || !list.byId || !sessionId) return null
        return list.byId[sessionId] || null
      })
      if (summary) {
        var summaryTitle = asText(summary.title || summary.displayTitle || '')
        if (summaryTitle) title = summaryTitle
      }
    }

    var latestRef = React.useRef(null)
    latestRef.current = { actions: p.inputActions || null }

    var handle = React.useMemo(function () {
      return {
        sessionId: sessionId || null,
        sessionTitle: title,
        insert: function (html, text) {
          var latest = latestRef.current
          return insertIntoComposer(latest && latest.actions, html, text)
        },
        /** Same gesture as 引用文本: the host turns the text into a QuoteNode. */
        quote: function (text) {
          var latest = latestRef.current
          var actions = latest && latest.actions
          if (!actions || typeof actions.insertQuote !== 'function') return false
          try {
            return actions.insertQuote(asText(text)) === true
          } catch (error) {
            DSN.log('bridge quote failed', error)
            return false
          }
        },
      }
    }, [sessionId, title])

    React.useEffect(function () {
      publishBridge(handle)
      return function () {
        releaseBridge(handle)
      }
    }, [handle])

    return null
  }

  DSN.installComposerBridge = function (options) {
    var opts = options || {}
    var ctx = opts.ctx || null
    var slots = ctx && ctx.slots ? ctx.slots : null
    if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
      DSN.log('composer bridge skipped: slots service unavailable')
      return function () {}
    }
    var registration = null
    try {
      registration = slots.inject('conversation.input.dock', function () {
        try {
          return slots.register(
            { name: 'conversation.input.dock', id: 'dsh-sticky-board-bridge' },
            ComposerBridgeComponent,
          )
        } catch (error) {
          DSN.log('composer bridge component registration failed', error)
          return function () {}
        }
      })
    } catch (error) {
      DSN.log('composer bridge slot injection failed', error)
      return function () {}
    }
    var disposed = false
    return function dispose() {
      if (disposed) return
      disposed = true
      try {
        if (typeof registration === 'function') registration()
      } catch (error) {
        DSN.log('composer bridge dispose failed', error)
      }
    }
  }
})()

/* ================= 65-drop.js ================= */
/* ------------------------------------------------------------------ *
 * Drag a note out of the panel and drop it on the Composer.
 *
 * The host composer only accepts dropped *files* (its document-level drop
 * listener ignores everything else), so dropping text has no built-in
 * behaviour. We own the gesture instead: while a note card is being dragged
 * we claim dragover/drop over `[data-composer-card]`, paint a drop ring plus
 * a "松开以插入便签" hint, and on drop insert the note as Markdown text at
 * the caret through the same composer bridge the "插入到输入框" button uses.
 *
 *  - DSN.htmlToMarkdown   note HTML -> Markdown (tables / code / lists kept)
 *  - DSN.installNoteDrop  document-level drag listeners + visual affordance
 * ------------------------------------------------------------------ */

;(function () {
  'use strict'

  var NOTE_MIME = 'application/x-dsn-note'
  var COMPOSER_SELECTOR = '[data-composer-card]'
  // Our own surfaces: dropping a card back here means reorder / archive / trash,
  // which the board owns — never claim those gestures.
  var OWN_SURFACE_SELECTOR = '[data-dsn-panel], .dsn-chip-layer, .dsn-drop-layer, .dsn-float, .dsn-float-layer, .dsn-toast-host'
  var DROP_LAYER_CLASS = 'dsn-drop-layer'
  var HINT_OFFSET = 14

  DSN.addStrings({
    'drop.hint': '松开鼠标，把便签插入输入框',
    'drop.image': '图片',
    'drop.inserted': '已将便签插入输入框',
    'drop.failed': '插入失败，便签已复制到剪贴板',
  }, {
    'drop.hint': 'Release to insert this note',
    'drop.image': 'image',
    'drop.inserted': 'Note inserted into the input',
    'drop.failed': 'Insert failed — note copied to the clipboard',
  })

  var DROP_CSS = [
    '.dsn-drop-layer { position: fixed; inset: 0; overflow: visible; z-index: 2147483002; pointer-events: none; }',
    '.dsn-drop-ring { position: absolute; box-sizing: border-box; margin: 0; border: 2px solid var(--dsw-alias-state-business-primary, #4176e6); border-radius: 14px; background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 8%, transparent); pointer-events: none; transition: opacity 120ms ease; }',
    '.dsn-drop-hint { position: absolute; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; margin: 0; border-radius: 999px; background: var(--dsw-alias-state-business-primary, #4176e6); color: var(--dsw-alias-label-on-brand, #ffffff); font-family: inherit; font-size: 12px; font-weight: 500; line-height: 1; white-space: nowrap; box-shadow: 0 1px 2px var(--dsw-alias-bg-mask-2, rgba(0, 0, 0, 0.12)), 0 8px 20px -8px var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.28)); pointer-events: none; }',
  ].join('\n')

  DSN.addCss('drop', DROP_CSS)

  /* ---------------------------- markdown ---------------------------- */

  var HEADINGS = { h1: '#', h2: '##', h3: '###', h4: '####', h5: '#####', h6: '######' }
  var SKIP_TAGS = { script: 1, style: 1, template: 1, noscript: 1, iframe: 1, svg: 1, button: 1 }

  function collapse(text) {
    return String(text || '').replace(/[\t\r\n]+/g, ' ').replace(/ {2,}/g, ' ')
  }

  function escapeMarkdown(text) {
    return String(text || '').replace(/([\\`*_{}[\]()#+\-!|>])/g, '\\$1')
  }

  function isAbsoluteImage(src) {
    return /^https?:\/\//i.test(src || '')
  }

  function imageMarkdown(node) {
    var alt = collapse(node.getAttribute('alt') || '')
    var src = node.getAttribute('src') || ''
    if (isAbsoluteImage(src)) {
      return '![' + (alt || DSN.t('drop.image')) + '](' + src + ')'
    }
    // Inline data: images would paste megabytes of base64 into the editor.
    return '*[' + (alt || DSN.t('drop.image')) + ']*'
  }

  function inlineText(node) {
    if (!node) return ''
    if (node.nodeType === 3) return collapse(node.nodeValue)
    if (node.nodeType !== 1) return ''
    var tag = String(node.tagName || '').toLowerCase()
    if (SKIP_TAGS[tag]) return ''
    if (tag === 'br') return '\n'
    if (tag === 'img') return imageMarkdown(node)
    if (tag === 'code') {
      var code = node.textContent || ''
      if (!code) return ''
      var tick = code.indexOf('`') >= 0 ? '``' : '`'
      return tick + code + tick
    }
    var inner = ''
    for (var i = 0; i < node.childNodes.length; i += 1) inner += inlineText(node.childNodes[i])
    if (!inner) return ''
    if (tag === 'strong' || tag === 'b') return '**' + inner.trim() + '**'
    if (tag === 'em' || tag === 'i') return '*' + inner.trim() + '*'
    if (tag === 'del' || tag === 's' || tag === 'strike') return '~~' + inner.trim() + '~~'
    if (tag === 'a') {
      var href = node.getAttribute('href') || ''
      if (!/^https?:\/\//i.test(href) && !/^mailto:/i.test(href)) return inner
      var label = inner.trim() || href
      return '[' + label + '](' + href + ')'
    }
    return inner
  }

  function codeBlock(node) {
    var code = node.querySelector ? node.querySelector('code') : null
    var body = (code || node).textContent || ''
    var language = ''
    if (code) {
      var match = /(?:^|\s)language-([\w+#-]+)/.exec(code.getAttribute('class') || '')
      if (match) language = match[1]
    }
    body = body.replace(/\n+$/, '')
    var fence = body.indexOf('```') >= 0 ? '````' : '```'
    return fence + language + '\n' + body + '\n' + fence
  }

  function tableBlock(node) {
    var rows = node.querySelectorAll ? node.querySelectorAll('tr') : []
    if (!rows.length) return ''
    var lines = []
    for (var r = 0; r < rows.length; r += 1) {
      var cells = rows[r].querySelectorAll ? rows[r].querySelectorAll('th,td') : []
      var values = []
      for (var c = 0; c < cells.length; c += 1) {
        values.push(inlineText(cells[c]).replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim())
      }
      lines.push('| ' + values.join(' | ') + ' |')
      if (r === 0) {
        var divider = []
        for (var d = 0; d < values.length; d += 1) divider.push('---')
        lines.push('| ' + divider.join(' | ') + ' |')
      }
    }
    return lines.join('\n')
  }

  function listBlock(node, depth) {
    var ordered = String(node.tagName || '').toLowerCase() === 'ol'
    var lines = []
    var index = 0
    for (var i = 0; i < node.children.length; i += 1) {
      var item = node.children[i]
      if (String(item.tagName || '').toLowerCase() !== 'li') continue
      index += 1
      var nested = ''
      var inline = ''
      for (var j = 0; j < item.childNodes.length; j += 1) {
        var child = item.childNodes[j]
        if (child.nodeType === 1) {
          var childTag = String(child.tagName || '').toLowerCase()
          if (childTag === 'ul' || childTag === 'ol') {
            nested += '\n' + listBlock(child, depth + 1)
            continue
          }
        }
        inline += inlineText(child)
      }
      var marker = ordered ? index + '. ' : '- '
      var indent = '  '.repeat(depth)
      lines.push(indent + marker + inline.trim())
      if (nested) lines.push(nested.replace(/^\n/, ''))
    }
    return lines.join('\n')
  }

  function quoteBlock(node) {
    var body = blocksOf(node, 0, true).trim()
    if (!body) return ''
    return body.split('\n').map(function (line) {
      return line ? '> ' + line : '>'
    }).join('\n')
  }

  function isBlockTag(tag) {
    return tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article' ||
      tag === 'ul' || tag === 'ol' || tag === 'pre' || tag === 'blockquote' ||
      tag === 'table' || tag === 'hr' || tag === 'figure' || tag === 'header' ||
      tag === 'footer' || tag === 'main' || tag === 'aside' || tag in HEADINGS
  }

  function blocksOf(node, depth, keepHeadings) {
    var out = []
    var inline = ''
    function flushInline() {
      var text = inline.trim()
      inline = ''
      if (text) out.push(text)
    }
    for (var i = 0; i < node.childNodes.length; i += 1) {
      var child = node.childNodes[i]
      if (child.nodeType === 1) {
        var tag = String(child.tagName || '').toLowerCase()
        if (SKIP_TAGS[tag]) continue
        if (tag in HEADINGS && !keepHeadings) {
          flushInline()
          var text = inlineText(child).trim()
          if (text) out.push(HEADINGS[tag] + ' ' + text)
          continue
        }
        if (tag === 'pre') {
          flushInline()
          out.push(codeBlock(child))
          continue
        }
        if (tag === 'table') {
          flushInline()
          out.push(tableBlock(child))
          continue
        }
        if (tag === 'ul' || tag === 'ol') {
          flushInline()
          out.push(listBlock(child, depth))
          continue
        }
        if (tag === 'blockquote') {
          flushInline()
          out.push(quoteBlock(child))
          continue
        }
        if (tag === 'hr') {
          flushInline()
          out.push('---')
          continue
        }
        if (isBlockTag(tag)) {
          flushInline()
          var nested = blocksOf(child, depth, keepHeadings).trim()
          if (nested) out.push(nested)
          continue
        }
      }
      inline += inlineText(child)
    }
    flushInline()
    return out.filter(function (item) { return item !== '' }).join('\n\n')
  }

  function parseBody(source) {
    var Parser = typeof DOMParser === 'function' ? DOMParser : null
    if (Parser) {
      try {
        var parsed = new Parser().parseFromString(source, 'text/html')
        if (parsed && parsed.body) return parsed.body
      } catch (error) {
        DSN.log('markdown DOMParser failed', error)
      }
    }
    // Environment without a global DOMParser (jsdom tests, some embeds): build an
    // inert document instead. Setting innerHTML there never executes scripts.
    var doc = typeof document !== 'undefined' ? document : null
    if (doc && doc.implementation && typeof doc.implementation.createHTMLDocument === 'function') {
      try {
        var holder = doc.implementation.createHTMLDocument('')
        holder.body.innerHTML = source
        return holder.body
      } catch (error) {
        DSN.log('markdown inert document failed', error)
      }
    }
    return null
  }

  DSN.htmlToMarkdown = function (html) {
    var source = typeof html === 'string' ? html : ''
    if (!source) return ''
    var body = parseBody(source)
    if (!body) return ''
    var markdown = blocksOf(body, 0, false)
    return markdown
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim()
  }

  /* --------------------------- drop surface -------------------------- */

  function hasNoteType(dataTransfer) {
    if (!dataTransfer) return false
    var types = dataTransfer.types
    if (!types) return false
    if (typeof types.indexOf === 'function') return types.indexOf(NOTE_MIME) >= 0
    for (var i = 0; i < types.length; i += 1) {
      if (types[i] === NOTE_MIME) return true
    }
    return false
  }

  function composerCardOf(target) {
    if (!target || typeof target.closest !== 'function') return null
    try {
      return target.closest(COMPOSER_SELECTOR)
    } catch (error) {
      return null
    }
  }

  function ownSurfaceOf(target) {
    if (!target || typeof target.closest !== 'function') return null
    try {
      return target.closest(OWN_SURFACE_SELECTOR)
    } catch (error) {
      return null
    }
  }

  function findNote(store, noteId) {
    if (!store || !noteId) return null
    var state = store.getSnapshot()
    if (!state || !state.notes) return null
    for (var i = 0; i < state.notes.length; i += 1) {
      if (state.notes[i].id === noteId) return state.notes[i]
    }
    return null
  }

  DSN.installNoteDrop = function (options) {
    var opts = options || {}
    var store = opts.store || null
    var t = typeof opts.t === 'function' ? opts.t : DSN.t
    var doc = opts.document || (typeof document !== 'undefined' ? document : null)
    if (!doc || !store) return function () {}

    var layer = null
    var ring = null
    var hint = null
    var visible = false
    var disposers = []
    /* The drag events fire faster than the screen refreshes, and every layout
     * read (offsetWidth / getBoundingClientRect) forces the whole page to
     * reflow — that is what made dragging feel sticky on long transcripts.
     * So: remember the intent, measure the pill only when its text changes, and
     * paint at most once per animation frame. */
    var frameId = 0
    var timerId = 0
    var pendingJob = null
    var hintText = ''
    var hintSize = { w: 180, h: 28 }
    var ringCache = { card: null, rect: null, at: 0 }

    function ensureLayer() {
      if (layer) return
      layer = doc.createElement('div')
      layer.className = DROP_LAYER_CLASS
      layer.setAttribute('data-dsn-drop-layer', '1')
      ring = doc.createElement('div')
      ring.className = 'dsn-drop-ring'
      ring.style.opacity = '0'
      hint = doc.createElement('div')
      hint.className = 'dsn-drop-hint'
      hint.style.display = 'none'
      layer.appendChild(ring)
      layer.appendChild(hint)
      doc.body.appendChild(layer)
    }

    function cancelFrame() {
      if (timerId) {
        try { globalThis.clearTimeout(timerId) } catch (error) { /* ignore */ }
        timerId = 0
      }
      if (!frameId) return
      try {
        if (typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(frameId)
      } catch (error) { /* ignore */ }
      frameId = 0
    }

    function hide() {
      pendingJob = null
      cancelFrame()
      if (!visible) return
      visible = false
      if (ring) ring.style.opacity = '0'
      if (hint) hint.style.display = 'none'
    }

    /** Measure the pill once per label change, never on the pointer path. */
    function measureHint() {
      if (!hint) return
      var width = hint.offsetWidth || 0
      var height = hint.offsetHeight || 0
      if (width > 0 && height > 0) hintSize = { w: width, h: height }
    }

    /** Paint the pending affordance. Runs at most once per frame. */
    function paint() {
      frameId = 0
      if (timerId) {
        try { globalThis.clearTimeout(timerId) } catch (error) { /* ignore */ }
        timerId = 0
      }
      var job = pendingJob
      pendingJob = null
      if (!job) return
      ensureLayer()
      visible = true
      if (job.mode === 'insert') {
        var card = job.card
        var now = Date.now()
        var rect = null
        if (ringCache.card === card && ringCache.rect && now - ringCache.at < 150) {
          rect = ringCache.rect
        } else {
          try {
            rect = card && typeof card.getBoundingClientRect === 'function' ? card.getBoundingClientRect() : null
          } catch (error) {
            rect = null
          }
          ringCache = { card: card, rect: rect, at: now }
        }
        if (rect && (rect.width || rect.height)) {
          ring.style.left = rect.left - 3 + 'px'
          ring.style.top = rect.top - 3 + 'px'
          ring.style.width = rect.width + 6 + 'px'
          ring.style.height = rect.height + 6 + 'px'
          ring.style.opacity = '1'
        } else {
          ring.style.opacity = '0'
        }
      } else {
        /* Pop-out affordance: nothing is targeted, so only the pill shows. */
        ring.style.opacity = '0'
      }
      var text = job.mode === 'insert' ? t('drop.hint') : t('float.dropHint')
      if (text !== hintText) {
        hintText = text
        hint.textContent = text
        hint.style.display = 'inline-flex'
        measureHint()
      } else if (hint.style.display !== 'inline-flex') {
        hint.style.display = 'inline-flex'
      }
      var viewportWidth = globalThis.innerWidth || doc.documentElement.clientWidth || 0
      var viewportHeight = globalThis.innerHeight || doc.documentElement.clientHeight || 0
      var x = (job.x || 0) + HINT_OFFSET
      var y = (job.y || 0) + HINT_OFFSET
      if (viewportWidth && x + hintSize.w > viewportWidth - 8) x = viewportWidth - hintSize.w - 8
      if (viewportHeight && y + hintSize.h > viewportHeight - 8) y = y - hintSize.h - HINT_OFFSET * 2
      hint.style.left = Math.max(8, x) + 'px'
      hint.style.top = Math.max(8, y) + 'px'
    }

    function schedule(job) {
      pendingJob = job
      if (frameId) return
      var raf = null
      try {
        raf = globalThis.requestAnimationFrame
      } catch (error) {
        raf = null
      }
      if (typeof raf === 'function') {
        frameId = raf(paint)
        /* Frames never arrive in a hidden tab or under virtual time, so a timer
         * guarantees the affordance still shows up shortly after the gesture. */
        timerId = globalThis.setTimeout(function () { timerId = 0; paint() }, 48)
        return
      }
      paint()
    }

    /**
     * What a release at this position means:
     *   'insert' — over the composer card (insert the note as Markdown)
     *   'float'  — anywhere else outside our own surfaces (pop the note out)
     *   null     — over our own panel surface, or not our drag payload
     */
    function dropMode(event) {
      if (!hasNoteType(event.dataTransfer)) return null
      if (composerCardOf(event.target)) return 'insert'
      if (ownSurfaceOf(event.target)) return null
      return 'float'
    }

    function openFloater(event, noteId) {
      if (typeof DSN.openFloater !== 'function') return
      var opened = null
      try {
        opened = DSN.openFloater({
          store: store,
          noteId: noteId,
          point: { x: event.clientX || 0, y: event.clientY || 0 },
        })
      } catch (error) {
        DSN.log('open floater failed', error)
        opened = null
      }
      if (opened && opened.created) DSN.toast(t('float.opened'), 'info')
    }

    function onDragOver(event) {
      var mode = dropMode(event)
      if (!mode) {
        hide()
        return
      }
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      schedule({
        mode: mode,
        card: mode === 'insert' ? composerCardOf(event.target) : null,
        x: event.clientX || 0,
        y: event.clientY || 0,
      })
    }

    function onDrop(event) {
      var mode = dropMode(event)
      if (!mode) return
      event.preventDefault()
      if (typeof event.stopPropagation === 'function') event.stopPropagation()
      var noteId = ''
      try {
        noteId = String(event.dataTransfer.getData(NOTE_MIME) || '')
      } catch (error) {
        noteId = ''
      }
      hide()
      var note = findNote(store, noteId)
      if (!note) return
      if (mode === 'float') {
        openFloater(event, noteId)
        return
      }
      var markdown = DSN.htmlToMarkdown(note.html || '')
      var payload = markdown || note.text || ''
      if (!payload) return
      var result
      try {
        result = DSN.bridge && typeof DSN.bridge.insert === 'function'
          ? DSN.bridge.insert(note.html || '', payload, t)
          : null
      } catch (error) {
        DSN.log('drop insert failed', error)
        result = null
      }
      function settle(ok) {
        DSN.toast(t(ok ? 'drop.inserted' : 'drop.failed'), ok ? 'info' : 'error')
      }
      if (result && typeof result.then === 'function') {
        result.then(settle, function () { settle(false) })
        return
      }
      settle(result === true)
    }

    function onDragEnd() {
      hide()
    }

    function onDragLeave(event) {
      if (!hasNoteType(event.dataTransfer)) return
      if (composerCardOf(event.target) || ownSurfaceOf(event.target)) hide()
    }

    function listen(target, type, handler, capture) {
      if (!target || typeof target.addEventListener !== 'function') return
      target.addEventListener(type, handler, capture === true)
      disposers.push(function () {
        target.removeEventListener(type, handler, capture === true)
      })
    }

    listen(doc, 'dragover', onDragOver, true)
    listen(doc, 'dragleave', onDragLeave, true)
    listen(doc, 'drop', onDrop, true)
    listen(doc, 'dragend', onDragEnd, true)

    return function dispose() {
      hide()
      disposers.forEach(function (off) {
        try {
          off()
        } catch (error) {
          DSN.log('drop dispose failed', error)
        }
      })
      disposers = []
      if (layer && layer.parentNode) layer.parentNode.removeChild(layer)
      layer = null
      ring = null
      hint = null
      visible = false
    }
  }
})()

/* ================= 68-float.js ================= */
/* ------------------------------------------------------------------ *
 * Detached note windows.
 *
 * Dragging a note card and releasing it anywhere outside the composer (the
 * host ignores text drops there) pops that note out into its own small
 * window: movable, resizable, collapsible and independent, so several notes
 * can sit side by side for comparison. Geometry lives in the notes document
 * (`ui.floaters`), so the arrangement survives a reload while staying a
 * per-browser view state (it is never merged across machines).
 *
 *  - DSN.floaterViewport   viewport size with jsdom-friendly fallbacks
 *  - DSN.floaterRectAt     default window rect for a drop point
 *  - DSN.openFloater       open / raise a window for one note
 *  - DSN.Floater           one detached window
 *  - DSN.FloaterLayer      every detached window (mounted in shell.overlay)
 * ------------------------------------------------------------------ */

;(function () {
  'use strict'

  var LAYER_CLASS = 'dsn-float-layer'

  DSN.addStrings({
    'float.dropHint': '松开鼠标，拉出独立便签窗口',
    'float.opened': '已拉出独立窗口',
    'float.full': '最多同时拉出 {n} 个窗口',
    'float.close': '关闭窗口',
    'float.collapse': '折叠',
    'float.expand': '展开',
    'float.untitled': '独立便签',
    'float.dragHint': '拖动标题栏移动，拖右下角调整大小',
    'float.clearAll': '关闭全部独立窗口',
  }, {
    'float.dropHint': 'Release to open a floating note window',
    'float.opened': 'Floating window opened',
    'float.full': 'Up to {n} floating windows at once',
    'float.close': 'Close window',
    'float.collapse': 'Collapse',
    'float.expand': 'Expand',
    'float.untitled': 'Floating note',
    'float.dragHint': 'Drag the header to move, drag the corner to resize',
    'float.clearAll': 'Close every floating window',
  })

  var FLOAT_CSS = [
    '.dsn-float-layer { position: fixed; inset: 0; overflow: hidden; z-index: 2147483001; pointer-events: none; }',
    '.dsn-float { position: fixed; box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2, rgba(11, 12, 15, 0.3)); border-radius: 12px; background: var(--dsw-alias-bg-layer-1, #ffffff); color: var(--dsw-alias-label-primary, #1b1b1f); box-shadow: 0 14px 34px -14px var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.34)), 0 2px 6px var(--dsw-alias-bg-mask-2, rgba(0, 0, 0, 0.12)); pointer-events: auto; }',
    '.dsn-float-head { display: flex; align-items: center; gap: 6px; flex: none; padding: 5px 6px 5px 9px; margin: 0; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(11, 12, 15, 0.12)); background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #ffffff) 88%, var(--dsw-alias-bg-layer-3, #f5f6f7)); cursor: grab; touch-action: none; user-select: none; }',
    '.dsn-float-head:active { cursor: grabbing; }',
    '.dsn-float-icon { display: inline-flex; flex: none; color: var(--dsw-alias-label-tertiary, #adb2b8); }',
    '.dsn-float-title { flex: 1 1 auto; min-width: 0; margin: 0; font-family: inherit; font-size: 12.5px; font-weight: 600; line-height: 1.3; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; }',
    '.dsn-float-actions { display: inline-flex; align-items: center; gap: 1px; flex: none; }',
    '.dsn-float-prio { display: inline-flex; align-items: center; flex: 0 0 auto; opacity: 0.95; }',
    '.dsn-float-btn { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; margin: 0; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-tertiary, #adb2b8); cursor: pointer; }',
    '.dsn-float-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06)); color: var(--dsw-alias-label-primary, #1b1b1f); }',
    '.dsn-float-btn:focus-visible { outline: 2px solid var(--dsw-alias-border-l4, rgba(11, 12, 15, 0.2)); outline-offset: -1px; }',
    '.dsn-float-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 8px 10px 4px; margin: 0; }',
    '.dsn-float.is-collapsed .dsn-float-body { display: none; }',
    '.dsn-float-body .dsn-content { font-size: 12.5px; line-height: 1.55; }',
    '.dsn-float-foot { display: flex; align-items: center; gap: 6px; flex: none; padding: 0 10px 8px; margin: 0; color: var(--dsw-alias-label-tertiary, #adb2b8); font-family: inherit; font-size: 11px; line-height: 1.3; }',
    '.dsn-float-source { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.dsn-float-resize { position: absolute; right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize; touch-action: none; color: var(--dsw-alias-label-tertiary, #adb2b8); background-image: repeating-linear-gradient(135deg, currentColor 0 1px, transparent 1px 4px); opacity: 0.45; }',
    '.dsn-float-resize:hover { opacity: 0.8; }',
  ].join('\n')

  DSN.addCss('float', FLOAT_CSS)

  /* ----------------------------- geometry --------------------------- */

  DSN.floaterViewport = function () {
    var width = 0
    var height = 0
    try {
      width = globalThis.innerWidth || 0
      height = globalThis.innerHeight || 0
    } catch (error) {
      width = 0
      height = 0
    }
    if (!width && typeof document !== 'undefined' && document.documentElement) {
      width = document.documentElement.clientWidth || 0
    }
    if (!height && typeof document !== 'undefined' && document.documentElement) {
      height = document.documentElement.clientHeight || 0
    }
    return { w: width || 1280, h: height || 800 }
  }

  /**
   * Default window rect for a drop point: slightly right of the cursor. Two
   * windows dropped on the same spot cascade instead of hiding each other,
   * which is the whole point of pulling several notes out to compare them.
   */
  DSN.floaterRectAt = function (point, existing) {
    var viewport = DSN.floaterViewport()
    var width = Math.min(DSN.FLOAT_W, Math.max(DSN.FLOAT_MIN_W, viewport.w - 32))
    var height = Math.min(DSN.FLOAT_H, Math.max(DSN.FLOAT_MIN_H, viewport.h - 96))
    var anchorX = point && isFinite(point.x) ? Number(point.x) : viewport.w / 2
    var anchorY = point && isFinite(point.y) ? Number(point.y) : viewport.h / 2
    var x = Math.round(anchorX - width * 0.3)
    var y = Math.round(anchorY - 30)
    var maxX = Math.max(8, viewport.w - width - 8)
    var maxY = Math.max(8, viewport.h - height - 8)
    x = DSN.clamp(x, 8, maxX)
    y = DSN.clamp(y, 8, maxY)
    var taken = Array.isArray(existing) ? existing : []
    var step = 28
    var guard = 0
    while (guard < DSN.MAX_FLOATERS + 1 && taken.some(function (item) {
      return Math.abs(Number(item.x) - x) < 18 && Math.abs(Number(item.y) - y) < 18
    })) {
      x += step
      y += step
      if (x > maxX) x = 8 + (guard * step) % Math.max(step, maxX - 8)
      if (y > maxY) y = 8 + (guard * step) % Math.max(step, maxY - 8)
      guard += 1
    }
    return { x: x, y: y, w: Math.round(width), h: Math.round(height) }
  }

  /** Open (or raise) the detached window for `noteId`. Returns the note id. */
  DSN.openFloater = function (options) {
    var opts = options || {}
    var store = opts.store || DSN.store
    var noteId = String(opts.noteId || '')
    if (!store || !noteId) return null
    var current = (store.getSnapshot().ui || {}).floaters || []
    var before = current.length
    var rect = opts.rect || DSN.floaterRectAt(opts.point, current)
    var result = store.actions.addFloater(noteId, rect)
    var after = ((store.getSnapshot().ui || {}).floaters || []).length
    return { noteId: result, created: after > before, count: after }
  }

  /* ---------------------------- components -------------------------- */

  /**
   * One detached window: header drag, corner resize, collapse and close.
   * Geometry is committed to the store only when the gesture ends.
   */
  DSN.Floater = function Floater(props) {
    var React = DSN.React
    var h = DSN.h
    var store = props.store
    var t = props.t
    var entry = props.entry
    var note = props.note
    var rootRef = React.useRef(null)
    var dragRef = React.useRef(null)
    var noteId = entry.noteId
    var title = note.title || DSN.headline(note.text || '', 48) || t('float.untitled')

    function beginDrag(kind, event) {
      if (event.button !== undefined && event.button !== 0) return
      /* Buttons inside the header must stay clickable: capturing the pointer on
       * the window root retargets pointerup, which eats their click. */
      var target = event.target
      if (target && typeof target.closest === 'function' && target.closest('[data-dsn-nodrag]')) return
      var node = rootRef.current
      if (!node) return
      event.preventDefault()
      if (typeof event.stopPropagation === 'function') event.stopPropagation()
      try { store.actions.raiseFloater(noteId) } catch (error) { DSN.log('raise floater failed', error) }
      dragRef.current = {
        kind: kind,
        startX: Number(event.clientX) || 0,
        startY: Number(event.clientY) || 0,
        x: entry.x,
        y: entry.y,
        w: entry.w,
        h: entry.h,
        nextX: entry.x,
        nextY: entry.y,
        nextW: entry.w,
        nextH: entry.h,
      }
      if (event.pointerId !== undefined && typeof node.setPointerCapture === 'function') {
        try { node.setPointerCapture(event.pointerId) } catch (error) { /* ignore */ }
      }
    }

    function onPointerMove(event) {
      var drag = dragRef.current
      if (!drag) return
      var node = rootRef.current
      if (!node) return
      var dx = (Number(event.clientX) || 0) - drag.startX
      var dy = (Number(event.clientY) || 0) - drag.startY
      if (drag.kind === 'move') {
        var viewport = DSN.floaterViewport()
        drag.nextX = DSN.clamp(Math.round(drag.x + dx), 60 - drag.w, Math.max(0, viewport.w - 80))
        drag.nextY = DSN.clamp(Math.round(drag.y + dy), 0, Math.max(0, viewport.h - 34))
        node.style.left = drag.nextX + 'px'
        node.style.top = drag.nextY + 'px'
        return
      }
      drag.nextW = DSN.clamp(Math.round(drag.w + dx), DSN.FLOAT_MIN_W, DSN.FLOAT_MAX_W)
      drag.nextH = DSN.clamp(Math.round(drag.h + dy), DSN.FLOAT_MIN_H, DSN.FLOAT_MAX_H)
      node.style.width = drag.nextW + 'px'
      node.style.height = drag.nextH + 'px'
    }

    function endDrag() {
      var drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      if (drag.kind === 'move') store.actions.moveFloater(noteId, drag.nextX, drag.nextY)
      else store.actions.resizeFloater(noteId, drag.nextW, drag.nextH)
    }

    function toggleCollapsed() {
      store.actions.setFloaterCollapsed(noteId, entry.collapsed !== true)
    }

    function close() {
      store.actions.removeFloater(noteId)
    }

    var style = {
      left: entry.x + 'px',
      top: entry.y + 'px',
      width: entry.w + 'px',
      height: entry.collapsed ? 'auto' : entry.h + 'px',
      zIndex: entry.z,
    }

    var head = h('div', {
      className: 'dsn-float-head',
      title: t('float.dragHint'),
      onPointerDown: function (event) { beginDrag('move', event) },
    },
      h('span', { className: 'dsn-float-icon', 'aria-hidden': 'true' }, h(DSN.Icon, { name: 'note', size: 13 })),
      h('span', { className: 'dsn-float-title' }, title),
      typeof DSN.PriorityPill === 'function'
        ? h('span', { className: 'dsn-float-prio', 'data-dsn-nodrag': '1' },
          h(DSN.PriorityPill, { t: t, priority: note.priority }))
        : null,
      h('div', { className: 'dsn-float-actions', 'data-dsn-nodrag': '1' },
        h('button', {
          type: 'button',
          className: 'dsn-float-btn',
          title: t(entry.collapsed ? 'float.expand' : 'float.collapse'),
          'aria-label': t(entry.collapsed ? 'float.expand' : 'float.collapse'),
          'aria-expanded': entry.collapsed !== true,
          onClick: toggleCollapsed,
        }, h(DSN.Icon, { name: entry.collapsed ? 'expand' : 'collapse', size: 13 })),
        h('button', {
          type: 'button',
          className: 'dsn-float-btn',
          title: t('float.close'),
          'aria-label': t('float.close'),
          onClick: close,
        }, h(DSN.Icon, { name: 'close', size: 13 })),
      ),
    )

    var body = h('div', { className: 'dsn-float-body' },
      h(DSN.Content, { html: note.html, kind: note.kind }),
      typeof DSN.CommentThread === 'function'
        ? h(DSN.CommentThread, { store: store, t: t, note: note, compact: true })
        : null)

    var foot = h('div', { className: 'dsn-float-foot' },
      h('span', { className: 'dsn-float-source' },
        note.source && note.source.sessionTitle
          ? t('list.source', { name: note.source.sessionTitle })
          : DSN.formatAge(note.updatedAt, t)),
    )

    var handle = h('div', {
      className: 'dsn-float-resize',
      'aria-hidden': 'true',
      onPointerDown: function (event) { beginDrag('resize', event) },
    })

    return h('div', {
      ref: rootRef,
      className: 'dsn-float' + (entry.collapsed ? ' is-collapsed' : ''),
      style: style,
      role: 'dialog',
      'aria-label': t('float.untitled'),
      'data-dsn-float': noteId,
      onPointerMove: onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
      head,
      body,
      foot,
      handle,
    )
  }

  /** Every detached window, mounted once in `shell.overlay`. */
  DSN.FloaterLayer = function FloaterLayer(props) {
    var React = DSN.React
    var h = DSN.h
    var store = props.store
    var t = typeof props.t === 'function' ? props.t : DSN.t
    var snapshot = DSN.useStore(store)
    var floaters = (snapshot && snapshot.ui && snapshot.ui.floaters) || []
    var notes = {}
    var missing = []
    if (snapshot && Array.isArray(snapshot.notes)) {
      for (var i = 0; i < snapshot.notes.length; i += 1) {
        var item = snapshot.notes[i]
        if (item && !item.deletedAt) notes[item.id] = item
      }
    }
    for (var j = 0; j < floaters.length; j += 1) {
      if (!notes[floaters[j].noteId]) missing.push(floaters[j].noteId)
    }
    var missingKey = missing.join('|')

    // A window whose note was purged elsewhere (another tab, the trash) closes
    // itself instead of lingering as an empty shell.
    React.useEffect(function () {
      if (!missingKey) return
      var ids = missingKey.split('|')
      for (var k = 0; k < ids.length; k += 1) store.actions.removeFloater(ids[k])
    }, [missingKey])

    if (!snapshot || floaters.length === 0) return null
    var cards = []
    for (var n = 0; n < floaters.length; n += 1) {
      var entry = floaters[n]
      var note = notes[entry.noteId]
      if (!note) continue
      cards.push(h(DSN.Floater, {
        key: entry.noteId,
        store: store,
        t: t,
        entry: entry,
        note: note,
      }))
    }
    if (cards.length === 0) return null
    return h('div', { className: LAYER_CLASS, 'data-dsn-float-layer': '1' }, cards)
  }
})()

/* ================= 70-pip.js ================= */
/* ------------------------------------------------------------------ *
 * Document picture-in-picture hosting.
 *
 * The PiP document has no stylesheets and no host CSS variables, so the
 * plugin carries its own: the joined CSS chunks are injected as one
 * <style>, and the computed value of every name in DSN.TOKENS is copied
 * onto the PiP <html> as an inline custom property. That is what makes
 * the embedded panel look identical in both windows and keeps it in sync
 * with the host theme, without the plugin ever writing a colour value.
 *
 * The PiP window mounts the same DSN.Panel with embedded:true and the
 * very same store object, so edits from either window are one state.
 *
 * Document Picture-in-Picture is Chromium-only; every entry point is a
 * no-op or an error toast elsewhere.
 * ------------------------------------------------------------------ */

DSN.PIP_EVENT = 'dsn:pipchange'
DSN.pipHandle = null

;(function () {
  var PIP_WIDTH = 380
  var PIP_HEIGHT = 560

  /** In-flight requestWindow promise, so a double click cannot open two windows. */
  var pending = null

  function trim(value) {
    return typeof value === 'string' ? value.replace(/^\s+|\s+$/g, '') : ''
  }

  function readName(target, name) {
    try {
      var style = getComputedStyle(target)
      return style ? trim(style.getPropertyValue(name)) : ''
    } catch (error) {
      return ''
    }
  }

  function addClass(node, name) {
    if (!node || !node.classList) return
    try {
      node.classList.add(name)
    } catch (error) { DSN.log('pip addClass failed', error) }
  }

  function emitPipChange(open) {
    try {
      var event = null
      if (typeof CustomEvent === 'function') {
        event = new CustomEvent(DSN.PIP_EVENT, { detail: { open: !!open } })
      } else {
        event = document.createEvent('CustomEvent')
        event.initCustomEvent(DSN.PIP_EVENT, false, false, { open: !!open })
      }
      document.dispatchEvent(event)
    } catch (error) { DSN.log('pip event failed', error) }
  }

  function toastFailure(t) {
    var text = ''
    try {
      text = t('pip.unsupported')
    } catch (error) { text = '' }
    if (!text) return
    try {
      DSN.toast(text, 'error')
    } catch (error) { DSN.log('pip toast failed', error) }
  }

  /**
   * Copy theme state into the PiP document: the theme attribute, the
   * colour scheme, the body background and every alias token value.
   * Alias tokens are declared on `body` in the host theme, not on :root,
   * so body is read first and :root is only the fallback.
   */
  function applyTheme(pipDoc) {
    var hostDoc = document
    var pipRoot = pipDoc.documentElement
    var hostRoot = hostDoc.documentElement
    var hostBody = hostDoc.body

    var theme = ''
    try {
      theme = hostRoot && hostRoot.getAttribute ? hostRoot.getAttribute('data-theme') || '' : ''
    } catch (error) { theme = '' }
    if (!theme) {
      try {
        theme = hostBody && hostBody.hasAttribute && hostBody.hasAttribute('data-ds-dark-theme') ? 'dark' : ''
      } catch (error) { theme = '' }
    }
    if (theme && pipRoot) {
      try {
        pipRoot.setAttribute('data-theme', theme)
      } catch (error) { DSN.log('pip theme failed', error) }
    }

    var tokens = DSN.TOKENS || []
    for (var i = 0; i < tokens.length; i++) {
      var name = tokens[i]
      if (!name) continue
      var value = hostBody ? readName(hostBody, name) : ''
      if (!value && hostRoot) value = readName(hostRoot, name)
      if (!value) continue
      try {
        pipRoot.style.setProperty(name, value)
      } catch (error) { DSN.log('pip token failed ' + name, error) }
    }

    try {
      var scheme = ''
      if (hostBody) scheme = trim(getComputedStyle(hostBody).colorScheme)
      if (!scheme || scheme === 'normal') scheme = hostRoot ? trim(getComputedStyle(hostRoot).colorScheme) : ''
      if (scheme && scheme !== 'normal') pipRoot.style.colorScheme = scheme
    } catch (error) { DSN.log('pip color-scheme failed', error) }

    try {
      var bg = hostBody ? trim(getComputedStyle(hostBody).backgroundColor) : ''
      var body = pipDoc.body
      if (body && bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
        body.style.backgroundColor = bg
      }
    } catch (error) { DSN.log('pip background failed', error) }
  }

  /**
   * Build and mount the embedded panel inside a fresh PiP document.
   * Throws on failure; the caller closes the window and toasts.
   */
  function build(pipWin, store, t, ctx) {
    var pipDoc = pipWin.document
    var styleOff = null
    var root = null
    var container = null
    try {
      try {
        pipDoc.title = String(t('pip.title') || '')
      } catch (error) { DSN.log('pip title failed', error) }

      if (!pipDoc.body) throw new Error('sticky notes: pip document has no body')
      addClass(pipDoc.body, 'dsn-pip')
      applyTheme(pipDoc)

      /* Every CSS chunk is registered at load time, before any window can
         be opened, so one snapshot of the joined text is complete. */
      styleOff = DSN.injectStyle(pipDoc, DSN.cssText())

      container = pipDoc.createElement('div')
      container.className = 'dsn-pip-root'
      pipDoc.body.appendChild(container)

      root = DSN.ReactDOM.createRoot(container)
      root.render(DSN.h(DSN.Panel, { store: store, t: t, ctx: ctx, embedded: true }))

      var handle = {
        win: pipWin,
        doc: pipDoc,
        container: container,
        root: root,
        styleOff: styleOff,
        disposers: [],
        closed: false,
      }

      handle.disposers.push(
        DSN.on(pipWin, 'pagehide', function () {
          teardown(handle)
        })
      )
      /* Do not leave an orphan PiP window behind when the host page goes. */
      handle.disposers.push(
        DSN.on(window, 'pagehide', function () {
          try {
            pipWin.close()
          } catch (error) { DSN.log('pip host close failed', error) }
        })
      )

      DSN.pipHandle = handle
      try {
        pipWin.focus()
      } catch (error) { DSN.log('pip focus failed', error) }
      emitPipChange(true)
      return handle
    } catch (error) {
      try {
        if (root) root.unmount()
      } catch (unmountError) { DSN.log('pip unmount failed', unmountError) }
      try {
        if (styleOff) styleOff()
      } catch (styleError) { DSN.log('pip style dispose failed', styleError) }
      try {
        if (container && container.parentNode) container.parentNode.removeChild(container)
      } catch (removeError) { DSN.log('pip remove failed', removeError) }
      throw error
    }
  }

  function teardown(handle) {
    if (!handle || handle.closed) return
    handle.closed = true

    var disposers = handle.disposers || []
    handle.disposers = []
    for (var i = 0; i < disposers.length; i++) {
      try {
        disposers[i]()
      } catch (error) { DSN.log('pip disposer failed', error) }
    }

    try {
      if (handle.root) handle.root.unmount()
    } catch (error) { DSN.log('pip unmount failed', error) }
    handle.root = null

    try {
      if (handle.styleOff) handle.styleOff()
    } catch (error) { DSN.log('pip style dispose failed', error) }
    handle.styleOff = null

    try {
      if (handle.container && handle.container.parentNode) handle.container.parentNode.removeChild(handle.container)
    } catch (error) { DSN.log('pip remove failed', error) }
    handle.container = null
    handle.doc = null

    if (DSN.pipHandle === handle) DSN.pipHandle = null
    emitPipChange(false)
  }

  /* ---------------------------------------------------------------- *
   * Public surface
   * ---------------------------------------------------------------- */

  /** @returns {boolean} true when this browser can host a PiP document. */
  DSN.pipSupported = function pipSupported() {
    try {
      var api = typeof window === 'undefined' ? null : window.documentPictureInPicture
      if (!api || typeof api.requestWindow !== 'function') return false
      return !!(DSN.ReactDOM && typeof DSN.ReactDOM.createRoot === 'function')
    } catch (error) {
      return false
    }
  }

  /** @returns {boolean} true while a PiP window is alive. */
  DSN.isPipOpen = function isPipOpen() {
    var handle = DSN.pipHandle
    if (!handle || !handle.win) return false
    try {
      return !handle.win.closed
    } catch (error) {
      return false
    }
  }

  /**
   * Open the PiP window (or reuse the live one). Never opens a second.
   * @param {{store:object, t?:Function, ctx?:object}} options
   * @returns {Promise<object|null>} the handle, or null when unavailable
   */
  DSN.openPip = function openPip(options) {
    var opts = options || {}
    var store = opts.store
    var t = typeof opts.t === 'function' ? opts.t : DSN.fallbackT
    var ctx = opts.ctx

    if (DSN.isPipOpen()) {
      try {
        DSN.pipHandle.win.focus()
      } catch (error) { DSN.log('pip focus failed', error) }
      return Promise.resolve(DSN.pipHandle)
    }
    if (pending) return pending
    if (!DSN.pipSupported()) {
      toastFailure(t)
      return Promise.resolve(null)
    }
    if (!store || typeof store.getSnapshot !== 'function') {
      DSN.log('openPip called without a store')
      toastFailure(t)
      return Promise.resolve(null)
    }

    /* requestWindow must run inside the user gesture, so it is called
       synchronously here and only its result is awaited. */
    var request = null
    try {
      request = window.documentPictureInPicture.requestWindow({ width: PIP_WIDTH, height: PIP_HEIGHT })
    } catch (error) {
      DSN.log('requestWindow threw', error)
      toastFailure(t)
      return Promise.resolve(null)
    }

    pending = Promise.resolve(request)
      .then(function (pipWin) {
        return build(pipWin, store, t, ctx)
      })
      .then(
        function (handle) {
          pending = null
          return handle
        },
        function (error) {
          pending = null
          DSN.log('openPip failed', error)
          toastFailure(t)
          emitPipChange(false)
          return null
        }
      )

    return pending
  }

  /**
   * Close the PiP window and dispose everything mounted in it.
   * @returns {Promise<null>}
   */
  DSN.closePip = function closePip() {
    var handle = DSN.pipHandle
    if (!handle) {
      emitPipChange(false)
      return Promise.resolve(null)
    }
    try {
      handle.win.close()
    } catch (error) { DSN.log('pip window close failed', error) }
    teardown(handle)
    return Promise.resolve(null)
  }

  /**
   * @param {{store:object, t?:Function, ctx?:object}} options
   * @returns {Promise<object|null>}
   */
  DSN.togglePip = function togglePip(options) {
    if (DSN.isPipOpen()) return DSN.closePip()
    if (pending) return pending
    return DSN.openPip(options)
  }
})()

/* ================= 80-sidebar.js ================= */
/* ------------------------------------------------------------------ *
 * Sidebar integration: the footer launcher button and an optional tab in
 * the better-sidebar addon when that service is present.
 * ------------------------------------------------------------------ */

;(function () {
  'use strict'

  /* ------------------------------- styles --------------------------- */

  var SIDEBAR_CSS = [
    '.dsn-launcher { display: inline-flex; align-items: center; justify-content: center; gap: 8px; box-sizing: border-box; height: 32px; min-width: 32px; padding: 0 8px; margin: 0; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary, rgba(27, 27, 31, 0.62)); font-family: inherit; font-size: 13px; font-weight: 500; line-height: 1; white-space: nowrap; cursor: pointer; -webkit-user-select: none; user-select: none; transition: background-color 120ms ease, color 120ms ease; }',
    '.dsn-launcher:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06)); color: var(--dsw-alias-label-primary, #1b1b1f); }',
    '.dsn-launcher--on { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06)); color: var(--dsw-alias-label-primary, #1b1b1f); }',
    '.dsn-launcher:focus-visible { outline: 2px solid var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.16)); outline-offset: 2px; }',
    '.dsn-launcher--icon { width: 32px; padding: 0; }',
    '.dsn-launcher__icon { flex: none; }',
    '.dsn-launcher__label { display: inline-block; overflow: hidden; text-overflow: ellipsis; }',
    '.dsn-header-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; margin: 0; border: none; border-radius: 50%; background: transparent; color: var(--dsw-alias-label-secondary, rgba(27, 27, 31, 0.62)); cursor: pointer; flex: none; -webkit-app-region: no-drag; transition: background-color 120ms ease, color 120ms ease; }',
    '.dsn-header-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06)); color: var(--dsw-alias-label-primary, #1b1b1f); }',
    '.dsn-header-btn.is-on { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06)); color: var(--dsw-alias-label-primary, #1b1b1f); }',
    '.dsn-header-btn:focus-visible { outline: 2px solid var(--dsw-alias-interactive-bg-hover-accent, rgba(65, 118, 230, 0.48)); outline-offset: -1px; }',
  ].join('\n')

  try {
    if (typeof DSN.addCss === 'function') {
      DSN.addCss('sidebar', SIDEBAR_CSS)
    } else if (typeof DSN.injectStyle === 'function' && typeof document !== 'undefined' && document.head) {
      DSN.injectStyle(document, SIDEBAR_CSS)
    }
  } catch (error) {
    DSN.log('sidebar styles failed', error)
  }

  /* ------------------------------ helpers --------------------------- */

  function translateOf(value) {
    return typeof value === 'function' ? value : DSN.fallbackT
  }

  function readOpen(state) {
    return !!(state && state.ui && state.ui.open)
  }

  /** Reactive `store.ui.open` flag: `DSN.useStore` when available. */
  function useOpenState(store) {
    var React = DSN.React
    if (typeof DSN.useStore === 'function') {
      return readOpen(DSN.useStore(store))
    }
    if (!store || typeof store.getSnapshot !== 'function' || typeof store.subscribe !== 'function') return false
    if (React && typeof React.useSyncExternalStore === 'function') {
      if (typeof React.useCallback === 'function') {
        var subscribe = React.useCallback(function (listener) {
          return store.subscribe(listener)
        }, [store])
        var getSnapshot = React.useCallback(function () {
          return readOpen(store.getSnapshot())
        }, [store])
        return React.useSyncExternalStore(subscribe, getSnapshot)
      }
      return React.useSyncExternalStore(
        function (listener) { return store.subscribe(listener) },
        function () { return readOpen(store.getSnapshot()) },
      )
    }
    var pair = React.useState(function () { return readOpen(store.getSnapshot()) })
    React.useEffect(function () {
      return store.subscribe(function (state) {
        pair[1](readOpen(state))
      })
    }, [store])
    return pair[0]
  }

  /* ------------------------------ launcher -------------------------- */

  /**
   * Notes launcher. `variant: 'header'` renders the 28 px circle used by the
   * Session header utilities row; the default is the sidebar footer button.
   */
  DSN.SidebarLauncher = function SidebarLauncher(props) {
    var p = props || {}
    var store = p.store || null
    var t = translateOf(p.t)
    var wide = p.wide === true
    var header = p.variant === 'header'
    var open = useOpenState(store)
    var label = t('sidebar.launcher')

    function toggle(event) {
      try {
        if (event && typeof event.preventDefault === 'function') event.preventDefault()
        if (!store || !store.actions || typeof store.actions.toggleOpen !== 'function') return
        store.actions.toggleOpen()
      } catch (error) {
        DSN.log('launcher toggle failed', error)
      }
    }

    var className = header
      ? 'dsn-header-btn' + (open ? ' is-on' : '')
      : 'dsn-launcher' + (wide ? '' : ' dsn-launcher--icon') + (open ? ' dsn-launcher--on' : '')

    return DSN.h('button', {
      type: 'button',
      className: className,
      title: label,
      'aria-label': label,
      'aria-pressed': open ? 'true' : 'false',
      'data-dsn-header-launcher': header ? '1' : undefined,
      onClick: toggle,
    },
      DSN.Icon({ name: 'note', size: header ? 16 : 16, className: header ? undefined : 'dsn-launcher__icon' }),
      header ? null : (wide ? DSN.h('span', { className: 'dsn-launcher__label' }, label) : null),
    )
  }

  /* ------------------------ session header entry -------------------- */

  /**
   * Register the launcher in the Session header's right-aligned utilities row.
   * `order: -20` puts it leftmost of that whole group of plugin and host
   * buttons, which is where the notes entrance belongs: it is the only global
   * toggle there, everything to its right is session-scoped.
   * @param options - `{ ctx, store, t }`.
   * @returns the disposer.
   */
  DSN.registerHeaderLauncher = function (options) {
    var opts = options || {}
    var ctx = opts.ctx || null
    var store = opts.store || null
    var t = translateOf(opts.t)
    if (!ctx || !ctx.slots || typeof ctx.slots.inject !== 'function') return function () {}

    return ctx.slots.inject('conversation.session.header.utilities', function () {
      return ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'dsh-sticky-board-launcher',
        order: -20,
        locale: DSN.NS,
      }, function StickyNotesHeaderLauncher(props) {
        if (typeof DSN.SidebarLauncher !== 'function') return null
        return DSN.h(DSN.SidebarLauncher, {
          store: store,
          t: (props && props.t) || t,
          variant: 'header',
        })
      })
    })
  }

  /* -------------------------- better-sidebar tab -------------------- */

  /**
   * Register a full-height tab in the better-sidebar addon when the profile
   * provides its `betterSidebar` service. Returns null when the service or the
   * registerTab contract is missing.
   */
  DSN.registerBetterSidebarTab = function (options) {
    var opts = options || {}
    var ctx = opts.ctx || null
    var store = opts.store || null
    var t = translateOf(opts.t)

    var better = null
    if (ctx && typeof ctx.get === 'function') {
      try {
        better = ctx.get('betterSidebar')
      } catch (error) {
        DSN.log('betterSidebar service lookup failed', error)
      }
    }
    if (!better || typeof better.registerTab !== 'function') return null

    var registration = null
    try {
      registration = better.registerTab({
        id: 'dsh-sticky-board',
        title: t('sidebar.tabTitle'),
        description: t('sidebar.tabDescription'),
        icon: DSN.Icon({ name: 'note' }),
        order: 60,
        component: function StickyNotesSidebarTab(props) {
          if (typeof DSN.NotesApp !== 'function') return null
          return DSN.h(DSN.NotesApp, {
            store: store,
            t: t,
            bridge: DSN.bridge || null,
            ctx: ctx,
          })
        },
      })
    } catch (error) {
      DSN.log('better-sidebar tab registration failed', error)
      return null
    }

    if (typeof registration === 'function') return registration
    if (registration && typeof registration.dispose === 'function') {
      return function dispose() {
        try {
          registration.dispose()
        } catch (error) {
          DSN.log('better-sidebar tab dispose failed', error)
        }
      }
    }
    return function () {}
  }
})()

/* ================= 85-inline.js ================= */
/**
 * Two in-conversation entry points that do not depend on text selection:
 *
 * 1. The finalized assistant message's action row (`conversation.chat.assistant-actions`)
 *    gains a 存便签 button that stores the rendered reply.
 * 2. The shared context menu's `image` family gains a 存入便签 action, so right
 *    clicking any rendered image offers it next to 复制图片 / 下载.
 *
 * The reply body is read from the rendered transcript: the closing assistant
 * seat carries the final message of the turn, and the sanitizer that guards
 * every other note write also guards this HTML.
 */
;(function () {
  'use strict'

  /* ------------------------------ strings --------------------------- */

  DSN.addStrings({
    'inline.saveReply': '存便签',
    'inline.savedReply': '已把这条回复存入便签',
    'inline.failedReply': '没能读取这条回复',
    'menu.saveImage': '存入便签',
    'menu.savedImage': '已把图片存入便签',
    'menu.failedImage': '无法读取这张图片',
  }, {
    'inline.saveReply': 'Save to notes',
    'inline.savedReply': 'Reply saved to notes',
    'inline.failedReply': 'Could not read this reply',
    'menu.saveImage': 'Save to notes',
    'menu.savedImage': 'Image saved to notes',
    'menu.failedImage': 'Could not read this image',
  })

  /* ------------------------------ styles ---------------------------- */

  DSN.addCss('inline', [
    '.dsn-inline-action {',
    '  display: inline-flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  box-sizing: border-box;',
    '  width: 28px;',
    '  height: 28px;',
    '  padding: 6px;',
    '  margin: 0;',
    '  border: none;',
    '  border-radius: var(--dsw-radius-sm, 6px);',
    '  background: transparent;',
    '  color: var(--dsw-alias-label-tertiary, #adb2b8);',
    '  font: inherit;',
    '  cursor: pointer;',
    '}',
    '',
    '.dsn-inline-action > svg {',
    '  width: 17px;',
    '  height: 17px;',
    '}',
    '',
    '.dsn-inline-action[data-done="1"] {',
    '  color: var(--dsw-alias-state-business-primary, #4176e6);',
    '}',
    '',
    '@media (hover: hover) {',
    '  .dsn-inline-action:hover {',
    '    background: var(--dsw-alias-interactive-bg-hover, rgba(11, 12, 15, 0.06));',
    '    color: var(--dsw-alias-label-secondary, #6b7280);',
    '  }',
    '}',
    '',
    '.dsn-inline-action:focus-visible {',
    '  outline: 2px solid var(--dsw-alias-border-l4, rgba(11, 12, 15, 0.18));',
    '  outline-offset: -1px;',
    '}',
  ].join('\n'))

  /* ------------------------- rendered reply -------------------------- */

  // Seats rendered by ui-chat: one per chat node, carrying the turn number and
  // the node kind. `turn-tail` is the seat that hosts our button.
  var SEAT_SELECTOR = '[data-chat-flow-kind="assistant-step"]'
  var HIDDEN_ATTR = 'data-turn-process-hidden'

  function queryAll(selector, root) {
    try {
      return (root || document).querySelectorAll(selector)
    } catch (error) {
      DSN.log('reply query failed', error)
      return []
    }
  }

  /** @param node - candidate seat. @returns whether it holds visible text. */
  function seatHasContent(node) {
    if (!node || node.getAttribute(HIDDEN_ATTR) != null) return false
    return String(node.textContent || '').replace(/\s+/g, '') !== ''
  }

  /**
   * Locate the rendered final assistant message for the turn that owns `anchor`.
   * @param anchor - element inside the same turn.
   * @returns the last visible assistant seat, or null.
   */
  DSN.replySeat = function replySeat(anchor) {
    if (!anchor || typeof anchor.closest !== 'function') return null
    var seat = anchor.closest('[data-chat-turn]')
    var turn = seat ? seat.getAttribute('data-chat-turn') : null
    var candidates = []
    if (turn != null && turn !== '') {
      candidates = queryAll('[data-chat-turn="' + String(turn).replace(/["\\]/g, '') + '"]' + SEAT_SELECTOR)
    }
    if (!candidates.length) {
      // Fallback: the flow that contains the clicked row.
      var flow = anchor.closest('[data-chat-flow]')
      if (flow) candidates = queryAll(SEAT_SELECTOR, flow)
    }
    for (var index = candidates.length - 1; index >= 0; index -= 1) {
      if (seatHasContent(candidates[index])) return candidates[index]
    }
    return null
  }

  // Chrome inside the transcript that carries no note content: copy toolbars,
  // our own controls, and the selection/drop layers.
  var PRUNE_SELECTOR = [
    'button',
    '[role="toolbar"]',
    '[data-dsn-reply-save]',
    '[data-dsn-chip-layer]',
    '.dsn-chip-layer',
    '.dsn-drop-layer',
    'svg',
  ].join(', ')

  /** @param root - cloned subtree. @returns the same node after pruning. */
  function pruneReply(root) {
    var doomed = queryAll(PRUNE_SELECTOR, root)
    for (var index = 0; index < doomed.length; index += 1) {
      var node = doomed[index]
      if (node && node.parentNode) node.parentNode.removeChild(node)
    }
    return root
  }

  /**
   * Read the rendered final reply of the turn that owns `anchor`.
   * @param anchor - element inside the turn.
   * @returns sanitized HTML, or an empty string.
   */
  DSN.replyHtml = function replyHtml(anchor) {
    var seat = DSN.replySeat(anchor)
    if (!seat) return ''
    var clone = null
    try {
      clone = seat.cloneNode(true)
    } catch (error) {
      DSN.log('reply clone failed', error)
      return ''
    }
    if (!clone) return ''
    var sanitized = DSN.sanitizeHtml(pruneReply(clone).innerHTML)
    return sanitized
  }

  /**
   * Store the rendered reply as a note.
   * @param options - store, translator, session resolver and the clicked element.
   * @returns whether a note was added.
   */
  DSN.saveReplyToNotes = function saveReplyToNotes(options) {
    var options_ = options || {}
    var store = options_.store || DSN.store
    var t = options_.t || DSN.t
    if (!store || typeof store.actions.addNote !== 'function') return false
    var html = DSN.replyHtml(options_.anchor)
    if (!html) return false
    var text = DSN.htmlToText(html)
    if (!text && html.indexOf('<img') < 0) return false
    var session = typeof options_.getSession === 'function' ? options_.getSession() : null
    var noteId = store.actions.addNote({
      html: html,
      text: text,
      kind: DSN.detectKind(html, text),
      source: session && session.sessionId ? { sessionId: session.sessionId, sessionTitle: session.sessionTitle || '' } : null,
    })
    return Boolean(noteId)
  }

  /* ------------------------- reply row button ------------------------ */

  /**
   * One action-row button that saves the reply it belongs to.
   * @param props - store, translator, session resolver.
   * @returns the row button.
   */
  DSN.ReplyActionButton = function ReplyActionButton(props) {
    var t = props.t || DSN.t
    var done = DSN.React.useState(false)
    var saved = done[0]
    var setSaved = done[1]
    var onClick = function (event) {
      try {
        event.preventDefault()
        event.stopPropagation()
      } catch (error) {
        DSN.log('reply button event failed', error)
      }
      var ok = DSN.saveReplyToNotes({
        store: props.store,
        t: t,
        getSession: props.getSession,
        anchor: event.currentTarget,
      })
      DSN.toast(t(ok ? 'inline.savedReply' : 'inline.failedReply'), ok ? 'info' : 'error')
      if (ok) setSaved(true)
    }
    return DSN.h('button', {
      type: 'button',
      className: 'dsn-inline-action',
      'aria-label': t('inline.saveReply'),
      title: t('inline.saveReply'),
      'data-dsn-reply-save': '1',
      'data-done': saved ? '1' : undefined,
      onClick: onClick,
    }, DSN.Icon({ name: 'note', size: 17 }))
  }

  /* -------------------------- image notes --------------------------- */

  // Notes keep their own copy of the bytes, so one image may not blow up the
  // storage document. Larger images fall back to their absolute URL.
  var IMAGE_NOTE_MAX = 6 * 1024 * 1024

  /** @param blob - image payload. @returns a promise for its data URL. */
  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var Reader = typeof FileReader === 'function' ? FileReader : null
      if (!Reader) {
        reject(new Error('no FileReader'))
        return
      }
      var reader = new Reader()
      reader.onerror = function () { reject(new Error('read failed')) }
      reader.onload = function () {
        var result = typeof reader.result === 'string' ? reader.result : ''
        if (result && result.toLowerCase().indexOf('data:image/') === 0) resolve(result)
        else reject(new Error('not an image'))
      }
      reader.readAsDataURL(blob)
    })
  }

  /**
   * Resolve a rendered image to a source the note sanitizer accepts: a data URL
   * (preferred, survives reloads) or an absolute https URL.
   * @param url - rendered image source.
   * @returns a promise for the stored source.
   */
  DSN.imageNoteSource = function imageNoteSource(url) {
    var value = typeof url === 'string' ? url : ''
    if (!value) return Promise.reject(new Error('missing url'))
    if (value.toLowerCase().indexOf('data:image/') === 0) return Promise.resolve(value)
    var fallback = value.toLowerCase().indexOf('https://') === 0 ? value : ''
    if (typeof fetch !== 'function') {
      return fallback ? Promise.resolve(fallback) : Promise.reject(new Error('no fetch'))
    }
    return Promise.resolve()
      .then(function () { return fetch(value, { credentials: 'include' }) })
      .then(function (response) {
        if (!response || !response.ok) throw new Error('image request failed with ' + (response ? response.status : 'no response'))
        return response.blob()
      })
      .then(function (blob) {
        if (!blob) throw new Error('no blob')
        var type = String(blob.type || '').toLowerCase()
        if (type && type.indexOf('image/') !== 0) throw new Error('not an image: ' + type)
        if (blob.size > IMAGE_NOTE_MAX) throw new Error('image too large: ' + blob.size)
        return blobToDataUrl(blob)
      })
      .then(null, function (error) {
        DSN.log('image capture failed', error)
        if (fallback) return fallback
        throw error
      })
  }

  /**
   * Store one rendered image as a note.
   * @param options - store, translator, session resolver and the menu target.
   * @returns a promise settling when the note exists.
   */
  DSN.saveImageNote = function saveImageNote(options) {
    var options_ = options || {}
    var store = options_.store || DSN.store
    var t = options_.t || DSN.t
    var target = options_.target || {}
    if (!store || typeof store.actions.addNote !== 'function') return Promise.reject(new Error('no store'))
    var name = typeof target.name === 'string' ? target.name : ''
    var alt = name || t('drop.image')
    return DSN.imageNoteSource(target.url).then(function (src) {
      var html = DSN.sanitizeHtml('<img src="' + DSN.escapeHtml(src) + '" alt="' + DSN.escapeHtml(alt) + '">')
      if (!html) throw new Error('image source rejected')
      var session = typeof options_.getSession === 'function' ? options_.getSession() : null
      var noteId = store.actions.addNote({
        html: html,
        text: alt,
        kind: 'image',
        source: session && session.sessionId ? { sessionId: session.sessionId, sessionTitle: session.sessionTitle || '' } : null,
      })
      if (!noteId) throw new Error('note not saved')
      DSN.toast(t('menu.savedImage'), 'info')
      return noteId
    })
  }

  /* --------------------------- registration ------------------------- */

  /** @param ctx - plugin context. @param name - slot name. @returns the service, or null. */
  function serviceOf(ctx, name) {
    try {
      if (ctx && typeof ctx.get === 'function') return ctx.get(name) || null
    } catch (error) {
      DSN.log('service lookup failed: ' + name, error)
    }
    return null
  }

  /**
   * Run `callback` once the named service exists. Cordis defers a described
   * dependency until it is provided, so the plugin keeps working on profiles
   * where the menu service is missing or arrives later.
   * @param ctx - plugin context.
   * @param name - service name.
   * @param callback - receives the service; its disposer is owned by the fiber.
   * @param fallback - whether to try a plain lookup when `ctx.inject` is absent.
   * @returns whether something was registered.
   */
  function withService(ctx, name, callback, fallback) {
    if (ctx && typeof ctx.inject === 'function') {
      try {
        var fiber = ctx.inject([name], function (scoped) {
          var service = (scoped && scoped[name]) || serviceOf(scoped, name) || serviceOf(ctx, name)
          return service ? callback(service) : null
        })
        if (fiber) return true
      } catch (error) {
        DSN.log('service inject failed: ' + name, error)
      }
    }
    if (!fallback) return false
    var direct = serviceOf(ctx, name)
    if (!direct) return false
    callback(direct)
    return true
  }

  /**
   * Contribute the reply-row button.
   * @param options - ctx, store, translator and session resolver.
   * @returns a disposer.
   */
  DSN.registerReplyAction = function registerReplyAction(options) {
    var options_ = options || {}
    var ctx = options_.ctx
    var store = options_.store
    var t = options_.t || DSN.t
    var getSession = options_.getSession
    return ctx.slots.inject('conversation.chat.assistant-actions', function () {
      return ctx.slots.register({
        name: 'conversation.chat.assistant-actions',
        id: 'dsh-sticky-board-reply',
        order: 50,
        locale: DSN.NS,
      }, function StickyNotesReplyAction(props) {
        return DSN.h(DSN.ReplyActionButton, {
          store: store,
          t: props.t || t,
          getSession: getSession,
        })
      })
    })
  }

  /**
   * Contribute the image context-menu action and the glyph it renders.
   * @param options - ctx, store, translator and session resolver.
   * @returns a disposer.
   */
  DSN.registerImageMenu = function registerImageMenu(options) {
    var options_ = options || {}
    var ctx = options_.ctx
    var store = options_.store
    var t = options_.t || DSN.t
    var getSession = options_.getSession
    var disposers = []
    try {
      disposers.push(ctx.slots.inject('contextMenu.icon', function () {
        return ctx.slots.register({ name: 'contextMenu.icon', key: 'dsh-sticky-board.note' }, function StickyNotesMenuIcon() {
          return DSN.Icon({ name: 'note', size: 16 })
        })
      }))
    } catch (error) {
      DSN.log('menu glyph registration failed', error)
    }
    // A profile may load this plugin before the menu service, so describe the
    // dependency instead of sampling it once at apply time; the child fiber
    // unloads with this plugin, so its disposer is not tracked here.
    var registered = false
    try {
      registered = withService(ctx, 'contextMenus', function (service) {
        return ctx.effect(function () {
          return service.register({
            id: 'dsh-sticky-board.image',
            target: 'image',
            order: 150,
            resolve: function (target) {
              return [{
                id: 'save-to-notes',
                label: t('menu.saveImage'),
                icon: { key: 'dsh-sticky-board.note' },
                failureLabel: t('menu.failedImage'),
                run: function () {
                  return DSN.saveImageNote({ store: store, t: t, getSession: getSession, target: target })
                },
              }]
            },
          })
        }, 'notes: image menu')
      }, true)
    } catch (error) {
      DSN.log('image menu registration failed', error)
    }
    if (!registered) DSN.log('image menu skipped: contextMenus service unavailable')
    return function () {
      for (var index = disposers.length - 1; index >= 0; index -= 1) {
        try {
          disposers[index]()
        } catch (error) {
          DSN.log('image menu dispose failed', error)
        }
      }
    }
  }
}())

/* ================= 90-apply.js ================= */
/* ------------------------------------------------------------------ *
 * The plugin entry point: owns the store instance, registers every
 * surface into its DSH slot, and tears all of it down again.
 * ------------------------------------------------------------------ */

/** Late-bound translate function: resolved once the locale binding exists. */
DSN.t = DSN.fallbackT

function dsnTranslate(key, params) {
  return DSN.t(key, params)
}

DSN.inject = ['slots', 'locale', 'uiConversation']

DSN.apply = function (ctx) {
  var disposers = []
  function track(disposer) {
    if (typeof disposer === 'function') disposers.push(disposer)
    return disposer
  }

  DSN.ctx = ctx
  var store = DSN.createStore({ t: dsnTranslate })
  DSN.store = store
  // Debug handle: inspect or drive the notes store from the browser devtools.
  try { window.__DSH_STICKY_BOARD__ = DSN } catch (error) { /* ignore */ }

  /* --------------------------- dictionaries -------------------------- */
  track(ctx.effect(function () {
    var offZh = null
    var offEn = null
    try { offZh = ctx.locale.register(DSN.NS, 'zh', DSN.dicts.zh) } catch (error) {
      DSN.log('zh dictionary registration failed', error)
    }
    try { offEn = ctx.locale.register(DSN.NS, 'en', DSN.dicts.en) } catch (error) {
      DSN.log('en dictionary registration failed', error)
    }
    try { DSN.t = ctx.locale.bind(DSN.NS) } catch (error) { DSN.log('locale bind failed', error) }
    return function () {
      if (typeof offZh === 'function') offZh()
      if (typeof offEn === 'function') offEn()
      DSN.t = DSN.fallbackT
    }
  }, 'dsh-sticky-board: dictionaries'))

  /* ------------------------------- styles ---------------------------- */
  track(ctx.effect(function () {
    return DSN.injectStyle(document, DSN.cssText())
  }, 'dsh-sticky-board: styles'))

  /* --------------------------- floating panel ------------------------ */
  // First run: surface the panel once so the feature is discoverable, then let
  // the user close it. Subsequent launches keep whatever they left behind.
  try {
    if (store.getSnapshot().ui.seen !== true) store.actions.setOpen(true)
  } catch (error) {
    DSN.log('first-run open failed', error)
  }

  track(ctx.slots.inject('shell.overlay', function () {
    return ctx.slots.register(
      { name: 'shell.overlay', id: 'dsh-sticky-board-panel', locale: DSN.NS },
      function StickyNotesPanelSlot(props) {
        if (typeof DSN.Panel !== 'function') return null
        return DSN.h(DSN.Panel, {
          store: store,
          t: props.t || DSN.t,
          ctx: ctx,
          embedded: false,
        })
      },
    )
  }))

  /* ------------------------------ toasts ----------------------------- */
  track(ctx.slots.inject('shell.overlay', function () {
    return ctx.slots.register(
      { name: 'shell.overlay', id: 'dsh-sticky-board-toasts', locale: DSN.NS },
      function StickyNotesToastSlot(props) {
        if (typeof DSN.ToastHost !== 'function') return null
        return DSN.h(DSN.ToastHost, { t: props.t || DSN.t })
      },
    )
  }))

  /* ------------------------ detached windows ------------------------- */
  // Notes dragged out of the panel onto the transcript live here: each one is
  // its own window, above the chat but below the panel, so several can be
  // arranged side by side.
  track(ctx.slots.inject('shell.overlay', function () {
    return ctx.slots.register(
      { name: 'shell.overlay', id: 'dsh-sticky-board-floaters', locale: DSN.NS },
      function StickyNotesFloaterSlot(props) {
        if (typeof DSN.FloaterLayer !== 'function') return null
        return DSN.h(DSN.FloaterLayer, { store: store, t: props.t || DSN.t })
      },
    )
  }))

  /* ------------------- durable storage (Host file) ------------------- */
  // localStorage stays the synchronous copy; this mirrors the board to the
  // profile-owned JSON document served by the Host half.
  if (typeof DSN.installSync === 'function') {
    track(DSN.installSync({ store: store, t: dsnTranslate }))
  }

  /* --------------------- session header launcher --------------------- */
  // The entrance lives in the Session header's right-aligned utilities row,
  // leftmost of every plugin/host button there (order -20).
  if (typeof DSN.registerHeaderLauncher === 'function') {
    track(DSN.registerHeaderLauncher({ ctx: ctx, store: store, t: dsnTranslate }))
  }

  /* ------------------- composer bridge (insert target) --------------- */
  if (typeof DSN.installComposerBridge === 'function') {
    track(DSN.installComposerBridge({ ctx: ctx, store: store, t: dsnTranslate }))
  }

  /* --------------------- selection capture + chords ------------------ */
  if (typeof DSN.installCapture === 'function') {
    track(DSN.installCapture({
      ctx: ctx,
      store: store,
      t: dsnTranslate,
      getSession: function () {
        var info = DSN.bridge && typeof DSN.bridge.get === 'function' ? DSN.bridge.get() : null
        if (!info) return null
        return { sessionId: info.sessionId || null, sessionTitle: info.sessionTitle || '' }
      },
    }))
  }

  /* --------------- drag a note card onto the composer ---------------- */
  if (typeof DSN.installNoteDrop === 'function') {
    track(DSN.installNoteDrop({ store: store, t: dsnTranslate }))
  }

  /* --------------- reply row + image context menu -------------------- */
  // Both read the rendered transcript, so they share one resolver for the
  // Session that the composer bridge currently addresses.
  function sessionInfo() {
    var info = DSN.bridge && typeof DSN.bridge.get === 'function' ? DSN.bridge.get() : null
    return info ? { sessionId: info.sessionId || null, sessionTitle: info.sessionTitle || '' } : null
  }
  if (typeof DSN.registerReplyAction === 'function') {
    track(DSN.registerReplyAction({ ctx: ctx, store: store, t: dsnTranslate, getSession: sessionInfo }))
  }
  if (typeof DSN.registerImageMenu === 'function') {
    track(DSN.registerImageMenu({ ctx: ctx, store: store, t: dsnTranslate, getSession: sessionInfo }))
  }

  /* ------------------ selection / context-menu surface ---------------- */
  if (typeof DSN.CaptureAction === 'function' && ctx.slots.inject) {
    function StickyNotesCaptureSlot(props) {
      if (typeof DSN.CaptureAction !== 'function') return null
      return DSN.h(DSN.CaptureAction, {
        dismiss: props.dismiss,
        readText: props.readText,
        clearSelection: props.clearSelection,
        sessionId: props.sessionId,
        inputActions: props.inputActions,
        useSession: props.useSession,
        store: store,
        t: props.t || DSN.t,
        getSession: function () {
          var info = DSN.bridge && typeof DSN.bridge.get === 'function' ? DSN.bridge.get() : null
          return info ? { sessionId: info.sessionId || null, sessionTitle: info.sessionTitle || '' } : null
        },
      })
    }
    track(ctx.slots.inject('conversation.chat.text-interaction', function () {
      var disposers = []
      // The built-in quote definition is registered first, so it wins the
      // selection gesture and the flow renders the surface keyed by its id
      // (`quote`). Cell shadowing resolves by ascending priority and the lowest
      // rank renders, so a negative priority puts our two-action menu (引用文本 +
      // 存便签) in that cell instead of the quote-only button.
      disposers.push(ctx.slots.register(
        { name: 'conversation.chat.text-interaction', key: 'quote', locale: DSN.NS, priority: -10 },
        StickyNotesCaptureSlot,
      ))
      // Our own definition owns the context-menu gesture, and the selection
      // gesture whenever the built-in one is not mounted.
      disposers.push(ctx.slots.register(
        { name: 'conversation.chat.text-interaction', key: 'dsh-sticky-board', locale: DSN.NS },
        StickyNotesCaptureSlot,
      ))
      return function () {
        for (var i = disposers.length - 1; i >= 0; i -= 1) {
          try {
            disposers[i]()
          } catch (error) {
            DSN.log('capture slot dispose failed', error)
          }
        }
      }
    }))
  }

  /* ------------------------- better-sidebar tab ---------------------- */
  if (typeof DSN.registerBetterSidebarTab === 'function') {
    try {
      track(DSN.registerBetterSidebarTab({ ctx: ctx, store: store, t: dsnTranslate }))
    } catch (error) {
      DSN.log('better-sidebar tab registration failed', error)
    }
  }

  /* ------------------------------ lifecycle -------------------------- */
  track(DSN.on(window, 'pagehide', function () { store.flush() }))
  track(function () {
    if (typeof DSN.closePip === 'function') {
      try { DSN.closePip() } catch (error) { DSN.log('pip close failed', error) }
    }
  })

  DSN.log('applied', DSN.VERSION)

  return function dispose() {
    while (disposers.length > 0) {
      var disposer = disposers.pop()
      try { disposer() } catch (error) { DSN.log('disposer failed', error) }
    }
    try { store.flush() } catch (error) { /* ignore */ }
    try { store.dispose() } catch (error) { /* ignore */ }
    DSN.store = null
    DSN.ctx = null
  }
}

/* ================= 95-tail.js ================= */
    exports.name = 'dsh-sticky-board'
    exports.apply = DSN.apply
    exports.inject = DSN.inject
    DSN.log('module registered', DSN.VERSION)
    return module.exports
  },
})
//# sourceURL=dsh-sticky-board/client.js
