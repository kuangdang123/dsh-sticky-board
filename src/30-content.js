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
