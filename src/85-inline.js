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