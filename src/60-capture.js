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
    return { text: text, html: html, rect: rect }
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
      var noteId = store.actions.addNote({ html: html, text: text, source: source || null })
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
