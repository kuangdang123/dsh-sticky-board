/* ------------------------------------------------------------------ *
 * Priorities, checklists and comments.
 *
 * Three small surfaces that all hang off one note:
 *   - priority: a four-step scale, shown as a coloured pill that is also a
 *     native <select> so choosing one costs exactly one interaction;
 *   - tasks: a checklist with progress, edited in place or from the sheet;
 *   - comments: the "note about the note" thread, rendered with the same
 *     sanitizer and typography as the note body.
 * They live in their own fragment so 50-board.js only has to place them.
 * ------------------------------------------------------------------ */

;(function () {
  'use strict'

  DSN.addStrings({
    'priority.urgent': '紧急',
    'priority.high': '高',
    'priority.normal': '普通',
    'priority.low': '低',
    'priority.label': '优先级',
    'tab.tasks': '待办',
    'filter.sort': '排序',
    'filter.sortTime': '时间',
    'filter.sortPriority': '优先级',
    'filter.priority': '优先级',
    'filter.all': '全部',
    'filter.hideDone': '隐藏已完成',
    'filter.hideDoneHint': '隐藏所有待办都已勾选的便签',
    'task.add': '添加待办',
    'task.title': '待办',
    'task.placeholder': '添加一条待办，回车保存',
    'task.progress': '{done}/{total}',
    'task.clearDone': '清空已完成',
    'task.remove': '删除待办',
    'task.empty': '这条便签还没有待办',
    'task.note': '所属便签',
    'comment.title': '评论',
    'comment.placeholder': '写下评论，Enter 发送，Shift+Enter 换行',
    'comment.send': '发送',
    'comment.empty': '还没有评论',
    'comment.remove': '删除评论',
    'comment.author': '我',
    'comment.hint': 'Enter 发送 · Shift+Enter 换行',
    'detail.title': '便签详情',
    'detail.open': '打开评论与待办',
    'detail.close': '关闭详情',
    'detail.emptyTask': '还没有待办',
    'tasks.title': '待办',
    'tasks.openTasks': '{n} 条待办',
    'tasks.groupNote': '便签',
    'tasks.empty': '所有便签都没有未完成的待办',
    'tasks.summary': '{open} 条未完成 · {notes} 个便签',
    'tasks.emptySection': '这个分区还没有待办',
  }, {
    'priority.urgent': 'Urgent',
    'priority.high': 'High',
    'priority.normal': 'Normal',
    'priority.low': 'Low',
    'priority.label': 'Priority',
    'tab.tasks': 'To-dos',
    'filter.sort': 'Sort',
    'filter.sortTime': 'Time',
    'filter.sortPriority': 'Priority',
    'filter.priority': 'Priority',
    'filter.all': 'All',
    'filter.hideDone': 'Hide finished',
    'filter.hideDoneHint': 'Hide notes whose checklist is fully done',
    'task.add': 'Add to-do',
    'task.title': 'To-do',
    'task.placeholder': 'Add a to-do, press Enter',
    'task.progress': '{done}/{total}',
    'task.clearDone': 'Clear finished',
    'task.remove': 'Remove to-do',
    'task.empty': 'This note has no to-dos yet',
    'task.note': 'Note',
    'comment.title': 'Comments',
    'comment.placeholder': 'Write a comment — Enter sends, Shift+Enter breaks the line',
    'comment.send': 'Send',
    'comment.empty': 'No comments yet',
    'comment.remove': 'Remove comment',
    'comment.author': 'Me',
    'comment.hint': 'Enter sends · Shift+Enter breaks the line',
    'detail.title': 'Note details',
    'detail.open': 'Open comments and to-dos',
    'detail.close': 'Close details',
    'detail.emptyTask': 'No to-dos yet',
    'tasks.title': 'To-dos',
    'tasks.openTasks': '{n} open',
    'tasks.groupNote': 'Note',
    'tasks.empty': 'No open to-dos across all notes',
    'tasks.summary': '{open} open across {notes} notes',
    'tasks.emptySection': 'No to-dos in this section yet',
  })

  DSN.PRIORITY_META = {
    urgent: {
      token: 'var(--dsw-alias-label-error, #d9534f)',
      soft: 'color-mix(in srgb, var(--dsw-alias-label-error, #d9534f) 13%, transparent)',
    },
    high: {
      token: 'var(--dsw-alias-state-business-primary, #4176e6)',
      soft: 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 13%, transparent)',
    },
    normal: {
      token: 'var(--dsw-alias-label-secondary, #6b7280)',
      soft: 'color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 10%, transparent)',
    },
    low: {
      token: 'var(--dsw-alias-label-tertiary, #adb2b8)',
      soft: 'transparent',
    },
  }

  DSN.priorityMeta = function (priority) {
    return DSN.PRIORITY_META[priority] || DSN.PRIORITY_META.normal
  }

  function extraPrevent(event) {
    if (event && event.preventDefault) event.preventDefault()
  }

  function extraStop(event) {
    if (event && event.stopPropagation) event.stopPropagation()
  }

  /* ------------------------------------------------------------------ *
   * priority
   * ------------------------------------------------------------------ */

  /** Coloured read-only pill (used in the tasks view and the sheet header). */
  DSN.PriorityPill = function PriorityPill(props) {
    var t = props.t || DSN.fallbackT
    var priority = DSN.PRIORITY_RANK[props.priority] === undefined ? DSN.DEFAULT_PRIORITY : props.priority
    var meta = DSN.priorityMeta(priority)
    return h('span', {
      className: 'dsn-prio dsn-prio--' + priority + (props.className ? ' ' + props.className : ''),
      title: t('priority.label') + ' · ' + t('priority.' + priority),
      'data-priority': priority,
    },
      h('span', { className: 'dsn-prio-dot', 'aria-hidden': 'true' }),
      h('span', { className: 'dsn-prio-text' }, t('priority.' + priority)))
  }

  /**
   * Pill + native select: one click opens the four options, no custom popover
   * to position, and it stays keyboard reachable for free.
   */
  DSN.PrioritySelect = function PrioritySelect(props) {
    var t = props.t || DSN.fallbackT
    var note = props.note || {}
    var priority = DSN.PRIORITY_RANK[note.priority] === undefined ? DSN.DEFAULT_PRIORITY : note.priority
    var meta = DSN.priorityMeta(priority)
    var options = DSN.PRIORITIES.map(function (name) {
      return h('option', { key: name, value: name }, t('priority.' + name))
    })
    return h('label', {
      className: 'dsn-prio dsn-prio--' + priority + ' dsn-prio--pick' + (props.className ? ' ' + props.className : ''),
      title: t('priority.label'),
      'data-dsn-nodrag': '1',
      'data-priority': priority,
      onPointerDown: extraPrevent,
    },
      h('span', { className: 'dsn-prio-dot', 'aria-hidden': 'true' }),
      h('select', {
        className: 'dsn-prio-select',
        value: priority,
        'aria-label': t('priority.label'),
        'data-dsn-priority-select': '1',
        onChange: function (event) {
          var next = event.target.value
          if (props.store && props.store.actions) props.store.actions.setPriority(note.id, next)
        },
        onPointerDown: function (event) { event.stopPropagation() },
      }, options))
  }

  /* ------------------------------------------------------------------ *
   * checklist
   * ------------------------------------------------------------------ */

  DSN.TaskList = function TaskList(props) {
    var React = DSN.React
    var store = props.store
    var t = props.t || DSN.fallbackT
    var note = props.note || {}
    var tasks = Array.isArray(note.tasks) ? note.tasks : []
    var done = 0
    for (var i = 0; i < tasks.length; i += 1) if (tasks[i].done) done += 1
    var inputRef = React.useRef(null)

    function addFromInput() {
      var node = inputRef.current
      if (!node) return
      var value = String(node.value || '').trim()
      if (!value) return
      if (store.actions.addTask(note.id, value)) node.value = ''
      node.focus()
    }

    function onAddKeyDown(event) {
      if (event.key === 'Enter') {
        extraPrevent(event)
        extraStop(event)
        addFromInput()
      } else if (event.key === 'Escape') {
        extraStop(event)
        if (inputRef.current) inputRef.current.value = ''
      }
    }

    var rows = tasks.map(function (task) {
      return h('div', {
        key: task.id,
        className: 'dsn-task' + (task.done ? ' is-done' : ''),
        'data-dsn-nodrag': '1',
      },
        h('input', {
          className: 'dsn-task-check',
          type: 'checkbox',
          checked: task.done === true,
          'aria-label': task.text,
          onChange: function () { store.actions.toggleTask(note.id, task.id) },
        }),
        h('span', { className: 'dsn-task-text', title: task.text }, task.text),
        h('button', {
          type: 'button',
          className: 'dsn-task-remove',
          'aria-label': t('task.remove'),
          title: t('task.remove'),
          tabIndex: -1,
          onPointerDown: extraPrevent,
          onClick: function (event) {
            extraStop(event)
            store.actions.removeTask(note.id, task.id)
          },
        }, h(DSN.Icon, { name: 'close', size: 11 })))
    })

    var showTitle = !!props.sheet
    var head = (showTitle || tasks.length)
      ? h('div', { className: 'dsn-tasks-head' },
        showTitle ? h('span', { className: 'dsn-tasks-title' }, t('task.title')) : null,
        tasks.length
          ? h('span', { className: 'dsn-tasks-progress' }, t('task.progress', { done: done, total: tasks.length }))
          : null,
        tasks.length
          ? h('span', { className: 'dsn-tasks-bar', 'aria-hidden': 'true' },
            h('span', {
              className: 'dsn-tasks-bar-fill',
              style: { width: (tasks.length ? Math.round((done / tasks.length) * 100) : 0) + '%' },
            }))
          : null,
        done > 0
          ? h('button', {
            type: 'button',
            className: 'dsn-tasks-clear',
            'data-dsn-nodrag': '1',
            onPointerDown: extraPrevent,
            onClick: function (event) {
              extraStop(event)
              store.actions.clearDoneTasks(note.id)
            },
          }, t('task.clearDone'))
          : null)
      : null

    return h('div', { className: 'dsn-tasks' + (props.sheet ? ' dsn-tasks--sheet' : ''), 'data-dsn-nodrag': '1' },
      head,
      rows,
      h('div', { className: 'dsn-task-add' },
        h(DSN.Icon, { name: 'plus', size: 12 }),
        h('input', {
          ref: inputRef,
          className: 'dsn-task-input',
          type: 'text',
          placeholder: t('task.placeholder'),
          'aria-label': t('task.add'),
          spellCheck: false,
          'data-dsn-nodrag': '1',
          onKeyDown: onAddKeyDown,
        })))
  }

  /* ------------------------------------------------------------------ *
   * comments
   * ------------------------------------------------------------------ */

  DSN.CommentThread = function CommentThread(props) {
    var React = DSN.React
    var store = props.store
    var t = props.t || DSN.fallbackT
    var note = props.note || {}
    var comments = Array.isArray(note.comments) ? note.comments : []
    var draftRef = React.useRef(null)

    function send() {
      var node = draftRef.current
      if (!node) return
      var value = String(node.value || '').trim()
      if (!value) return
      var html = typeof DSN.textToHtml === 'function' ? DSN.textToHtml(value) : value
      var id = store.actions.addComment(note.id, html, value)
      if (!id) return
      node.value = ''
      node.focus()
      DSN.toast(t('comment.send'), 'info')
    }

    function onDraftKeyDown(event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        extraPrevent(event)
        extraStop(event)
        send()
      }
    }

    var rows = comments.map(function (comment) {
      var safe = ''
      try {
        safe = typeof DSN.sanitizeHtml === 'function' ? DSN.sanitizeHtml(comment.html || '') : ''
      } catch (error) {
        DSN.log('comment render failed', error)
      }
      return h('div', { key: comment.id, className: 'dsn-comment', 'data-dsn-nodrag': '1' },
        h('div', { className: 'dsn-comment-main' },
          h('div', { className: 'dsn-comment-head' },
            h('span', { className: 'dsn-comment-name' }, t('comment.author')),
            h('span', { className: 'dsn-comment-dot', 'aria-hidden': 'true' }, '·'),
            h('span', { className: 'dsn-comment-age' }, DSN.formatAge(comment.createdAt, t)),
            h('button', {
              type: 'button',
              className: 'dsn-comment-remove',
              'aria-label': t('comment.remove'),
              title: t('comment.remove'),
              tabIndex: -1,
              onPointerDown: extraPrevent,
              onClick: function (event) {
                extraStop(event)
                store.actions.removeComment(note.id, comment.id)
              },
            }, h(DSN.Icon, { name: 'close', size: 11 }))),
          h('div', { className: 'dsn-comment-body' },
            h(DSN.Content, { html: safe, kind: 'text' }))))
    })

    return h('div', { className: 'dsn-comments', 'data-dsn-comments': '1' },
      h('div', { className: 'dsn-comments-head' },
        h('span', { className: 'dsn-comments-title' }, t('comment.title')),
        h('span', { className: 'dsn-comments-count' }, String(comments.length))),
      comments.length
        ? h('div', { className: 'dsn-comment-list' }, rows)
        : h('p', { className: 'dsn-comments-empty' }, t('comment.empty')),
      h('div', { className: 'dsn-comment-form', 'data-dsn-nodrag': '1' },
        h('textarea', {
          ref: draftRef,
          className: 'dsn-comment-input',
          rows: 2,
          placeholder: t('comment.placeholder'),
          'aria-label': t('comment.title'),
          spellCheck: false,
          'data-dsn-nodrag': '1',
          onKeyDown: onDraftKeyDown,
          onPointerDown: function (event) { event.stopPropagation() },
        }),
        h('div', { className: 'dsn-comment-formbar' },
          h('span', { className: 'dsn-comment-hint' }, t('comment.hint')),
          h('button', {
            type: 'button',
            className: 'dsn-btn dsn-btn-tiny dsn-btn-primary',
            'data-dsn-nodrag': '1',
            onPointerDown: extraPrevent,
            onClick: function (event) {
              extraStop(event)
              send()
            },
          }, h('span', null, t('comment.send'))))))
  }

  /* ------------------------------------------------------------------ *
   * detail sheet — the full note: body, checklist, comments
   * ------------------------------------------------------------------ */

  DSN.NoteSheet = function NoteSheet(props) {
    var React = DSN.React
    var t = props.t || DSN.fallbackT
    var note = props.note
    if (!note) return null
    var store = props.store
    var cardRef = React.useRef(null)
    /* Focus the sheet so Escape lands here first: we preventDefault before the
       document handler sees the key, which keeps the panel itself open. */
    React.useEffect(function () {
      var node = cardRef.current
      if (!node) return undefined
      try {
        node.focus({ preventScroll: true })
      } catch (error) { /* older engines ignore the options object */ }
      function onKeyDown(event) {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        store.actions.setDetail(null)
      }
      node.addEventListener('keydown', onKeyDown)
      return function () { node.removeEventListener('keydown', onKeyDown) }
    }, [note.id])
    var safe = ''
    try {
      safe = typeof DSN.sanitizeHtml === 'function' ? DSN.sanitizeHtml(note.html || '') : ''
    } catch (error) {
      DSN.log('sheet sanitize failed', error)
    }
    var title = note.title || DSN.headline(note.text || '', 80) || t('detail.title')
    return h('div', {
      className: 'dsn-sheet',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': t('detail.title'),
      onPointerDown: function (event) { event.stopPropagation() },
    },
      h('div', { className: 'dsn-sheet-card', ref: cardRef, tabIndex: -1 },
        h('div', { className: 'dsn-sheet-head' },
          h('span', { className: 'dsn-sheet-title', title: title }, title),
          h(DSN.PrioritySelect, { store: store, t: t, note: note }),
          h('button', {
            type: 'button',
            className: 'dsn-sheet-close',
            'aria-label': t('detail.close'),
            title: t('detail.close'),
            onPointerDown: extraPrevent,
            onClick: function (event) {
              extraStop(event)
              store.actions.setDetail(null)
            },
          }, h(DSN.Icon, { name: 'close', size: 13 }))),
        h('div', { className: 'dsn-sheet-meta' },
          h('span', { className: 'dsn-comment-age' }, DSN.formatAge(note.updatedAt, t)),
          note.source && note.source.sessionTitle
            ? h('span', { className: 'dsn-chip dsn-note-source', title: note.source.sessionTitle },
              h(DSN.Icon, { name: 'note', size: 11 }),
              h('span', null, t('list.source', { name: note.source.sessionTitle })))
            : null),
        h('div', { className: 'dsn-sheet-body' },
          safe ? h('div', { className: 'dsn-sheet-content' }, h(DSN.Content, { html: safe, kind: note.kind })) : null,
          h(DSN.TaskList, { store: store, t: t, note: note, sheet: true }),
          h(DSN.CommentThread, { store: store, t: t, note: note }))))
  }

  /* ------------------------------------------------------------------ *
   * aggregated to-do view
   * ------------------------------------------------------------------ */

  DSN.TasksView = function TasksView(props) {
    var t = props.t || DSN.fallbackT
    var store = props.store
    var state = props.state || {}
    var ui = state.ui || {}
    var notes = Array.isArray(state.notes) ? state.notes : []
    var query = typeof ui.search === 'string' ? ui.search.toLowerCase() : ''
    var hideDone = ui.hideDone === true
    var sectionId = props.sectionId || ''
    var groups = []
    var openCount = 0
    var i
    var j

    for (i = 0; i < notes.length; i += 1) {
      var note = notes[i]
      if (!note || note.deletedAt) continue
      if (sectionId && note.sectionId !== sectionId) continue
      var tasks = Array.isArray(note.tasks) ? note.tasks : []
      if (!tasks.length) continue
      var rows = []
      var open = 0
      for (j = 0; j < tasks.length; j += 1) {
        if (hideDone && tasks[j].done) continue
        if (!tasks[j].done) open += 1
        rows.push({ note: note, task: tasks[j] })
      }
      if (!rows.length) continue
      if (query && String(note.text || '').toLowerCase().indexOf(query) < 0) {
        var matched = rows.filter(function (row) {
          return String(row.task.text || '').toLowerCase().indexOf(query) >= 0
        })
        rows = matched
        if (!rows.length) continue
      }
      openCount += open
      groups.push({ note: note, rows: rows, open: open })
    }

    groups.sort(function (a, b) {
      var rankA = DSN.PRIORITY_RANK[a.note.priority] || 0
      var rankB = DSN.PRIORITY_RANK[b.note.priority] || 0
      if (rankA !== rankB) return rankB - rankA
      return (b.note.updatedAt || 0) - (a.note.updatedAt || 0)
    })

    if (!groups.length) {
      return h('div', { className: 'dsn-tasksview' },
        h('div', { className: 'dsn-empty' },
          h('span', { className: 'dsn-empty-icon', 'aria-hidden': 'true' },
            h(DSN.Icon, { name: 'check', size: 20 })),
          h('p', { className: 'dsn-empty-text' }, t('tasks.empty'))))
    }

    return h('div', { className: 'dsn-tasksview', 'data-open-tasks': String(openCount) },
      h('div', { className: 'dsn-tasks-summary' },
        h(DSN.Icon, { name: 'check', size: 12 }),
        h('span', null, t('tasks.summary', { open: openCount, notes: groups.length }))),
      groups.map(function (group) {
        var note = group.note
        var title = note.title || DSN.headline(note.text || '', 48) || t('detail.title')
        return h('div', { key: note.id, className: 'dsn-tasksgroup' },
          h('button', {
            type: 'button',
            className: 'dsn-tasksgroup-title',
            title: t('detail.open'),
            onClick: function () { store.actions.setDetail(note.id) },
          },
            h(DSN.PriorityPill, { t: t, priority: note.priority }),
            h('span', { className: 'dsn-tasksgroup-label' }, title),
            h('span', { className: 'dsn-tasksgroup-count' }, t('tasks.openTasks', { n: group.open }))),
          group.rows.map(function (row) {
            return h('div', {
              key: row.task.id,
              className: 'dsn-task' + (row.task.done ? ' is-done' : ''),
            },
              h('input', {
                className: 'dsn-task-check',
                type: 'checkbox',
                checked: row.task.done === true,
                'aria-label': row.task.text,
                onChange: function () { store.actions.toggleTask(note.id, row.task.id) },
              }),
              h('span', { className: 'dsn-task-text' }, row.task.text))
          }))
      }))
  }

  /* ------------------------------------------------------------------ *
   * styles
   * ------------------------------------------------------------------ */

  DSN.addCss('extra', [
    /* priority pill */
    '.dsn-prio { display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto;',
    '  height: 18px; padding: 0 7px; border-radius: 999px; border: none;',
    '  background: transparent; color: var(--dsw-alias-label-secondary, #6b7280);',
    '  font-size: 11px; font-weight: 500; line-height: 18px; white-space: nowrap; }',
    '.dsn-prio--pick { cursor: pointer; position: relative; padding-right: 2px; }',
    '.dsn-prio--urgent { color: var(--dsw-alias-label-error, #d9534f); background: color-mix(in srgb, var(--dsw-alias-label-error, #d9534f) 13%, transparent); }',
    '.dsn-prio--high { color: var(--dsw-alias-state-business-primary, #4176e6); background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 13%, transparent); }',
    '.dsn-prio--normal { background: color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 10%, transparent); }',
    '.dsn-prio--low { color: var(--dsw-alias-label-tertiary, #adb2b8); background: transparent; }',
    '.dsn-prio-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: 0 0 auto; }',
    '.dsn-prio-text { max-width: 44px; overflow: hidden; text-overflow: ellipsis; }',
    '.dsn-prio-select { appearance: none; -webkit-appearance: none; border: 0; background: transparent;',
    '  color: inherit; font: inherit; padding: 0 10px 0 1px; margin: 0; cursor: pointer; outline: none; }',
    '.dsn-prio-select::-ms-expand { display: none; }',
    '.dsn-prio::after { content: ""; width: 0; height: 0; border-left: 3px solid transparent;',
    '  border-right: 3px solid transparent; border-top: 4px solid currentColor; opacity: 0.7; }',
    '.dsn-prio--pick { padding-right: 6px; gap: 4px; }',
    /* checklist */
    '.dsn-tasks { display: flex; flex-direction: column; gap: 2px; padding: 6px 0 0; }',
    '.dsn-tasks--sheet { padding-top: 10px; border-top: 1px solid var(--dsw-alias-border-l2, rgba(11,12,15,0.08)); margin-top: 10px; }',
    '.dsn-tasks-head { display: flex; align-items: center; gap: 6px; padding: 0 2px 4px; }',
    '.dsn-tasks-title { flex: 0 0 auto; font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary, #6b7280); letter-spacing: 0.02em; }',
    '.dsn-tasks-progress { font-size: 10.5px; color: var(--dsw-alias-label-tertiary, #adb2b8); flex: 0 0 auto; }',
    '.dsn-tasks-bar { flex: 1 1 auto; height: 3px; border-radius: 2px; background: color-mix(in srgb, var(--dsw-alias-label-primary, #0f1115) 10%, transparent); overflow: hidden; }',
    '.dsn-tasks-bar-fill { display: block; height: 100%; border-radius: 2px; background: var(--dsw-alias-state-business-primary, #4176e6); transition: width 160ms ease; }',
    '.dsn-tasks-clear { border: 0; background: transparent; color: var(--dsw-alias-label-tertiary, #adb2b8);',
    '  font-size: 10.5px; cursor: pointer; padding: 2px 4px; border-radius: 4px; }',
    '.dsn-tasks-clear:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(15,17,21,0.06)); color: var(--dsw-alias-label-secondary, #6b7280); }',
    '.dsn-task { display: flex; align-items: flex-start; gap: 6px; padding: 2px 2px; border-radius: 5px; }',
    '.dsn-task:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(15,17,21,0.04)); }',
    '.dsn-task-check { width: 13px; height: 13px; margin: 2px 0 0; flex: 0 0 auto; accent-color: var(--dsw-alias-state-business-primary, #4176e6); cursor: pointer; }',
    '.dsn-task-text { flex: 1 1 auto; font-size: 12px; line-height: 1.55; color: var(--dsw-alias-label-primary, #0f1115);',
    '  word-break: break-word; min-width: 0; }',
    '.dsn-task.is-done .dsn-task-text { color: var(--dsw-alias-label-tertiary, #adb2b8); text-decoration: line-through; }',
    '.dsn-task-remove { flex: 0 0 auto; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center;',
    '  border: 0; background: transparent; color: var(--dsw-alias-label-tertiary, #adb2b8); opacity: 0; cursor: pointer;',
    '  border-radius: 4px; padding: 0; }',
    '.dsn-task:hover .dsn-task-remove, .dsn-task-remove:focus-visible { opacity: 1; }',
    '.dsn-task-add { display: flex; align-items: center; gap: 6px; padding: 3px 2px 0; color: var(--dsw-alias-label-tertiary, #adb2b8); }',
    '.dsn-task-input { flex: 1 1 auto; border: 0; background: transparent; outline: none; font-size: 12px;',
    '  color: var(--dsw-alias-label-primary, #0f1115); padding: 3px 0; min-width: 0; }',
    '.dsn-task-input::placeholder { color: var(--dsw-alias-label-tertiary, #adb2b8); }',
    /* comments */
    '.dsn-comments { display: flex; flex-direction: column; gap: 6px; padding: 10px 0 0; margin-top: 10px;',
    '  border-top: 1px solid var(--dsw-alias-border-l2, rgba(11,12,15,0.08)); }',
    '.dsn-comments-head { display: flex; align-items: center; gap: 6px; }',
    '.dsn-comments-title { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary, #6b7280); letter-spacing: 0.02em; }',
    '.dsn-comments-count { font-size: 10.5px; color: var(--dsw-alias-label-tertiary, #adb2b8); }',
    '.dsn-comments-empty { margin: 0; font-size: 11.5px; color: var(--dsw-alias-label-tertiary, #adb2b8); }',
    '.dsn-comment-list { display: flex; flex-direction: column; gap: 8px; }',
    '.dsn-comment { display: flex; gap: 7px; align-items: flex-start; }',
    '.dsn-comment-main { flex: 1 1 auto; min-width: 0; }',
    '.dsn-comment-head { display: flex; align-items: center; gap: 5px; }',
    '.dsn-comment-name { font-size: 11.5px; font-weight: 600; color: var(--dsw-alias-label-primary, #0f1115); }',
    '.dsn-comment-dot { font-size: 10.5px; color: var(--dsw-alias-label-tertiary, #adb2b8); }',
    '.dsn-comment-age { font-size: 10.5px; color: var(--dsw-alias-label-tertiary, #adb2b8); }',
    '.dsn-comment-remove { margin-left: auto; width: 16px; height: 16px; border: 0; background: transparent;',
    '  color: var(--dsw-alias-label-tertiary, #adb2b8); opacity: 0; cursor: pointer; border-radius: 4px; padding: 0;',
    '  display: inline-flex; align-items: center; justify-content: center; }',
    '.dsn-comment:hover .dsn-comment-remove { opacity: 1; }',
    '.dsn-comment-body { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-primary, #0f1115); word-break: break-word; }',
    '.dsn-comment-body .dsn-content { font-size: 12px; line-height: 1.6; }',
    '.dsn-comment-form { display: flex; flex-direction: column; gap: 4px; padding-top: 2px; }',
    '.dsn-comment-input { width: 100%; box-sizing: border-box; resize: vertical; min-height: 44px; max-height: 140px;',
    '  border: 1px solid var(--dsw-alias-border-l2, rgba(11,12,15,0.12)); border-radius: 8px; padding: 6px 8px;',
    '  font-size: 12px; line-height: 1.55; color: var(--dsw-alias-label-primary, #0f1115);',
    '  background: var(--dsw-alias-bg-layer-1, #fff); outline: none; font-family: inherit; }',
    '.dsn-comment-input:focus { border-color: var(--dsw-alias-border-l4, rgba(15,17,21,0.3)); }',
    '.dsn-comment-input::placeholder { color: var(--dsw-alias-label-tertiary, #adb2b8); }',
    '.dsn-comment-formbar { display: flex; align-items: center; gap: 6px; }',
    '.dsn-comment-hint { flex: 1 1 auto; font-size: 10px; color: var(--dsw-alias-label-tertiary, #adb2b8); }',
    /* detail sheet */
    '.dsn-sheet { position: absolute; inset: 0; z-index: 6; display: flex; align-items: flex-start; justify-content: center;',
    '  padding: 8px; background: var(--dsw-alias-bg-mask-1, rgba(15,17,21,0.3)); }',
    '.dsn-sheet-card { flex: 0 1 auto; display: flex; flex-direction: column; min-height: 0; max-height: 100%;',
    '  border-radius: 12px; border: 1px solid var(--dsw-alias-border-l2, rgba(11,12,15,0.1));',
    '  background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: var(--dsw-elevation-panel, 0 12px 32px rgba(0,0,0,0.18));',
    '  overflow: hidden; outline: none; }',
    '.dsn-sheet-card:focus, .dsn-sheet-card:focus-visible { outline: none; }',
    '.dsn-sheet-head { display: flex; align-items: center; gap: 8px; padding: 9px 10px 7px; }',
    '.dsn-sheet-title { flex: 1 1 auto; min-width: 0; font-size: 13px; font-weight: 600;',
    '  color: var(--dsw-alias-label-primary, #0f1115); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.dsn-sheet-close { flex: 0 0 auto; width: 22px; height: 22px; border: 0; background: transparent; padding: 0;',
    '  border-radius: 6px; color: var(--dsw-alias-label-secondary, #6b7280); cursor: pointer;',
    '  display: inline-flex; align-items: center; justify-content: center; }',
    '.dsn-sheet-close:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(15,17,21,0.06)); }',
    '.dsn-sheet-meta { display: flex; align-items: center; gap: 6px; padding: 0 10px 8px; flex-wrap: wrap; }',
    '.dsn-sheet-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 0 10px 12px; }',
    '.dsn-sheet-content { font-size: 12.5px; }',
    /* aggregated to-do view */
    '.dsn-tasksview { display: flex; flex-direction: column; gap: 10px; padding: 2px 0 6px; }',
    '.dsn-tasks-summary { display: flex; align-items: center; gap: 5px; padding: 0 2px;',
    '  font-size: 11px; color: var(--dsw-alias-label-tertiary, #adb2b8); }',
    '.dsn-tasksgroup { display: flex; flex-direction: column; gap: 1px; }',
    '.dsn-tasksgroup-title { display: flex; align-items: center; gap: 6px; width: 100%; box-sizing: border-box;',
    '  border: 0; background: transparent; padding: 3px 2px; border-radius: 6px; cursor: pointer; text-align: left; }',
    '.dsn-tasksgroup-title:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(15,17,21,0.04)); }',
    '.dsn-tasksgroup-label { flex: 1 1 auto; min-width: 0; font-size: 11.5px; font-weight: 600;',
    '  color: var(--dsw-alias-label-secondary, #6b7280); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.dsn-tasksgroup-count { flex: 0 0 auto; font-size: 10.5px; color: var(--dsw-alias-label-tertiary, #adb2b8); }',
    /* card meta chips */
    '.dsn-note-meta { display: flex; align-items: center; gap: 5px; padding: 2px 0 0; flex-wrap: wrap; }',
    '.dsn-chip--btn { border: 0; cursor: pointer; background: color-mix(in srgb, var(--dsw-alias-label-primary, #0f1115) 6%, transparent);',
    '  color: var(--dsw-alias-label-secondary, #6b7280); font: inherit; }',
    '.dsn-chip--btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(15,17,21,0.08)); color: var(--dsw-alias-label-primary, #0f1115); }',
    '.dsn-chip--warn { color: var(--dsw-alias-state-business-primary, #4176e6);',
    '  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 12%, transparent); }',
    '.dsn-chip--warn:hover { background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 20%, transparent); color: var(--dsw-alias-state-business-primary, #4176e6); }',
    /* filters row */
    '.dsn-filters { display: flex; align-items: center; gap: 5px; padding: 0 12px 8px; flex-wrap: wrap; }',
    '.dsn-filter-group { display: inline-flex; align-items: center; gap: 3px; height: 22px; padding: 0 4px 0 6px;',
    '  border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-label-primary, #0f1115) 5%, transparent); }',
    '.dsn-filter-label { font-size: 10.5px; color: var(--dsw-alias-label-tertiary, #adb2b8); }',
    '.dsn-filter-select { appearance: none; -webkit-appearance: none; border: 0; background: transparent;',
    '  color: var(--dsw-alias-label-secondary, #6b7280); font: inherit; font-size: 11px; padding: 0 9px 0 1px;',
    '  margin: 0; cursor: pointer; outline: none; }',
    '.dsn-filter-group::after { content: ""; width: 0; height: 0; border-left: 3px solid transparent;',
    '  border-right: 3px solid transparent; border-top: 4px solid var(--dsw-alias-label-tertiary, #adb2b8); margin-left: -6px; pointer-events: none; }',
    '.dsn-filter-toggle { height: 22px; padding: 0 8px; border-radius: 999px; border: 0; cursor: pointer;',
    '  background: color-mix(in srgb, var(--dsw-alias-label-primary, #0f1115) 5%, transparent);',
    '  color: var(--dsw-alias-label-secondary, #6b7280); font-size: 11px; }',
    '.dsn-filter-toggle.is-on { background: var(--dsw-alias-label-primary, #0f1115); color: var(--dsw-alias-label-primary-inverted, #fff); }',
    '.dsn-filter-toggle:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(15,17,21,0.08)); }',
  ].join('\n'))
})()