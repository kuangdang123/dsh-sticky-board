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
