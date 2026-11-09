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
