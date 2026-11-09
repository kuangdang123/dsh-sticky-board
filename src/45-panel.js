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
