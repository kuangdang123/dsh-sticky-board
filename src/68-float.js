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
