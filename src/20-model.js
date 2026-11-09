/* ------------------------------------------------------------------ *
 * The notes document: state shape, pure mutations, localStorage
 * persistence, and cross-window synchronization (a picture-in-picture
 * window is a second document of the same browser tab, so it shares this
 * store instance directly; other tabs get BroadcastChannel messages).
 * ------------------------------------------------------------------ */

DSN.STORAGE_KEY = 'dsh-notes/v1'
DSN.CHANNEL_NAME = '@@DSN_STORE_KEY@@'
DSN.MAX_NOTES = 800
DSN.MAX_HTML = 600000
/** Detached note windows: how many may float at once, and their size bounds. */
DSN.MAX_FLOATERS = 8
DSN.FLOAT_W = 360
DSN.FLOAT_H = 300
DSN.FLOAT_MIN_W = 220
DSN.FLOAT_MIN_H = 110
DSN.FLOAT_MAX_W = 1100
DSN.FLOAT_MAX_H = 2000

DSN.emptyState = function (t) {
  var translate = typeof t === 'function' ? t : DSN.fallbackT
  var inboxId = 'sec-inbox'
  return {
    version: 1,
    sections: [{ id: inboxId, name: translate('section.inbox'), order: 0 }],
    notes: [],
    ui: {
      open: false,
      collapsed: false,
      panel: null,
      activeSectionId: inboxId,
      view: 'board',
      search: '',
      seen: false,
      floaters: [],
    },
  }
}

DSN.normalizeState = function (raw, t) {
  var base = DSN.emptyState(t)
  if (!raw || typeof raw !== 'object') return base
  var sections = Array.isArray(raw.sections) ? raw.sections.filter(function (item) {
    return item && typeof item.id === 'string' && item.id
  }).map(function (item, index) {
    return {
      id: item.id,
      name: typeof item.name === 'string' ? item.name : base.sections[0].name,
      order: typeof item.order === 'number' ? item.order : index,
    }
  }) : []
  if (sections.length === 0) sections = base.sections
  sections.sort(function (a, b) { return a.order - b.order })

  var knownSections = new Set(sections.map(function (item) { return item.id }))
  var notes = Array.isArray(raw.notes) ? raw.notes.filter(function (item) {
    return item && typeof item.id === 'string'
  }).map(function (item) {
    return {
      id: item.id,
      sectionId: knownSections.has(item.sectionId) ? item.sectionId : sections[0].id,
      html: typeof item.html === 'string' ? item.html : '',
      text: typeof item.text === 'string' ? item.text : '',
      title: typeof item.title === 'string' ? item.title : '',
      kind: typeof item.kind === 'string' ? item.kind : 'text',
      source: item.source && typeof item.source === 'object'
        ? { sessionId: item.source.sessionId || null, sessionTitle: item.source.sessionTitle || '' }
        : null,
      createdAt: Number(item.createdAt) || Date.now(),
      updatedAt: Number(item.updatedAt) || Number(item.createdAt) || Date.now(),
      pinned: item.pinned === true,
      deletedAt: Number(item.deletedAt) || null,
    }
  }) : []

  var ui = Object.assign({}, base.ui, raw.ui && typeof raw.ui === 'object' ? raw.ui : {})
  if (!knownSections.has(ui.activeSectionId)) ui.activeSectionId = sections[0].id
  if (ui.view !== 'trash') ui.view = 'board'
  var panel = ui.panel
  ui.panel = panel && typeof panel === 'object'
    && isFinite(panel.x) && isFinite(panel.y) && isFinite(panel.w) && isFinite(panel.h)
    ? { x: Number(panel.x), y: Number(panel.y), w: Number(panel.w), h: Number(panel.h) }
    : null
  ui.search = typeof ui.search === 'string' ? ui.search : ''
  ui.seen = ui.seen === true
  ui.floaters = DSN.normalizeFloaters(ui.floaters)
  return { version: 1, sections: sections, notes: notes, ui: ui }
}

/** Keep only well-formed detached windows: one per note, clamped geometry. */
DSN.normalizeFloaters = function (raw) {
  var list = Array.isArray(raw) ? raw : []
  var seen = {}
  var out = []
  for (var i = 0; i < list.length; i += 1) {
    var item = list[i]
    if (!item || typeof item.noteId !== 'string' || !item.noteId) continue
    if (seen[item.noteId]) continue
    if (!isFinite(item.x) || !isFinite(item.y)) continue
    seen[item.noteId] = true
    out.push({
      noteId: item.noteId,
      x: Math.round(Number(item.x)),
      y: Math.round(Number(item.y)),
      w: DSN.clamp(Math.round(Number(item.w)) || DSN.FLOAT_W, DSN.FLOAT_MIN_W, DSN.FLOAT_MAX_W),
      h: DSN.clamp(Math.round(Number(item.h)) || DSN.FLOAT_H, DSN.FLOAT_MIN_H, DSN.FLOAT_MAX_H),
      z: Math.round(Number(item.z)) || 1,
      collapsed: item.collapsed === true,
    })
    if (out.length >= DSN.MAX_FLOATERS) break
  }
  return out
}

/**
 * Create the notes store.
 * @param {{ t?: Function, storage?: Storage|null, key?: string }} options
 */
DSN.createStore = function (options) {
  var config = options || {}
  var t = typeof config.t === 'function' ? config.t : DSN.fallbackT
  var key = config.key || DSN.STORAGE_KEY
  var storage = config.storage === undefined
    ? (function () { try { return window.localStorage } catch (error) { return null } })()
    : config.storage

  var listeners = new Set()
  var state = null
  var saveTimer = null
  var lastWrite = 0
  var channel = null
  var disposed = false

  function notify() {
    listeners.forEach(function (fn) {
      try { fn(state) } catch (error) { DSN.log('store listener failed', error) }
    })
  }

  function readStored() {
    if (!storage) return null
    try {
      var raw = storage.getItem(key)
      if (!raw) return null
      return DSN.normalizeState(JSON.parse(raw), t)
    } catch (error) {
      DSN.log('stored notes unreadable', error)
      return null
    }
  }

  function writeStored() {
    if (!storage) return false
    try {
      storage.setItem(key, JSON.stringify(state))
      lastWrite = Date.now()
      return true
    } catch (error) {
      DSN.log('stored notes write failed', error)
      DSN.toast(t('status.storageFull'), 'error')
      return false
    }
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(function () { saveTimer = null; writeStored() }, 250)
  }

  function scheduleBroadcast() {
    if (!channel) return
    try { channel.postMessage({ type: 'state', at: Date.now(), state: state }) } catch (error) {
      DSN.log('broadcast failed', error)
    }
  }

  function commit(next, options) {
    if (disposed) return
    if (!next || next === state) return
    state = next
    notify()
    var flags = options || {}
    if (flags.persist !== false) scheduleSave()
    if (flags.broadcast !== false) scheduleBroadcast()
  }

  function update(mutator) {
    var next = mutator(state)
    if (next !== state) commit(next)
    return next
  }

  function withNotes(mapFn) {
    return update(function (current) {
      return Object.assign({}, current, { notes: current.notes.map(mapFn) })
    })
  }

  /* ------------------------------ actions ---------------------------- */

  var actions = {
    setOpen: function (open) {
      update(function (current) {
        return Object.assign({}, current, { ui: Object.assign({}, current.ui, { open: open === true, seen: true }) })
      })
    },
    toggleOpen: function () {
      update(function (current) {
        return Object.assign({}, current, { ui: Object.assign({}, current.ui, { open: !current.ui.open, seen: true }) })
      })
    },
    setCollapsed: function (collapsed) {
      update(function (current) {
        return Object.assign({}, current, { ui: Object.assign({}, current.ui, { collapsed: collapsed === true }) })
      })
    },
    setPanelRect: function (rect) {
      update(function (current) {
        return Object.assign({}, current, {
          ui: Object.assign({}, current.ui, {
            panel: rect
              ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) }
              : null,
          }),
        })
      })
    },
    setActiveSection: function (sectionId) {
      update(function (current) {
        return Object.assign({}, current, {
          ui: Object.assign({}, current.ui, { activeSectionId: sectionId, view: 'board' }),
        })
      })
    },
    setView: function (view) {
      update(function (current) {
        return Object.assign({}, current, { ui: Object.assign({}, current.ui, { view: view === 'trash' ? 'trash' : 'board' }) })
      })
    },
    setSearch: function (query) {
      update(function (current) {
        return Object.assign({}, current, { ui: Object.assign({}, current.ui, { search: String(query || '') }) })
      })
    },
    /* -------------------- detached note windows ---------------------- */
    /** Open a floating window for `noteId` (or raise it when already open). */
    addFloater: function (noteId, rect) {
      var id = String(noteId || '')
      if (!id) return null
      update(function (current) {
        var floaters = current.ui.floaters || []
        var topZ = 1
        for (var i = 0; i < floaters.length; i += 1) topZ = Math.max(topZ, floaters[i].z || 1)
        var existing = -1
        for (var j = 0; j < floaters.length; j += 1) if (floaters[j].noteId === id) existing = j
        if (existing >= 0) {
          return Object.assign({}, current, {
            ui: Object.assign({}, current.ui, {
              floaters: floaters.map(function (item) {
                return item.noteId === id ? Object.assign({}, item, { z: topZ + 1, collapsed: false }) : item
              }),
            }),
          })
        }
        var next = floaters.slice()
        if (next.length >= DSN.MAX_FLOATERS) {
          var lowest = 0
          for (var k = 1; k < next.length; k += 1) if ((next[k].z || 1) < (next[lowest].z || 1)) lowest = k
          next.splice(lowest, 1)
        }
        var box = rect || {}
        next.push({
          noteId: id,
          x: Math.round(Number(box.x) || 0),
          y: Math.round(Number(box.y) || 0),
          w: DSN.clamp(Math.round(Number(box.w)) || DSN.FLOAT_W, DSN.FLOAT_MIN_W, DSN.FLOAT_MAX_W),
          h: DSN.clamp(Math.round(Number(box.h)) || DSN.FLOAT_H, DSN.FLOAT_MIN_H, DSN.FLOAT_MAX_H),
          z: topZ + 1,
          collapsed: false,
        })
        return Object.assign({}, current, { ui: Object.assign({}, current.ui, { floaters: next }) })
      })
      return id
    },
    moveFloater: function (noteId, x, y) {
      update(function (current) {
        return Object.assign({}, current, {
          ui: Object.assign({}, current.ui, {
            floaters: (current.ui.floaters || []).map(function (item) {
              return item.noteId === noteId
                ? Object.assign({}, item, { x: Math.round(Number(x) || 0), y: Math.round(Number(y) || 0) })
                : item
            }),
          }),
        })
      })
    },
    resizeFloater: function (noteId, w, h) {
      update(function (current) {
        return Object.assign({}, current, {
          ui: Object.assign({}, current.ui, {
            floaters: (current.ui.floaters || []).map(function (item) {
              return item.noteId === noteId
                ? Object.assign({}, item, {
                  w: DSN.clamp(Math.round(Number(w)) || DSN.FLOAT_W, DSN.FLOAT_MIN_W, DSN.FLOAT_MAX_W),
                  h: DSN.clamp(Math.round(Number(h)) || DSN.FLOAT_H, DSN.FLOAT_MIN_H, DSN.FLOAT_MAX_H),
                })
                : item
            }),
          }),
        })
      })
    },
    raiseFloater: function (noteId) {
      update(function (current) {
        var floaters = current.ui.floaters || []
        var topZ = 0
        for (var i = 0; i < floaters.length; i += 1) topZ = Math.max(topZ, floaters[i].z || 1)
        var currentEntry = null
        for (var j = 0; j < floaters.length; j += 1) if (floaters[j].noteId === noteId) currentEntry = floaters[j]
        if (!currentEntry || currentEntry.z === topZ) return current
        return Object.assign({}, current, {
          ui: Object.assign({}, current.ui, {
            floaters: floaters.map(function (item) {
              return item.noteId === noteId ? Object.assign({}, item, { z: topZ + 1 }) : item
            }),
          }),
        })
      })
    },
    removeFloater: function (noteId) {
      update(function (current) {
        var floaters = current.ui.floaters || []
        if (!floaters.some(function (item) { return item.noteId === noteId })) return current
        return Object.assign({}, current, {
          ui: Object.assign({}, current.ui, {
            floaters: floaters.filter(function (item) { return item.noteId !== noteId }),
          }),
        })
      })
    },
    setFloaterCollapsed: function (noteId, collapsed) {
      update(function (current) {
        return Object.assign({}, current, {
          ui: Object.assign({}, current.ui, {
            floaters: (current.ui.floaters || []).map(function (item) {
              return item.noteId === noteId ? Object.assign({}, item, { collapsed: collapsed === true }) : item
            }),
          }),
        })
      })
    },
    closeAllFloaters: function () {
      update(function (current) {
        if (!(current.ui.floaters || []).length) return current
        return Object.assign({}, current, { ui: Object.assign({}, current.ui, { floaters: [] }) })
      })
    },
    addNote: function (payload) {
      var input = payload || {}
      var sectionId = input.sectionId || state.ui.activeSectionId || state.sections[0].id
      if (!state.sections.some(function (item) { return item.id === sectionId })) sectionId = state.sections[0].id
      var now = Date.now()
      var html = String(input.html || '')
      if (html.length > DSN.MAX_HTML) html = html.slice(0, DSN.MAX_HTML)
      var text = String(input.text || '')
      var note = {
        id: input.id || DSN.uid('note'),
        sectionId: sectionId,
        html: html,
        text: text || DSN.htmlToText(html),
        title: String(input.title || ''),
        kind: input.kind || DSN.detectKind(html, text),
        source: input.source || null,
        createdAt: now,
        updatedAt: now,
        pinned: input.pinned === true,
        deletedAt: null,
      }
      var notes = state.notes.slice()
      if (notes.length >= DSN.MAX_NOTES) {
        var oldest = null
        for (var i = notes.length - 1; i >= 0; i--) {
          if (notes[i].deletedAt) { oldest = i; break }
        }
        if (oldest === null) oldest = notes.length - 1
        notes.splice(oldest, 1)
      }
      notes.unshift(note)
      commit(Object.assign({}, state, { notes: notes }))
      return note.id
    },
    updateNote: function (noteId, patch) {
      var input = patch || {}
      withNotes(function (note) {
        if (note.id !== noteId) return note
        var next = Object.assign({}, note, input, { updatedAt: Date.now() })
        if (typeof input.html === 'string') {
          next.html = input.html.slice(0, DSN.MAX_HTML)
          if (input.text === undefined) next.text = DSN.htmlToText(next.html)
        }
        if (input.text !== undefined) next.text = String(input.text)
        return next
      })
    },
    deleteNote: function (noteId) {
      // Deleting closes the detached window first — a floating window must never
      // outlive (or show) a note that moved to the trash.
      update(function (current) {
        return Object.assign({}, current, {
          notes: current.notes.map(function (note) {
            return note.id === noteId ? Object.assign({}, note, { deletedAt: Date.now(), pinned: false }) : note
          }),
          ui: Object.assign({}, current.ui, {
            floaters: (current.ui.floaters || []).filter(function (item) { return item.noteId !== noteId }),
          }),
        })
      })
    },
    restoreNote: function (noteId) {
      withNotes(function (note) {
        if (note.id !== noteId) return note
        return Object.assign({}, note, { deletedAt: null })
      })
    },
    purgeNote: function (noteId) {
      update(function (current) {
        return Object.assign({}, current, {
          notes: current.notes.filter(function (note) { return note.id !== noteId }),
          ui: Object.assign({}, current.ui, {
            floaters: (current.ui.floaters || []).filter(function (item) { return item.noteId !== noteId }),
          }),
        })
      })
    },
    emptyTrash: function () {
      update(function (current) {
        var keep = current.notes.filter(function (note) { return !note.deletedAt })
        var alive = {}
        for (var i = 0; i < keep.length; i += 1) alive[keep[i].id] = true
        return Object.assign({}, current, {
          notes: keep,
          ui: Object.assign({}, current.ui, {
            floaters: (current.ui.floaters || []).filter(function (item) { return alive[item.noteId] }),
          }),
        })
      })
    },
    setPinned: function (noteId, pinned) {
      withNotes(function (note) {
        if (note.id !== noteId) return note
        return Object.assign({}, note, { pinned: pinned === true })
      })
    },
    togglePin: function (noteId) {
      withNotes(function (note) {
        if (note.id !== noteId) return note
        return Object.assign({}, note, { pinned: !note.pinned })
      })
    },
    /** Move a note into `sectionId`, placing it before `beforeId` when given. */
    moveNote: function (noteId, sectionId, beforeId) {
      update(function (current) {
        var index = current.notes.findIndex(function (note) { return note.id === noteId })
        if (index < 0) return current
        var target = current.sections.some(function (item) { return item.id === sectionId })
          ? sectionId
          : current.notes[index].sectionId
        var notes = current.notes.slice()
        var moved = Object.assign({}, notes[index], {
          sectionId: target,
          pinned: beforeId === null ? notes[index].pinned : notes[index].pinned,
          updatedAt: Date.now(),
        })
        notes.splice(index, 1)
        var insertAt = beforeId ? notes.findIndex(function (note) { return note.id === beforeId }) : -1
        if (insertAt < 0) {
          var lastInSection = -1
          for (var i = 0; i < notes.length; i++) if (notes[i].sectionId === target) lastInSection = i
          insertAt = lastInSection + 1 || 0
          if (insertAt === 0) {
            // empty target section: insert after the last note of the preceding sections
            insertAt = 0
          }
        }
        notes.splice(insertAt, 0, moved)
        return Object.assign({}, current, { notes: notes })
      })
    },
    addSection: function (name) {
      var id = DSN.uid('sec')
      update(function (current) {
        var order = current.sections.reduce(function (max, item) { return Math.max(max, item.order + 1) }, 0)
        return Object.assign({}, current, {
          sections: current.sections.concat([{
            id: id,
            name: String(name || '').trim() || t('section.inbox'),
            order: order,
          }]),
          ui: Object.assign({}, current.ui, { activeSectionId: id, view: 'board' }),
        })
      })
      return id
    },
    renameSection: function (sectionId, name) {
      update(function (current) {
        return Object.assign({}, current, {
          sections: current.sections.map(function (item) {
            return item.id === sectionId ? Object.assign({}, item, { name: String(name || '').trim() || item.name }) : item
          }),
        })
      })
    },
    deleteSection: function (sectionId) {
      update(function (current) {
        if (current.sections.length <= 1) return current
        var sections = current.sections.filter(function (item) { return item.id !== sectionId })
        var fallback = sections[0].id
        return Object.assign({}, current, {
          sections: sections,
          notes: current.notes.map(function (note) {
            return note.sectionId === sectionId ? Object.assign({}, note, { sectionId: fallback }) : note
          }),
          ui: Object.assign({}, current.ui, {
            activeSectionId: current.ui.activeSectionId === sectionId ? fallback : current.ui.activeSectionId,
          }),
        })
      })
    },
    importState: function (raw) {
      var next = DSN.normalizeState(raw, t)
      commit(next)
      return next
    },
    replaceState: function (raw) {
      commit(DSN.normalizeState(raw, t))
    },
  }

  /* --------------------------- init and sync ------------------------- */

  state = readStored() || DSN.emptyState(t)

  try {
    if (typeof window !== 'undefined' && typeof window.BroadcastChannel === 'function') {
      channel = new window.BroadcastChannel(DSN.CHANNEL_NAME)
      channel.onmessage = function (event) {
        var data = event && event.data
        if (!data || data.type !== 'state' || !data.state) return
        if (data.origin === DSN.storeId) return
        // Last writer wins; adopting never echoes back.
        state = DSN.normalizeState(data.state, t)
        notify()
      }
    }
  } catch (error) {
    DSN.log('BroadcastChannel unavailable', error)
    channel = null
  }

  // A second tab may also write localStorage without a channel delivery.
  var onStorage = function (event) {
    if (!event || event.key !== key || !event.newValue) return
    try {
      state = DSN.normalizeState(JSON.parse(event.newValue), t)
      notify()
    } catch (error) { DSN.log('storage event unreadable', error) }
  }
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)

  var wrappedActions = {}
  // High-frequency, purely local geometry: persisted, but not broadcast (other
  // windows keep their own copy until the next meaningful change).
  var QUIET = { setSearch: 1, setPanelRect: 1, moveFloater: 1, resizeFloater: 1, raiseFloater: 1 }
  Object.keys(actions).forEach(function (name) {
    wrappedActions[name] = function () {
      var result = actions[name].apply(null, arguments)
      if (channel && !QUIET[name]) {
        try { channel.postMessage({ type: 'state', origin: DSN.storeId, state: state }) } catch (error) { /* ignore */ }
      }
      return result
    }
  })

  return {
    getSnapshot: function () { return state },
    subscribe: function (fn) {
      listeners.add(fn)
      return function () { listeners.delete(fn) }
    },
    actions: wrappedActions,
    flush: function () {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
      return writeStored()
    },
    getLastWrite: function () { return lastWrite },
    dispose: function () {
      disposed = true
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = null
      listeners.clear()
      if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
      if (channel) {
        try { channel.close() } catch (error) { /* ignore */ }
        channel = null
      }
    },
  }
}

DSN.storeId = DSN.uid('store')
