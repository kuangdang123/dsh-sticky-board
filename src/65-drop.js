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
