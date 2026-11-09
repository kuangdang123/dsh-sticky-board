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
