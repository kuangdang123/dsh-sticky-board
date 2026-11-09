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
