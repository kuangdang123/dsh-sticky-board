/* ================================================================== *
 * 50-board.js — the notes panel body.
 *
 * Vertical order (see CONTRACT.md): toolbar (view tabs + search + add
 * section), section rail, composer, note stream, footer.
 *
 * Markup deliberately reuses the shared `.dsn-*` vocabulary defined by
 * 40-styles.js (`.dsn-app`, `.dsn-toolbar`, `.dsn-tabs`, `.dsn-search`,
 * `.dsn-sections`, `.dsn-section-chip`, `.dsn-composer`, `.dsn-stream`,
 * `.dsn-note`, `.dsn-note-clamp`, `.dsn-dropzone`, `.dsn-empty`, `.dsn-menu`,
 * `.dsn-iconbtn`, `.dsn-btn`, `.dsn-input`, `.dsn-footer`, ...) so the board
 * matches the panel shell and the PiP window. This fragment only registers
 * the few board-specific rules those classes do not cover.
 *
 * Rendering always comes from `useSyncExternalStore(store.subscribe,
 * store.getSnapshot)`; the snapshot is never copied into component
 * state. Only ephemeral UI state (drafts, menus, drag hover, expanded
 * cards) lives in local `useState`.
 *
 * Depends on (documented external fragments, written in parallel):
 *   DSN.Content, DSN.Editor, DSN.sanitizeHtml, DSN.readDragContent,
 *   DSN.dragHasContent, DSN.useStore (local fallback below), DSN.bridge.
 * ================================================================== */

DSN.addStrings({
  'board.expandNote': '展开全文',
  'board.collapseNote': '收起',
  'board.editPlaceholder': '编辑这条便签…',
  'board.noResults': '没有匹配的便签',
  'board.more': '更多操作',
  'board.confirm': '确定',
  'board.moved': '已移动到「{name}」',
}, {
  'board.expandNote': 'Show more',
  'board.collapseNote': 'Show less',
  'board.editPlaceholder': 'Edit this note…',
  'board.noResults': 'No matching notes',
  'board.more': 'More actions',
  'board.confirm': 'Confirm',
  'board.moved': 'Moved to "{name}"',
})

/* ------------------------------------------------------------------ *
 * constants and small helpers
 * ------------------------------------------------------------------ */

var BOARD_NOTE_MIME = 'application/x-dsn-note'

/* A drag payload is copied by the browser for every drop target it visits, so a
 * note holding inline base64 images must not be handed over verbatim. Keep the
 * rich payload under a small budget: first drop the inline sources, then the
 * images themselves, and as a last resort fall back to plain text. */
var BOARD_DRAG_HTML_BUDGET = 64 * 1024
var BOARD_DRAG_TEXT_LIMIT = 2000

function boardDragHtml(note) {
  var html = note.html || DSN.textToHtml(note.text || '')
  if (!html) return ''
  if (html.length <= BOARD_DRAG_HTML_BUDGET) return html
  var slim = html.replace(/(<img\b[^>]*?)\ssrc\s*=\s*("|')data:[\s\S]*?\2/gi, '$1')
  if (slim.length <= BOARD_DRAG_HTML_BUDGET) return slim
  slim = slim.replace(/<img\b[^>]*>/gi, '')
  if (slim.length <= BOARD_DRAG_HTML_BUDGET) return slim
  var text = String(note.text || '').slice(0, BOARD_DRAG_TEXT_LIMIT)
  return DSN.textToHtml(text)
}

var BOARD_KIND_ICONS = {
  text: 'note',
  table: 'table',
  image: 'image',
  code: 'sections',
  mixed: 'sections',
  link: 'float',
}

function boardTranslate(t) {
  return typeof t === 'function' ? t : DSN.fallbackT
}

function boardHasType(dataTransfer, type) {
  var types = dataTransfer && dataTransfer.types
  if (!types) return false
  for (var i = 0; i < types.length; i++) {
    if (types[i] === type) return true
  }
  return false
}

/** A card drag produced by this plugin (see the shared drag protocol). */
function boardIsNoteDrag(dataTransfer) {
  return boardHasType(dataTransfer, BOARD_NOTE_MIME)
}

/** Content dragged in from outside the panel (files, text, html). */
function boardIsExternalDrag(dataTransfer) {
  if (!dataTransfer) return false
  if (boardIsNoteDrag(dataTransfer)) return false
  if (typeof DSN.dragHasContent === 'function') {
    try {
      if (DSN.dragHasContent(dataTransfer)) return true
    } catch (error) {
      DSN.log('dragHasContent failed', error)
    }
  }
  return boardHasType(dataTransfer, 'Files') ||
    boardHasType(dataTransfer, 'text/html') ||
    boardHasType(dataTransfer, 'text/plain')
}

function boardReadNoteId(dataTransfer) {
  if (!dataTransfer) return ''
  try {
    return String(dataTransfer.getData(BOARD_NOTE_MIME) || '')
  } catch (error) {
    return ''
  }
}

/** Plain text of an HTML fragment (30-content provides htmlToText). */
function boardHtmlText(html) {
  if (typeof DSN.htmlToText === 'function') {
    try {
      return String(DSN.htmlToText(html) || '')
    } catch (error) {
      DSN.log('htmlToText failed', error)
    }
  }
  return String(html == null ? '' : html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function boardTextToHtml(text) {
  if (typeof DSN.textToHtml === 'function') {
    try {
      return String(DSN.textToHtml(String(text == null ? '' : text)) || '')
    } catch (error) {
      DSN.log('textToHtml failed', error)
    }
  }
  return DSN.escapeHtml(text).replace(/\r?\n/g, '<br>')
}

function boardIsEmptyHtml(html) {
  if (!html) return true
  if (boardHtmlText(html).replace(/\s+/g, '') !== '') return false
  return !/<(img|table|pre|blockquote|ul|ol)\b/i.test(String(html))
}

/** Case-insensitive match over the note title and text. */
function boardMatchesQuery(note, query) {
  if (!query) return true
  if (!note) return false
  var needle = String(query).toLowerCase()
  var title = String(note.title || '').toLowerCase()
  var text = String(note.text || '').toLowerCase()
  return title.indexOf(needle) >= 0 || text.indexOf(needle) >= 0
}

/** Pinned first, then most recently updated. */
function boardSortNotes(a, b) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  return (b.updatedAt || 0) - (a.updatedAt || 0)
}

/** Priority order: pinned, then urgency rank, then the usual newest-first. */
function boardSortByPriority(a, b) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  var rankA = DSN.PRIORITY_RANK[a.priority] === undefined ? 0 : DSN.PRIORITY_RANK[a.priority]
  var rankB = DSN.PRIORITY_RANK[b.priority] === undefined ? 0 : DSN.PRIORITY_RANK[b.priority]
  if (rankA !== rankB) return rankB - rankA
  return (b.updatedAt || 0) - (a.updatedAt || 0)
}

/** True when the note carries a checklist and every item in it is done. */
function boardAllDone(note) {
  var tasks = note && Array.isArray(note.tasks) ? note.tasks : null
  if (!tasks || !tasks.length) return false
  for (var i = 0; i < tasks.length; i += 1) if (!tasks[i].done) return false
  return true
}

/** Open checklist items of one note. */
function boardOpenTasks(note) {
  var tasks = note && Array.isArray(note.tasks) ? note.tasks : []
  var count = 0
  for (var i = 0; i < tasks.length; i += 1) if (!tasks[i].done) count += 1
  return count
}

function boardReadSections(state, t) {
  var list = state && Array.isArray(state.sections)
    ? state.sections.filter(function (item) { return item && item.id }).slice()
    : []
  if (!list.length) list = [{ id: '', name: t('section.inbox'), order: 0 }]
  list.sort(function (a, b) { return (a.order || 0) - (b.order || 0) })
  return list
}

function boardPickActiveId(sections, candidate) {
  for (var i = 0; i < sections.length; i++) {
    if (sections[i].id === candidate) return candidate
  }
  return sections.length ? sections[0].id : ''
}

/**
 * useSyncExternalStore binding. `DSN.useStore` comes from 45-panel.js and is
 * looked up lazily so the fragment order never matters; the local fallback
 * mirrors the documented helper.
 */
function boardUseStore(store) {
  var React = DSN.React
  var hook = DSN.useStore
  if (typeof hook !== 'function') {
    hook = function (target) {
      return React.useSyncExternalStore(target.subscribe, target.getSnapshot)
    }
  }
  return hook(store)
}

/** Hover state for an HTML5 drop target, counted so child events never flicker. */
function boardUseDragDepth() {
  var React = DSN.React
  var depthRef = React.useRef(0)
  var pair = React.useState(false)
  var active = pair[0]
  var setActive = pair[1]
  return {
    active: active,
    enter: function () {
      depthRef.current += 1
      if (depthRef.current === 1) setActive(true)
    },
    leave: function (event) {
      var node = event && event.currentTarget
      var related = event && event.relatedTarget
      if (node && related && typeof node.contains === 'function' && node.contains(related)) return
      depthRef.current = 0
      if (active) setActive(false)
    },
    reset: function () {
      depthRef.current = 0
      if (active) setActive(false)
    },
  }
}

function boardPrevent(event) {
  if (event && event.preventDefault) event.preventDefault()
}

function boardStop(event) {
  if (event && event.stopPropagation) event.stopPropagation()
}

/* ------------------------------------------------------------------ *
 * building blocks shared by the board
 * ------------------------------------------------------------------ */

function BoardIconButton(props) {
  var classes = 'dsn-iconbtn'
  if (props.className) classes += ' ' + props.className
  return h('button', {
    type: 'button',
    className: classes,
    'aria-label': props.label,
    title: props.title || props.label,
    'aria-pressed': props.pressed === undefined ? undefined : (props.pressed ? 'true' : 'false'),
    disabled: props.disabled === true,
    'data-dsn-nodrag': '1',
    onPointerDown: boardPrevent,
    onMouseDown: boardPrevent,
    onClick: function (event) {
      boardStop(event)
      boardPrevent(event)
      if (props.onClick) props.onClick(event)
    },
  }, h(DSN.Icon, { name: props.icon || 'note', size: props.size || 14 }))
}

function BoardEmpty(props) {
  return h('div', { className: 'dsn-empty' },
    h('span', { className: 'dsn-empty-icon', 'aria-hidden': 'true' },
      h(DSN.Icon, { name: props.icon || 'note', size: 20 })),
    h('p', { className: 'dsn-empty-text' }, props.message))
}

function boardTabButton(props) {
  return h('button', {
    type: 'button',
    role: 'tab',
    className: 'dsn-tab' + (props.active ? ' is-active' : ''),
    'aria-selected': props.active ? 'true' : 'false',
    onClick: function () { props.onClick() },
  },
    h('span', null, props.label),
    h('span', { className: 'dsn-tab-count' }, String(props.count || 0)))
}

function BoardToolbar(props) {
  var t = props.t
  var taskCount = props.taskCount || 0
  var filters = props.view === 'trash'
    ? null
    : h('div', { className: 'dsn-filters' },
      props.view === 'tasks' ? null : h('span', { className: 'dsn-filter-group', title: t('filter.sort') },
        h('span', { className: 'dsn-filter-label' }, t('filter.sort')),
        h(DSN.SelectMenu, {
          t: t,
          value: props.sort,
          ariaLabel: t('filter.sort'),
          onChange: function (value) { props.onSort(value) },
          options: [
            { value: 'time', label: t('filter.sortTime') },
            { value: 'priority', label: t('filter.sortPriority') },
          ],
        })),
      h('span', { className: 'dsn-filter-group', title: t('filter.priority') },
        h('span', { className: 'dsn-filter-label' }, t('filter.priority')),
        h(DSN.SelectMenu, {
          t: t,
          value: props.priorityFilter,
          ariaLabel: t('filter.priority'),
          onChange: function (value) { props.onPriorityFilter(value) },
          options: [{ value: 'all', label: t('filter.all') }].concat(DSN.PRIORITIES.map(function (name) {
            return { value: name, label: t('priority.' + name), dot: DSN.priorityMeta(name).token }
          })),
        })),
      h('button', {
        type: 'button',
        className: 'dsn-filter-toggle' + (props.hideDone ? ' is-on' : ''),
        'aria-pressed': props.hideDone ? 'true' : 'false',
        title: t('filter.hideDoneHint'),
        onClick: function () { props.onToggleHideDone() },
      }, t('filter.hideDone')))
  return h('div', null,
    h('div', { className: 'dsn-toolbar' },
      h('div', { className: 'dsn-tabs', role: 'tablist' },
        boardTabButton({
          active: props.view === 'board',
          label: t('tab.all'),
          count: props.liveCount,
          onClick: function () { props.onView('board') },
        }),
        boardTabButton({
          active: props.view === 'tasks',
          label: t('tab.tasks'),
          count: taskCount,
          onClick: function () { props.onView('tasks') },
        }),
        boardTabButton({
          active: props.view === 'trash',
          label: t('tab.trash'),
          count: props.trashCount,
          onClick: function () { props.onView('trash') },
        })),
      h('div', { className: 'dsn-search' },
        h('span', { className: 'dsn-search-icon', 'aria-hidden': 'true' },
          h(DSN.Icon, { name: 'search', size: 13 })),
        h('input', {
          className: 'dsn-search-input',
          type: 'search',
          value: props.search || '',
          placeholder: t('search.placeholder'),
          'aria-label': t('search.placeholder'),
          spellCheck: false,
          onChange: function (event) { props.onSearch(event.target.value) },
        }),
        props.search
          ? h('button', {
              type: 'button',
              className: 'dsn-search-clear',
              'aria-label': t('search.clear'),
              title: t('search.clear'),
              onClick: function () { props.onSearch('') },
            }, h(DSN.Icon, { name: 'close', size: 12 }))
          : null)),
    filters)
}

/* ------------------------------------------------------------------ *
 * section rail
 * ------------------------------------------------------------------ */

DSN.SectionRail = function SectionRail(props) {
  var React = DSN.React
  var store = props.store
  var t = boardTranslate(props.t)
  var sections = Array.isArray(props.sections) ? props.sections : []
  var activeId = props.activeSectionId

  var menuPair = React.useState('')
  var menuId = menuPair[0]
  var setMenuId = menuPair[1]
  var renamePair = React.useState('')
  var renamingId = renamePair[0]
  var setRenamingId = renamePair[1]
  var renameDraftPair = React.useState('')
  var renameDraft = renameDraftPair[0]
  var setRenameDraft = renameDraftPair[1]
  var addDraftPair = React.useState('')
  var addDraft = addDraftPair[0]
  var setAddDraft = addDraftPair[1]
  var overPair = React.useState('')
  var overId = overPair[0]
  var setOverId = overPair[1]
  var depthRef = React.useRef({})
  var addInputRef = React.useRef(null)
  var renameInputRef = React.useRef(null)
  var adding = props.adding === true

  React.useEffect(function () {
    if (!adding) return undefined
    var node = addInputRef.current
    if (node && typeof node.focus === 'function') node.focus()
    return undefined
  }, [adding])

  React.useEffect(function () {
    if (!renamingId) return undefined
    var node = renameInputRef.current
    if (node && typeof node.focus === 'function') {
      node.focus()
      if (typeof node.select === 'function') node.select()
    }
    return undefined
  }, [renamingId])

  /* Close the section action menu on any outside pointerdown / Escape. */
  React.useEffect(function () {
    if (!menuId) return undefined
    function onPointerDown(event) {
      if (event && event.target && DSN.closest(event.target, '.dsn-menu, .dsn-board-chip-more')) return
      setMenuId('')
    }
    function onKeyDown(event) {
      if (event && event.key === 'Escape') setMenuId('')
    }
    var offPointer = DSN.on(document, 'pointerdown', onPointerDown, true)
    var offKey = DSN.on(document, 'keydown', onKeyDown, true)
    return function () {
      offPointer()
      offKey()
    }
  }, [menuId])

  function notifyAdding(next) {
    if (typeof props.onAddingChange === 'function') props.onAddingChange(next)
  }

  function notifyMoved(noteId) {
    if (typeof props.onMoved === 'function') props.onMoved(noteId)
  }

  function selectSection(sectionId) {
    setMenuId('')
    setRenamingId('')
    if (store && store.actions && typeof store.actions.setActiveSection === 'function') {
      store.actions.setActiveSection(sectionId)
    }
  }

  function toggleMenu(sectionId) {
    setMenuId(menuId === sectionId ? '' : sectionId)
  }

  function beginRename(section) {
    if (!section) return
    setMenuId('')
    setRenamingId(section.id)
    setRenameDraft(section.name || '')
  }

  function commitRename() {
    if (!renamingId) return
    var name = String(renameDraft || '').trim()
    setRenamingId('')
    if (!name) return
    store.actions.renameSection(renamingId, name)
  }

  function cancelRename() {
    setRenamingId('')
  }

  function beginAdd() {
    setAddDraft('')
    notifyAdding(true)
  }

  function commitAdd() {
    var name = String(addDraft || '').trim()
    setAddDraft('')
    notifyAdding(false)
    if (!name) return
    store.actions.addSection(name)
  }

  function cancelAdd() {
    setAddDraft('')
    notifyAdding(false)
  }

  function deleteSectionById(sectionId) {
    setMenuId('')
    if (sections.length <= 1) return
    store.actions.deleteSection(sectionId)
  }

  function onAddKeyDown(event) {
    if (event.key === 'Enter') {
      boardPrevent(event)
      commitAdd()
    } else if (event.key === 'Escape') {
      boardPrevent(event)
      boardStop(event)
      cancelAdd()
    }
  }

  function onRenameKeyDown(event) {
    if (event.key === 'Enter') {
      boardPrevent(event)
      commitRename()
    } else if (event.key === 'Escape') {
      boardPrevent(event)
      boardStop(event)
      cancelRename()
    }
  }

  function chipEnter(sectionId, event) {
    if (!boardIsNoteDrag(event.dataTransfer)) return
    var map = depthRef.current
    map[sectionId] = (map[sectionId] || 0) + 1
    if (map[sectionId] === 1) setOverId(sectionId)
  }

  function chipOver(sectionId, event) {
    if (!boardIsNoteDrag(event.dataTransfer)) return
    boardPrevent(event)
    try {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    } catch (error) { /* ignore */ }
  }

  function chipLeave(sectionId, event) {
    if (!boardIsNoteDrag(event.dataTransfer)) return
    var node = event.currentTarget
    var related = event.relatedTarget
    if (node && related && typeof node.contains === 'function' && node.contains(related)) return
    depthRef.current[sectionId] = 0
    if (overId === sectionId) setOverId('')
  }

  function chipDrop(sectionId, event) {
    if (!boardIsNoteDrag(event.dataTransfer)) return
    boardPrevent(event)
    boardStop(event)
    depthRef.current[sectionId] = 0
    setOverId('')
    var noteId = boardReadNoteId(event.dataTransfer)
    if (!noteId) return
    store.actions.moveNote(noteId, sectionId, null)
    var section = null
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].id === sectionId) section = sections[i]
    }
    DSN.toast(t('board.moved', { name: section ? section.name : '' }), 'info')
    notifyMoved(noteId)
  }

  function SectionChip(section) {
    var active = section.id === activeId
    var count = props.counts && props.counts[section.id] ? props.counts[section.id] : 0
    var classes = 'dsn-section-chip'
    if (active) classes += ' is-active'
    if (overId === section.id) classes += ' is-over'
    if (renamingId === section.id) {
      return h('div', { key: section.id, className: 'dsn-section-chip is-editing' },
        h('input', {
          ref: renameInputRef,
          className: 'dsn-input dsn-board-chip-input',
          value: renameDraft,
          placeholder: t('section.namePlaceholder'),
          'aria-label': t('section.rename'),
          spellCheck: false,
          onChange: function (event) { setRenameDraft(event.target.value) },
          onKeyDown: onRenameKeyDown,
          onBlur: commitRename,
        }),
        h(BoardIconButton, {
          icon: 'check',
          size: 11,
          className: 'dsn-board-mini',
          label: t('board.confirm'),
          onClick: commitRename,
        }),
        h(BoardIconButton, {
          icon: 'close',
          size: 11,
          className: 'dsn-board-mini',
          label: t('note.cancel'),
          onClick: cancelRename,
        }))
    }
    return h('div', {
      key: section.id,
      className: classes,
      role: 'button',
      tabIndex: 0,
      'aria-pressed': active ? 'true' : 'false',
      title: t('section.count', { n: count }),
      onClick: function () { selectSection(section.id) },
      onKeyDown: function (event) {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
          boardPrevent(event)
          selectSection(section.id)
        } else if (event.key === 'F2') {
          boardPrevent(event)
          beginRename(section)
        }
      },
      onContextMenu: function (event) {
        boardPrevent(event)
        setMenuId(section.id)
      },
      onDragEnter: function (event) { chipEnter(section.id, event) },
      onDragOver: function (event) { chipOver(section.id, event) },
      onDragLeave: function (event) { chipLeave(section.id, event) },
      onDrop: function (event) { chipDrop(section.id, event) },
    },
      h('span', { className: 'dsn-board-chip-name' }, section.name || t('section.inbox')),
      count ? h('span', { className: 'dsn-section-count' }, String(count)) : null,
      h('button', {
        type: 'button',
        className: 'dsn-iconbtn dsn-board-chip-more',
        'aria-label': t('board.more'),
        title: t('board.more'),
        'data-dsn-nodrag': '1',
        onPointerDown: boardPrevent,
        onMouseDown: boardPrevent,
        onClick: function (event) {
          boardStop(event)
          toggleMenu(section.id)
        },
      }, h(DSN.Icon, { name: 'more', size: 12 })))
  }

  var chips = sections.map(SectionChip)
  if (adding) {
    chips.push(h('div', { key: '__board-add-section__', className: 'dsn-section-chip is-editing' },
      h('input', {
        ref: addInputRef,
        className: 'dsn-input dsn-board-chip-input',
        value: addDraft,
        placeholder: t('section.namePlaceholder'),
        'aria-label': t('section.add'),
        spellCheck: false,
        onChange: function (event) { setAddDraft(event.target.value) },
        onKeyDown: onAddKeyDown,
        onBlur: commitAdd,
      }),
      h(BoardIconButton, {
        icon: 'check',
        size: 11,
        className: 'dsn-board-mini',
        label: t('board.confirm'),
        onClick: commitAdd,
      }),
      h(BoardIconButton, {
        icon: 'close',
        size: 11,
        className: 'dsn-board-mini',
        label: t('note.cancel'),
        onClick: cancelAdd,
      })))
  } else {
    chips.push(h('button', {
      key: '__board-new-section__',
      type: 'button',
      className: 'dsn-section-chip is-add',
      'aria-label': t('section.add'),
      title: t('section.add'),
      onClick: beginAdd,
    },
      h(DSN.Icon, { name: 'plus', size: 13 }),
      h('span', { className: 'dsn-board-chip-name' }, t('section.add'))))
  }

  var menuSection = null
  for (var i = 0; i < sections.length; i++) {
    if (sections[i].id === menuId) menuSection = sections[i]
  }

  return h('div', { className: 'dsn-board-rail-block' },
    h('div', { className: 'dsn-sections' }, chips),
    menuSection
      ? h('div', { className: 'dsn-menu dsn-board-menu-inline', role: 'menu' },
          h('span', { className: 'dsn-board-menu-label', title: menuSection.name }, menuSection.name),
          h('button', {
            type: 'button',
            role: 'menuitem',
            className: 'dsn-menu-item',
            onClick: function () { beginRename(menuSection) },
          },
            h(DSN.Icon, { name: 'edit', size: 12 }),
            h('span', null, t('section.rename'))),
          h('button', {
            type: 'button',
            role: 'menuitem',
            className: 'dsn-menu-item is-danger',
            disabled: sections.length <= 1,
            title: sections.length <= 1 ? t('section.deleteHint') : t('section.delete'),
            onClick: function () { deleteSectionById(menuSection.id) },
          },
            h(DSN.Icon, { name: 'trash', size: 12 }),
            h('span', null, t('section.delete'))))
      : null)
}

/* ------------------------------------------------------------------ *
 * composer
 * ------------------------------------------------------------------ */

DSN.Composer = function Composer(props) {
  var React = DSN.React
  var store = props.store
  var t = boardTranslate(props.t)
  var draftPair = React.useState('')
  var draft = draftPair[0]
  var setDraft = draftPair[1]
  var empty = boardIsEmptyHtml(draft)
  var drop = boardUseDragDepth()

  /* Keep the highlight honest even when a drop is swallowed by the editor. */
  React.useEffect(function () {
    if (!drop.active) return undefined
    function clear() { drop.reset() }
    var offEnd = DSN.on(window, 'dragend', clear)
    var offDrop = DSN.on(window, 'drop', clear)
    var offBlur = DSN.on(window, 'blur', clear)
    return function () {
      offEnd()
      offDrop()
      offBlur()
    }
  }, [drop.active])

  function save() {
    if (empty) return
    var html = String(draft || '')
    var payload = { html: html, text: boardHtmlText(html) }
    if (props.sectionId) payload.sectionId = props.sectionId
    store.actions.addNote(payload)
    store.actions.setView('board')
    setDraft('')
    DSN.toast(t('note.saved'), 'info')
  }

  function change(html) {
    setDraft(typeof html === 'string' ? html : '')
  }

  return h('div', {
    className: 'dsn-composer' + (drop.active ? ' is-over' : ''),
    onDragEnter: function (event) {
      if (!boardIsExternalDrag(event.dataTransfer)) return
      boardPrevent(event)
      drop.enter()
    },
    onDragOver: function (event) {
      if (!boardIsExternalDrag(event.dataTransfer)) return
      boardPrevent(event)
      try {
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      } catch (error) { /* ignore */ }
    },
    onDragLeave: function (event) {
      if (!boardIsExternalDrag(event.dataTransfer)) return
      drop.leave(event)
    },
    onDrop: function () { drop.reset() },
  },
    h(DSN.Editor, {
      value: draft,
      onChange: change,
      onSubmit: save,
      placeholder: t('composer.placeholder'),
      minHeight: 56,
      t: t,
    }),
    h('div', { className: 'dsn-composer-foot' },
      h('span', { className: 'dsn-composer-hint' }, t('composer.richHint')),
      h('span', { className: 'dsn-board-save-hint' }, t('composer.saveHint')),
      h('button', {
        type: 'button',
        className: 'dsn-btn dsn-btn-primary dsn-btn-tiny',
        disabled: empty,
        title: t('composer.saveHint'),
        'data-dsn-nodrag': '1',
        onPointerDown: boardPrevent,
        onClick: function (event) {
          boardPrevent(event)
          save()
        },
      },
        h(DSN.Icon, { name: 'check', size: 12 }),
        h('span', null, t('composer.save')))))
}

/* ------------------------------------------------------------------ *
 * trash
 * ------------------------------------------------------------------ */

function BoardTrashItem(props) {
  var store = props.store
  var t = boardTranslate(props.t)
  var note = props.note
  if (!note) return null
  var kind = note.kind || 'text'
  var kindLabel = t('kind.' + kind)
  var safeHtml = ''
  if (typeof DSN.sanitizeHtml === 'function') {
    try {
      safeHtml = DSN.sanitizeHtml(note.html || '')
    } catch (error) {
      DSN.log('sanitizeHtml failed', error)
    }
  }
  return h('article', { className: 'dsn-note dsn-note--trash', 'data-note-id': note.id },
    h('div', { className: 'dsn-note-head' },
      h('span', { className: 'dsn-note-kind', title: kindLabel, 'aria-hidden': 'true' },
        h(DSN.Icon, { name: BOARD_KIND_ICONS[kind] || 'note', size: 13 })),
      h('span', { className: 'dsn-note-age' },
        DSN.formatAge(note.deletedAt || note.updatedAt, t)),
      h('div', { className: 'dsn-note-actions is-always' },
        h(BoardIconButton, {
          icon: 'restore',
          label: t('note.restore'),
          onClick: function () { store.actions.restoreNote(note.id) },
        }),
        h(BoardIconButton, {
          icon: 'trash',
          label: t('note.purge'),
          className: 'is-danger',
          onClick: function () { store.actions.purgeNote(note.id) },
        }))),
    h('div', { className: 'dsn-note-body' },
      h('div', { className: 'dsn-note-clamp' },
        h(DSN.Content, { html: safeHtml, kind: note.kind }))),
    note.source && note.source.sessionTitle
      ? h('div', { className: 'dsn-note-foot' },
          h('span', { className: 'dsn-chip dsn-note-source', title: note.source.sessionTitle },
            h(DSN.Icon, { name: 'note', size: 11 }),
            h('span', null, t('list.source', { name: note.source.sessionTitle }))))
      : null)
}

DSN.TrashView = function TrashView(props) {
  var React = DSN.React
  var store = props.store
  var t = boardTranslate(props.t)
  var notes = Array.isArray(props.notes) ? props.notes : []
  var armedPair = React.useState(false)
  var armed = armedPair[0]
  var setArmed = armedPair[1]

  function emptyAll() {
    if (!armed) {
      setArmed(true)
      return
    }
    setArmed(false)
    store.actions.emptyTrash()
  }

  function disarm() {
    setArmed(false)
  }

  if (!notes.length) {
    return h(BoardEmpty, {
      icon: props.query ? 'search' : 'trash',
      message: props.query ? t('board.noResults') : t('list.trashEmpty'),
    })
  }

  return h('div', { className: 'dsn-board-trash' },
    h('div', { className: 'dsn-board-trash-head' },
      h('span', { className: 'dsn-board-trash-title' }, t('tab.trash')),
      h('button', {
        type: 'button',
        className: 'dsn-btn dsn-btn-danger dsn-btn-tiny' + (armed ? ' is-armed' : ''),
        title: armed ? t('trash.confirmEmpty') : t('trash.emptyAll'),
        onClick: function (event) {
          boardPrevent(event)
          emptyAll()
        },
        onBlur: disarm,
      },
        h(DSN.Icon, { name: 'trash', size: 12 }),
        h('span', null, armed ? t('trash.confirmEmpty') : t('trash.emptyAll')))),
    notes.map(function (note) {
      return h(BoardTrashItem, { key: note.id, store: store, t: t, note: note })
    }))
}

/* ------------------------------------------------------------------ *
 * note card
 * ------------------------------------------------------------------ */

function NoteCardInner(props) {
  var React = DSN.React
  var store = props.store
  var t = boardTranslate(props.t)
  var note = props.note
  var bridge = props.bridge
  var drag = props.drag || {}

  var editPair = React.useState(null)
  var draft = editPair[0]
  var setDraft = editPair[1]
  var expandPair = React.useState(false)
  var expanded = expandPair[0]
  var setExpanded = expandPair[1]
  var overflowPair = React.useState(false)
  var overflowing = overflowPair[0]
  var setOverflowing = overflowPair[1]
  var suppressDragRef = React.useRef(false)
  var clampRef = React.useRef(null)

  var safeHtml = React.useMemo(function () {
    if (typeof DSN.sanitizeHtml !== 'function') return ''
    try {
      return DSN.sanitizeHtml(note.html || '')
    } catch (error) {
      DSN.log('sanitizeHtml failed', error)
      return ''
    }
  }, [note.html])

  /* The shared `.dsn-note-clamp` caps the body at 8 lines; detect overflow so
     the expand affordance only appears when there is more to read. */
  React.useEffect(function () {
    var alive = true
    function measure() {
      if (!alive) return
      var node = clampRef.current
      if (!node) return
      if (expanded) {
        setOverflowing(true)
        return
      }
      setOverflowing(node.scrollHeight > node.clientHeight + 2)
    }
    measure()
    var timer1 = setTimeout(measure, 120)
    var timer2 = setTimeout(measure, 650)
    var offResize = DSN.on(window, 'resize', measure)
    return function () {
      alive = false
      clearTimeout(timer1)
      clearTimeout(timer2)
      offResize()
    }
  }, [note.html, expanded])

  var editing = typeof draft === 'string'
  var kind = note.kind || 'text'
  var kindLabel = t('kind.' + kind)
  var title = note.title || DSN.headline(note.text || '', 64)
  var showExpand = overflowing || expanded
  var dragging = !!(drag.id && drag.id === note.id)
  var taskTotal = Array.isArray(note.tasks) ? note.tasks.length : 0
  var taskDone = 0
  if (taskTotal) {
    for (var taskIndex = 0; taskIndex < note.tasks.length; taskIndex += 1) {
      if (note.tasks[taskIndex].done) taskDone += 1
    }
  }
  var commentCount = Array.isArray(note.comments) ? note.comments.length : 0

  function openDetail(event) {
    if (event) {
      boardPrevent(event)
      boardStop(event)
    }
    store.actions.setDetail(note.id)
  }

  function startEdit(event) {
    if (event) {
      boardPrevent(event)
      boardStop(event)
    }
    setDraft(note.html || '')
  }

  function cancelEdit() {
    setDraft(null)
  }

  function saveEdit() {
    if (typeof draft !== 'string') return
    if (boardIsEmptyHtml(draft)) return
    store.actions.updateNote(note.id, { html: draft, text: boardHtmlText(draft) })
    setDraft(null)
    DSN.toast(t('note.updated'), 'info')
  }

  function changeDraft(html) {
    setDraft(typeof html === 'string' ? html : '')
  }

  function togglePin() {
    store.actions.togglePin(note.id)
  }

  function removeNote() {
    store.actions.deleteNote(note.id)
  }

  function copyNote() {
    DSN.copyRich(note.html || '', note.text || '').then(function (ok) {
      DSN.toast(ok ? t('status.copied') : t('status.copyFailed'), ok ? 'info' : 'error')
    }, function (error) {
      DSN.log('copyRich rejected', error)
      DSN.toast(t('status.copyFailed'), 'error')
    })
  }

  function insertNote() {
    var target = bridge || DSN.bridge || null
    function copyAsFallback() {
      DSN.copyRich(note.html || '', note.text || '').then(function () {
        DSN.toast(t('status.noSession'), 'error')
      }, function () {
        DSN.toast(t('status.noSession'), 'error')
      })
    }
    if (!target || typeof target.insert !== 'function') {
      copyAsFallback()
      return
    }
    var result
    try {
      result = target.insert(note.html || '', note.text || '', t)
    } catch (error) {
      DSN.log('bridge insert failed', error)
      copyAsFallback()
      return
    }
    if (result && typeof result.then === 'function') {
      result.then(function (ok) {
        if (ok) DSN.toast(t('status.inserted'), 'info')
        else DSN.toast(t('status.noSession'), 'error')
      }, function (error) {
        DSN.log('bridge insert rejected', error)
        DSN.toast(t('status.noSession'), 'error')
      })
      return
    }
    var inserted = result === true
    DSN.toast(inserted ? t('status.inserted') : t('status.noSession'), inserted ? 'info' : 'error')
  }

  /**
   * Insert the note as a real quote block (the host's own QuoteNode), i.e. the
   * same thing 引用文本 does — the text arrives as a Markdown blockquote. The
   * note's hidden `origin` only decides the toast wording: DSH quotes pure text,
   * so a note captured in another conversation still quotes fine here.
   */
  function quoteNote() {
    var target = bridge || DSN.bridge || null
    var text = note.text || ''
    if (!text && typeof DSN.htmlToText === 'function') text = DSN.htmlToText(note.html || '')
    if (!text) return
    var quoted = false
    try {
      if (target && typeof target.quote === 'function') quoted = target.quote(text) === true
    } catch (error) {
      DSN.log('quote note failed', error)
      quoted = false
    }
    if (!quoted) {
      DSN.copyRich(note.html || '', text).then(function (ok) {
        DSN.toast(ok ? t('status.quotedCopied') : t('status.copyFailed'), ok ? 'info' : 'error')
      }, function (error) {
        DSN.log('quote fallback rejected', error)
        DSN.toast(t('status.copyFailed'), 'error')
      })
      return
    }
    var handle = null
    try {
      handle = target && typeof target.get === 'function' ? target.get() : null
    } catch (error) {
      handle = null
    }
    var origin = note.origin || null
    var elsewhere = !!(handle && handle.sessionId && origin && origin.sessionId && origin.sessionId !== handle.sessionId)
    if (elsewhere) {
      var name = origin.sessionTitle || '#' + String(origin.sessionId).slice(0, 6)
      DSN.toast(t('status.quotedOther', { name: name }), 'info')
      return
    }
    DSN.toast(t('status.quoted'), 'info')
  }

  function toggleExpand(event) {
    boardStop(event)
    boardPrevent(event)
    setExpanded(!expanded)
  }

  function onKeyDown(event) {
    if (event.target !== event.currentTarget) return
    var key = event.key
    if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
      boardPrevent(event)
      startEdit()
    } else if (key === 'Delete') {
      boardPrevent(event)
      removeNote()
    }
  }

  function onPointerDown(event) {
    suppressDragRef.current = !!DSN.closest(event.target, '[data-dsn-nodrag]')
  }

  function onDragStart(event) {
    if (editing || suppressDragRef.current) {
      boardPrevent(event)
      return
    }
    var dataTransfer = event.dataTransfer
    if (!dataTransfer) return
    try {
      dataTransfer.effectAllowed = 'copyMove'
      dataTransfer.setData(BOARD_NOTE_MIME, note.id)
      dataTransfer.setData('text/plain', note.text || '')
      dataTransfer.setData('text/html', boardDragHtml(note))
    } catch (error) {
      DSN.log('drag payload failed', error)
    }
    if (typeof drag.start === 'function') drag.start(note.id)
  }

  function onDragEnd() {
    suppressDragRef.current = false
    if (typeof drag.end === 'function') drag.end()
  }

  var actions = editing
    ? null
    : h('div', { className: 'dsn-note-actions' },
        h(BoardIconButton, {
          icon: 'pin',
          label: note.pinned ? t('note.unpin') : t('note.pin'),
          pressed: !!note.pinned,
          className: note.pinned ? 'is-active' : '',
          onClick: togglePin,
        }),
        h(BoardIconButton, {
          icon: 'copy',
          label: t('note.copy'),
          onClick: copyNote,
        }),
        h(BoardIconButton, {
          icon: 'quote',
          label: t('note.quote'),
          onClick: quoteNote,
        }),
        h(BoardIconButton, {
          icon: 'insert',
          label: t('note.insert'),
          onClick: insertNote,
        }),
        h(BoardIconButton, {
          icon: 'edit',
          label: t('note.edit'),
          onClick: startEdit,
        }),
        h(BoardIconButton, {
          icon: 'trash',
          label: t('note.delete'),
          className: 'is-danger',
          onClick: removeNote,
        }))

  var body = editing
    ? h('div', { className: 'dsn-note-edit', 'data-dsn-nodrag': '1' },
        h(DSN.Editor, {
          value: draft,
          onChange: changeDraft,
          onSubmit: saveEdit,
          placeholder: t('board.editPlaceholder'),
          autoFocus: true,
          minHeight: 88,
          t: t,
        }),
        h('div', { className: 'dsn-note-editbar' },
          h('span', { className: 'dsn-composer-hint' }, t('composer.saveHint')),
          h('button', {
            type: 'button',
            className: 'dsn-btn dsn-btn-tiny',
            'data-dsn-nodrag': '1',
            onPointerDown: boardPrevent,
            onClick: function (event) {
              boardPrevent(event)
              cancelEdit()
            },
          }, h('span', null, t('note.cancel'))),
          h('button', {
            type: 'button',
            className: 'dsn-btn dsn-btn-tiny dsn-btn-primary',
            'data-dsn-nodrag': '1',
            disabled: boardIsEmptyHtml(draft),
            onPointerDown: boardPrevent,
            onClick: function (event) {
              boardPrevent(event)
              saveEdit()
            },
          }, h('span', null, t('note.save')))))
    : h('div', { className: 'dsn-note-body' },
        h('div', {
          className: 'dsn-note-clamp' +
            (expanded ? ' is-expanded' : '') +
            (!expanded && overflowing ? ' is-clamped' : ''),
          ref: clampRef,
        },
          h(DSN.Content, { html: safeHtml, kind: note.kind })),
        showExpand
          ? h('button', {
              type: 'button',
              className: 'dsn-note-expand',
              'data-dsn-nodrag': '1',
              'aria-expanded': expanded ? 'true' : 'false',
              title: expanded ? t('board.collapseNote') : t('board.expandNote'),
              onPointerDown: boardPrevent,
              onClick: toggleExpand,
            },
              h(DSN.Icon, { name: expanded ? 'collapse' : 'expand', size: 11 }),
              h('span', null, expanded ? t('board.collapseNote') : t('board.expandNote')))
          : null)

  return h('article', {
    className: 'dsn-note' +
      (note.pinned ? ' is-pinned' : '') +
      (dragging ? ' is-dragging' : '') +
      (editing ? ' is-editing' : ''),
    'data-note-id': note.id,
    role: 'button',
    tabIndex: 0,
    'aria-label': title || kindLabel,
    draggable: editing ? false : true,
    onKeyDown: onKeyDown,
    onPointerDown: onPointerDown,
    onDragStart: onDragStart,
    onDragEnd: onDragEnd,
  },
    h('div', { className: 'dsn-note-head' },
      h('span', { className: 'dsn-note-kind', title: kindLabel, 'aria-hidden': 'true' },
        h(DSN.Icon, { name: BOARD_KIND_ICONS[kind] || 'note', size: 13 })),
      h('span', { className: 'dsn-note-age' }, DSN.formatAge(note.updatedAt, t)),
      note.pinned
        ? h('span', { className: 'dsn-note-flag', title: t('list.pinned') },
            h(DSN.Icon, { name: 'pin', size: 10 }),
            h('span', null, t('list.pinned')))
        : null,
      typeof DSN.PrioritySelect === 'function'
        ? h(DSN.PrioritySelect, { store: store, t: t, note: note })
        : null,
      actions),
    body,
    h('div', { className: 'dsn-note-foot' },
      h('div', { className: 'dsn-note-meta' },
        taskTotal
          ? h('button', {
              type: 'button',
              className: 'dsn-chip dsn-chip--btn' + (taskDone === taskTotal ? ' dsn-chip--warn' : ''),
              'data-dsn-nodrag': '1',
              title: t('detail.open'),
              onPointerDown: boardPrevent,
              onClick: openDetail,
            },
              h(DSN.Icon, { name: 'check', size: 11 }),
              h('span', null, t('task.progress', { done: taskDone, total: taskTotal })))
          : null,
        h('button', {
          type: 'button',
          className: 'dsn-chip dsn-chip--btn',
          'data-dsn-nodrag': '1',
          title: t('detail.open'),
          onPointerDown: boardPrevent,
          onClick: openDetail,
        },
          h(DSN.Icon, { name: 'quote', size: 11 }),
          h('span', null, commentCount ? t('comment.title') + ' ' + commentCount : t('comment.title'))),
        note.source && note.source.sessionTitle
          ? h('span', { className: 'dsn-chip dsn-note-source', title: note.source.sessionTitle },
              h(DSN.Icon, { name: 'note', size: 11 }),
              h('span', null, t('list.source', { name: note.source.sessionTitle })))
          : null)))
}

DSN.NoteCard = function NoteCard(props) {
  if (!props || !props.note) return null
  return h(NoteCardInner, props)
}

/* ------------------------------------------------------------------ *
 * board body
 * ------------------------------------------------------------------ */

function TrashDropZone(props) {
  var t = boardTranslate(props.t)
  var depth = boardUseDragDepth()
  return h('div', {
    className: 'dsn-dropzone' + (depth.active ? ' is-over' : ''),
    onDragEnter: function (event) {
      if (!boardIsNoteDrag(event.dataTransfer)) return
      boardPrevent(event)
      depth.enter()
    },
    onDragOver: function (event) {
      if (!boardIsNoteDrag(event.dataTransfer)) return
      boardPrevent(event)
      try {
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      } catch (error) { /* ignore */ }
    },
    onDragLeave: function (event) {
      if (!boardIsNoteDrag(event.dataTransfer)) return
      depth.leave(event)
    },
    onDrop: function (event) {
      if (!boardIsNoteDrag(event.dataTransfer)) return
      boardPrevent(event)
      boardStop(event)
      depth.reset()
      var noteId = boardReadNoteId(event.dataTransfer)
      if (noteId && typeof props.onDelete === 'function') props.onDelete(noteId)
    },
  },
    h(DSN.Icon, { name: 'trash', size: 13 }),
    h('span', null, t('trash.dropHint')))
}

function BoardBody(props) {
  var React = DSN.React
  var store = props.store
  var t = boardTranslate(props.t)
  var state = boardUseStore(store)

  var tickPair = React.useState(0)
  var setTick = tickPair[1]
  var dragPair = React.useState('')
  var dragId = dragPair[0]
  var setDragId = dragPair[1]
  var addingPair = React.useState(false)
  var addingSection = addingPair[0]
  var setAddingSection = addingPair[1]
  var dropDepthRef = React.useRef(0)
  var dropActivePair = React.useState(false)
  var dropActive = dropActivePair[0]
  var setDropActive = dropActivePair[1]

  /* Keep relative ages fresh without touching the store. */
  React.useEffect(function () {
    var timer = setInterval(function () {
      setTick(function (value) { return value + 1 })
    }, 60000)
    return function () { clearInterval(timer) }
  }, [])

  /* A drag always ends somewhere — clear the drag-only affordances. */
  React.useEffect(function () {
    if (!dragId) return undefined
    function clearDrag() { setDragId('') }
    var offDragEnd = DSN.on(document, 'dragend', clearDrag)
    var offDrop = DSN.on(document, 'drop', clearDrag)
    var offBlur = DSN.on(window, 'blur', clearDrag)
    return function () {
      offDragEnd()
      offDrop()
      offBlur()
    }
  }, [dragId])

  React.useEffect(function () {
    function reset() {
      dropDepthRef.current = 0
      setDropActive(false)
    }
    var offDragEnd = DSN.on(window, 'dragend', reset)
    var offDrop = DSN.on(window, 'drop', reset)
    var offBlur = DSN.on(window, 'blur', reset)
    return function () {
      offDragEnd()
      offDrop()
      offBlur()
    }
  }, [])

  function resetDrop() {
    dropDepthRef.current = 0
    setDropActive(false)
  }

  function dragStartNote(noteId) {
    setDragId(noteId || '')
  }

  function dragEndNote() {
    setDragId('')
  }

  function changeView(next) {
    store.actions.setView(next)
  }

  function changeSearch(value) {
    store.actions.setSearch(value)
  }

  function handleNoteDropDelete(noteId) {
    if (!noteId) return
    store.actions.deleteNote(noteId)
    setDragId('')
  }

  function onBoardDragEnter(event) {
    if (!boardIsExternalDrag(event.dataTransfer)) return
    boardPrevent(event)
    dropDepthRef.current += 1
    if (dropDepthRef.current === 1) setDropActive(true)
  }

  function onBoardDragOver(event) {
    if (!boardIsExternalDrag(event.dataTransfer)) return
    boardPrevent(event)
    try {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    } catch (error) { /* ignore */ }
  }

  function onBoardDragLeave(event) {
    if (!boardIsExternalDrag(event.dataTransfer)) return
    var node = event.currentTarget
    var related = event.relatedTarget
    if (node && related && typeof node.contains === 'function' && node.contains(related)) {
      dropDepthRef.current = Math.max(dropDepthRef.current - 1, 1)
      return
    }
    resetDrop()
  }

  function saveDroppedContent(dataTransfer) {
    if (typeof DSN.readDragContent !== 'function') return
    var pending
    try {
      pending = DSN.readDragContent(dataTransfer)
    } catch (error) {
      DSN.log('readDragContent failed', error)
      return
    }
    if (!pending || typeof pending.then !== 'function') return
    pending.then(function (payload) {
      if (!payload) return
      var text = typeof payload.text === 'string' ? payload.text : ''
      var html = typeof payload.html === 'string' ? payload.html : ''
      if (!html && text) html = boardTextToHtml(text)
      if (!html && !text) return
      if (!text) text = boardHtmlText(html)
      store.actions.addNote({ html: html, text: text })
      var snapshot = typeof store.getSnapshot === 'function' ? store.getSnapshot() : null
      if (snapshot && snapshot.ui && snapshot.ui.view === 'trash') store.actions.setView('board')
      DSN.toast(t('note.saved'), 'info')
    }, function (error) {
      DSN.log('drop payload rejected', error)
    })
  }

  function onBoardDrop(event) {
    if (!boardIsExternalDrag(event.dataTransfer)) return
    boardPrevent(event)
    resetDrop()
    saveDroppedContent(event.dataTransfer)
  }

  if (!state) {
    return h('div', { className: 'dsn-app', 'data-dsn-board': '1' },
      h(BoardEmpty, { icon: 'note', message: t('list.empty') }))
  }

  var ui = state.ui && typeof state.ui === 'object' ? state.ui : {}
  var notes = Array.isArray(state.notes) ? state.notes : []
  var sections = boardReadSections(state, t)
  var activeId = boardPickActiveId(sections, ui.activeSectionId)
  var view = ui.view === 'trash' ? 'trash' : (ui.view === 'tasks' ? 'tasks' : 'board')
  var query = typeof ui.search === 'string' ? ui.search : ''
  var sortMode = ui.sort === 'priority' ? 'priority' : 'time'
  var priorityFilter = DSN.PRIORITY_RANK[ui.priorityFilter] === undefined ? 'all' : ui.priorityFilter
  var hideDone = ui.hideDone === true
  var bridge = props.bridge || DSN.bridge || null

  var liveCount = 0
  var trashCount = 0
  var taskCount = 0
  var sectionCounts = {}
  var i
  for (i = 0; i < notes.length; i++) {
    var item = notes[i]
    if (!item) continue
    if (item.deletedAt) {
      trashCount += 1
      continue
    }
    liveCount += 1
    taskCount += boardOpenTasks(item)
    var sectionKey = item.sectionId || ''
    sectionCounts[sectionKey] = (sectionCounts[sectionKey] || 0) + 1
  }

  var visible = []
  if (view === 'trash') {
    for (i = 0; i < notes.length; i++) {
      var deleted = notes[i]
      if (!deleted || !deleted.deletedAt) continue
      if (!boardMatchesQuery(deleted, query)) continue
      visible.push(deleted)
    }
    visible.sort(function (a, b) { return (b.deletedAt || 0) - (a.deletedAt || 0) })
  } else {
    for (i = 0; i < notes.length; i++) {
      var live = notes[i]
      if (!live || live.deletedAt) continue
      if (activeId && live.sectionId !== activeId) continue
      if (priorityFilter !== 'all' && live.priority !== priorityFilter) continue
      if (hideDone && boardAllDone(live)) continue
      if (!boardMatchesQuery(live, query)) continue
      visible.push(live)
    }
    visible.sort(sortMode === 'priority' ? boardSortByPriority : boardSortNotes)
  }

  var emptyMessage
  var emptyIcon
  if (view === 'trash') {
    emptyMessage = query ? t('board.noResults') : t('list.trashEmpty')
    emptyIcon = query ? 'search' : 'trash'
  } else if (view === 'tasks') {
    emptyMessage = t('tasks.empty')
    emptyIcon = 'check'
  } else if (query) {
    emptyMessage = t('board.noResults')
    emptyIcon = 'search'
  } else if (liveCount === 0) {
    emptyMessage = t('list.empty')
    emptyIcon = 'note'
  } else {
    emptyMessage = t('list.emptySection')
    emptyIcon = 'sections'
  }

  var cards = visible.map(function (note) {
    return h(DSN.NoteCard, {
      key: note.id,
      store: store,
      t: t,
      note: note,
      bridge: bridge,
      drag: { id: dragId, start: dragStartNote, end: dragEndNote },
    })
  })

  var stream
  if (view === 'trash') {
    stream = h(DSN.TrashView, { store: store, t: t, notes: visible, query: query })
  } else if (view === 'tasks') {
    stream = h(DSN.TasksView, {
      store: store,
      t: t,
      state: state,
      sectionId: activeId && sections.length > 1 ? '' : activeId,
    })
  } else {
    stream = cards.length ? cards : h(BoardEmpty, { icon: emptyIcon, message: emptyMessage })
  }

  /* The detail sheet is a view of one note: the card stays in the stream, the
     sheet adds the checklist and the comment thread on top of the panel. */
  var detailNote = null
  if (ui.detailNoteId) {
    for (i = 0; i < notes.length; i += 1) {
      var candidate = notes[i]
      if (candidate && !candidate.deletedAt && candidate.id === ui.detailNoteId) {
        detailNote = candidate
        break
      }
    }
  }

  return h('div', {
    className: 'dsn-app',
    'data-dsn-board': '1',
    'data-dsn-view': view,
    onDragEnter: onBoardDragEnter,
    onDragOver: onBoardDragOver,
    onDragLeave: onBoardDragLeave,
    onDrop: onBoardDrop,
  },
    h(BoardToolbar, {
      t: t,
      view: view,
      liveCount: liveCount,
      trashCount: trashCount,
      taskCount: taskCount,
      sort: sortMode,
      priorityFilter: priorityFilter,
      hideDone: hideDone,
      search: query,
      onView: changeView,
      onSearch: changeSearch,
      onSort: function (next) { store.actions.setSort(next) },
      onPriorityFilter: function (next) { store.actions.setPriorityFilter(next) },
      onToggleHideDone: function () { store.actions.toggleHideDone() },
    }),
    view === 'board'
      ? h(DSN.SectionRail, {
        store: store,
        t: t,
        sections: sections,
        activeSectionId: activeId,
        counts: sectionCounts,
        adding: addingSection,
        onAddingChange: setAddingSection,
        onMoved: function () { setDragId('') },
      })
      : null,
    view === 'board'
      ? h(DSN.Composer, { store: store, t: t, sectionId: activeId })
      : null,
    dragId && view === 'board'
      ? h(TrashDropZone, { t: t, onDelete: handleNoteDropDelete })
      : null,
    h('div', {
      className: 'dsn-stream' + (dragId && view === 'board' ? ' is-drop-target' : ''),
    }, stream),
    h('div', { className: 'dsn-footer' },
      h('span', null, t('list.count', { n: visible.length })),
      typeof DSN.SyncStatus === 'function' ? h(DSN.SyncStatus, { t: t }) : null,
      h('span', { className: 'dsn-footer-hint', title: t('shortcuts.hint') },
        t('shortcuts.hint'))),
    dropActive
      ? h('div', { className: 'dsn-board-drop', 'aria-hidden': 'true' },
          h('div', { className: 'dsn-board-drop-inner' },
            h(DSN.Icon, { name: 'insert', size: 22 }),
            h('span', { className: 'dsn-board-drop-title' }, t('capture.dropHere')),
            h('span', { className: 'dsn-board-drop-sub' }, t('capture.dropRich'))))
      : null,
    detailNote && typeof DSN.NoteSheet === 'function'
      ? h(DSN.NoteSheet, { store: store, t: t, note: detailNote })
      : null)
}

/* ------------------------------------------------------------------ *
 * exported entry point
 * ------------------------------------------------------------------ */

DSN.NotesApp = function NotesApp(props) {
  if (!props || !props.store || typeof props.store.getSnapshot !== 'function') return null
  return h(BoardBody, props)
}

/* ------------------------------------------------------------------ *
 * styles
 *
 * Everything structural comes from the base chunk in 40-styles.js; this
 * chunk only adds the few board-specific joint pieces. All colours are
 * `var(--dsw-alias-*, <literal>)` so the board also works inside the PiP
 * window (70-pip copies the token names listed in DSN.TOKENS).
 * ------------------------------------------------------------------ */

var BOARD_CSS = [
  '.dsn-app { position: relative; }',
  '.dsn-board-rail-block { flex: 0 0 auto; min-width: 0; }',

  /* action rows that must be visible without hover */
  '.dsn-note-actions.is-always { opacity: 1; transform: none; }',
  '.dsn-note-actions .dsn-iconbtn.is-danger:hover {',
  '  color: var(--dsw-alias-state-error-primary, #ec1313);',
  '  background: var(--dsw-alias-interactive-bg-hover-danger, rgba(236, 19, 19, 0.05));',
  '}',

  /* recycled cards in the trash */
  '.dsn-note--trash { background: var(--dsw-alias-bg-module-platform, #f9fafb); }',
  '.dsn-note--trash .dsn-note-clamp { max-height: 4.65em; }',
  '.dsn-note--trash .dsn-note-actions { opacity: 1; transform: none; }',

  /* section chip: name, count, overflow "…" button, inline editor */
  '.dsn-board-chip-name { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  '.dsn-section-chip.is-editing { padding: 0 3px 0 4px; cursor: default; }',
  '.dsn-board-chip-more {',
  '  width: 18px; height: 18px; min-width: 18px; border-radius: 5px;',
  '  opacity: 0; transition: opacity 0.12s ease;',
  '}',
  '.dsn-section-chip:hover .dsn-board-chip-more,',
  '.dsn-section-chip.is-active .dsn-board-chip-more,',
  '.dsn-section-chip.is-over .dsn-board-chip-more,',
  '.dsn-section-chip:focus-within .dsn-board-chip-more { opacity: 0.9; }',
  '.dsn-board-chip-input { width: 108px; height: 22px; padding: 0 6px; font-size: 12px; }',
  '.dsn-board-mini { width: 20px; height: 20px; min-width: 20px; border-radius: 5px; }',

  /* section action menu: inline under the rail instead of floating */
  '.dsn-board-menu-inline {',
  '  position: static;',
  '  display: flex;',
  '  align-items: center;',
  '  flex-wrap: wrap;',
  '  gap: 4px;',
  '  min-width: 0;',
  '  margin: 0 12px 8px;',
  '  padding: 4px 6px;',
  '}',
  '.dsn-board-menu-inline .dsn-menu-item { width: auto; height: 26px; padding: 0 8px; }',
  '.dsn-board-menu-inline .dsn-menu-item:disabled { opacity: 0.45; cursor: default; }',
  '.dsn-board-menu-inline .dsn-menu-item:disabled:hover {',
  '  background: transparent;',
  '  color: var(--dsw-alias-state-error-primary, #ec1313);',
  '}',
  '.dsn-board-menu-label {',
  '  flex: 1 1 auto;',
  '  min-width: 0;',
  '  overflow: hidden;',
  '  text-overflow: ellipsis;',
  '  white-space: nowrap;',
  '  padding: 0 4px;',
  '  font-size: 12px;',
  '  font-weight: 600;',
  '  color: var(--dsw-alias-label-primary, #0f1115);',
  '}',

  /* composer footer helper text */
  '.dsn-board-save-hint {',
  '  flex: 0 0 auto;',
  '  color: var(--dsw-alias-label-caption, #adb2b8);',
  '  font-size: 11px;',
  '  white-space: nowrap;',
  '}',
  '.dsn-composer-foot .dsn-btn { margin-left: 2px; }',

  /* trash view head */
  '.dsn-board-trash { display: flex; flex-direction: column; gap: 8px; min-width: 0; }',
  '.dsn-board-trash-head { display: flex; align-items: center; gap: 8px; padding: 0 2px; }',
  '.dsn-board-trash-title {',
  '  font-size: 12px;',
  '  font-weight: 600;',
  '  color: var(--dsw-alias-label-secondary, #61666b);',
  '}',
  '.dsn-board-trash-head .dsn-btn { margin-left: auto; }',
  '.dsn-btn.is-armed {',
  '  background: var(--dsw-alias-interactive-bg-hover-danger, rgba(236, 19, 19, 0.05));',
  '}',

  /* external content drop overlay */
  '.dsn-board-drop {',
  '  position: absolute;',
  '  inset: 8px;',
  '  z-index: 8;',
  '  display: flex;',
  '  align-items: center;',
  '  justify-content: center;',
  '  border: 1.5px dashed var(--dsw-alias-state-business-primary, #4176e6);',
  '  border-radius: var(--dsn-radius-card, 10px);',
  '  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 7%, transparent);',
  '  pointer-events: none;',
  '}',
  '.dsn-board-drop-inner {',
  '  display: flex;',
  '  flex-direction: column;',
  '  align-items: center;',
  '  gap: 6px;',
  '  color: var(--dsw-alias-state-business-primary, #4176e6);',
  '}',
  '.dsn-board-drop-title { font-size: 13px; font-weight: 600; }',
  '.dsn-board-drop-sub {',
  '  font-size: 11.5px;',
  '  color: var(--dsw-alias-label-secondary, #61666b);',
  '}',

  /* coarse pointers never hover: keep card actions visible */
  '@media (hover: none) {',
  '  .dsn-note-actions { opacity: 1; transform: none; }',
  '}',
  '@media (prefers-reduced-motion: reduce) {',
  '  .dsn-note, .dsn-note-actions, .dsn-board-chip-more { transition: none; }',
  '}',
].join('\n')

if (typeof DSN.addCss === 'function') DSN.addCss('board', BOARD_CSS)
