/* Scripted real-browser self-test for the sticky-notes bundle.
 *
 * Loaded by index.html when the URL carries `?selftest=1`. It drives the real
 * panel with synthetic DOM events (no jsdom), writes one JSON result object
 * into <pre id="harness-test">, and sets document.title to
 * `SELFTEST <passed>/<total>` so a headless Chrome dump can assert on it.
 *
 * Every case is a function returning nothing; throwing means "failed".
 */
(function () {
  'use strict'

  var H = window.__HARNESS__
  var store = H.store
  var t = H.t
  var h = H.h
  var results = []
  var started = Date.now()

  function q(selector, root) { return (root || document).querySelector(selector) }
  function qa(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector))
  }
  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms) }) }

/* Drag affordances paint on the next animation frame; virtual time fast-forwards
 * timers without producing frames, so wait for a real frame before asserting. */
function frame() {
  return new Promise(function (resolve) {
    var done = false
    var finish = function () { if (!done) { done = true; resolve() } }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(finish)
    setTimeout(finish, 200)
  })
}
  function assert(condition, message) {
    if (!condition) throw new Error(message || 'assertion failed')
  }
  function snapshot() { return store.getSnapshot() }
  function liveNotes() {
    return snapshot().notes.filter(function (note) { return !note.deletedAt })
  }
  function trashedNotes() {
    return snapshot().notes.filter(function (note) { return !!note.deletedAt })
  }
  function byLabel(label) {
    return qa('[aria-label]').filter(function (node) { return node.getAttribute('aria-label') === label })
  }
  function click(node) {
    assert(node, 'target node missing')
    node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
    node.click()
  }
  function clickLabel(label) {
    var nodes = byLabel(label)
    assert(nodes.length, 'no element labelled ' + label)
    click(nodes[0])
  }
  function setEditable(node, html) {
    assert(node, 'editable node missing')
    node.focus()
    node.innerHTML = html
    node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '' }))
  }
  function setInput(node, value) {
    assert(node, 'input node missing')
    var proto = node.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    var setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    setter.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  }
  /* React listens to `change` on <select>, so both events are dispatched. */
  function selectValue(node, value) {
    assert(node, 'select node missing')
    var setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
    setter.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
    node.dispatchEvent(new Event('change', { bubbles: true }))
  }
  function noteById(id) {
    var notes = snapshot().notes
    for (var i = 0; i < notes.length; i += 1) if (notes[i].id === id) return notes[i]
    return null
  }
  function panelOpen() { return !!snapshot().ui.open }
  function openPanel() {
    if (!panelOpen()) store.actions.setOpen(true)
  }
  function chips() { return qa('.dsn-section-chip') }
  function cards() { return qa('.dsn-stream .dsn-note') }

  async function step(name, fn) {
    try {
      await fn()
      results.push({ name: name, ok: true })
    } catch (error) {
      results.push({ name: name, ok: false, error: String((error && error.message) || error) })
    }
  }

  function finish() {
    var passed = results.filter(function (item) { return item.ok }).length
    var box = document.createElement('pre')
    box.id = 'harness-test'
    box.textContent = JSON.stringify({
      passed: passed,
      total: results.length,
      elapsed: Date.now() - started,
      results: results,
    })
    document.body.appendChild(box)
    document.title = 'SELFTEST ' + passed + '/' + results.length
  }

  async function run() {
    await sleep(250)

    /* ------------------------------------------------ composer → new note */
    await step('composer saves a note', async function () {
      openPanel()
      await sleep(120)
      var editor = q('.dsn-composer .dsn-editor')
      var before = liveNotes().length
      setEditable(editor, '<p>自测新增便签 SELFTEST-MARK</p>')
      await sleep(220)
      var save = q('.dsn-composer button.dsn-btn-primary')
      assert(save && !save.disabled, 'save button disabled after typing')
      click(save)
      await sleep(160)
      var after = liveNotes()
      assert(after.length === before + 1, 'note count did not grow: ' + before + ' → ' + after.length)
      assert(after[0].text.indexOf('SELFTEST-MARK') >= 0, 'new note text missing')
      assert(cards().length >= 1, 'card not rendered')
    })

    /* -------------------------------------------------------- pin toggle */
    await step('pin toggles from the card head', async function () {
      var card = cards().filter(function (node) {
        var note = snapshot().notes.filter(function (item) { return item.id === node.getAttribute('data-note-id') })[0]
        return note && !note.pinned
      })[0]
      assert(card, 'no unpinned card to pin')
      var id = card.getAttribute('data-note-id')
      function cardById(noteId) {
        return cards().filter(function (node) { return node.getAttribute('data-note-id') === noteId })[0]
      }
      function actionIn(node, label) {
        var buttons = node ? node.querySelectorAll('button[aria-label]') : []
        var labels = Array.prototype.map.call(buttons, function (b) { return b.getAttribute('aria-label') })
        var button = node && node.querySelector('button[aria-label="' + label + '"]')
        assert(button, 'no "' + label + '" button inside card ' + (node && node.getAttribute('data-note-id')) +
          ' (found: ' + labels.join(',') + ')')
        return button
      }
      var calls = []
      var original = store.actions.togglePin
      store.actions.togglePin = function (noteId) { calls.push(noteId); return original(noteId) }
      try {
        click(actionIn(card, t('note.pin')))
        await sleep(160)
        assert(calls.length === 1, 'pin click should call togglePin once, got ' + calls.length)
        assert(calls[0] === id, 'pin click hit ' + calls[0] + ' instead of ' + id)
        var note = snapshot().notes.filter(function (item) { return item.id === id })[0]
        assert(note && note.pinned === true, 'store did not mark the note pinned')
        assert(cardById(id).className.indexOf('is-pinned') >= 0, 'card missing is-pinned')
        assert(!!q('.dsn-note-flag'), 'pinned flag pill missing')
        calls.length = 0
        click(actionIn(cardById(id), t('note.unpin')))
        await sleep(220)
        var pinnedIds = snapshot().notes.filter(function (item) { return item.pinned }).map(function (item) { return item.id })
        assert(calls.length === 1, 'unpin click should call togglePin once, got ' + calls.length)
        var after = snapshot().notes.filter(function (item) { return item.id === id })[0]
        assert(after.pinned === false,
          'unpin did not take effect (cardId=' + id + ', called=' + calls.join('|') + ', pinnedIds=' + pinnedIds.join('|') + ')')
      } finally {
        store.actions.togglePin = original
      }
    })

    /* ------------------------------------------------------ inline editor */
    await step('card edit updates the note', async function () {
      var card = cards()[0]
      assert(card, 'no card to edit')
      var id = card.getAttribute('data-note-id')
      var editButton = card.querySelector('button[aria-label="' + t('note.edit') + '"]')
      assert(editButton, 'edit button missing in card ' + id)
      click(editButton)
      await sleep(220)
      card = cards().filter(function (node) { return node.getAttribute('data-note-id') === id })[0]
      var editor = card && card.querySelector('.dsn-note-edit .dsn-editor')
      assert(editor, 'edit editor did not appear')
      setEditable(editor, '<p>EDITED-BY-SELFTEST</p>')
      await sleep(220)
      var saveButton = card.querySelector('.dsn-note-editbar .dsn-btn-primary')
      assert(saveButton, 'no save button in the inline editor bar')
      assert(!saveButton.disabled, 'save button is disabled after typing')
      click(saveButton)
      await sleep(200)
      var note = snapshot().notes.filter(function (item) { return item.id === id })[0]
      assert(note && note.html.indexOf('EDITED-BY-SELFTEST') >= 0, 'note html not updated')
    })

    /* -------------------------------------------------- keyboard shortcuts */
    await step('Escape closes the panel', async function () {
      openPanel()
      await sleep(80)
      // A focused contenteditable correctly swallows Escape, so the card has to
      // be the focused surface — exactly like a user who just stopped editing.
      var active = document.activeElement
      if (active && active !== document.body && typeof active.blur === 'function') active.blur()
      var header = q('.dsn-panel .dsn-header') || q('.dsn-panel')
      if (header) header.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
      await sleep(60)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await sleep(180)
      assert(!panelOpen(), 'Escape did not close the panel')
    })

    await step('Alt+Shift+N toggles the panel', async function () {
      if (panelOpen()) store.actions.setOpen(false)
      await sleep(120)
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'N', code: 'KeyN', altKey: true, shiftKey: true, bubbles: true,
      }))
      await sleep(180)
      assert(panelOpen() === true, 'shortcut did not open the panel')
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'N', code: 'KeyN', altKey: true, shiftKey: true, bubbles: true,
      }))
      await sleep(180)
      assert(panelOpen() === false, 'shortcut did not close the panel')
      openPanel()
      await sleep(100)
    })

    /* ------------------------------------------------------- search filter */
    await step('search filters the stream', async function () {
      openPanel()
      await sleep(80)
      var input = q('.dsn-search-input') || q('input[type="search"]') || q('.dsn-toolbar input')
      assert(input, 'search input missing')
      var all = cards().length
      assert(all >= 2, 'need at least two cards to filter, got ' + all)
      setInput(input, 'SELFTEST')
      await sleep(200)
      var filtered = cards().length
      assert(filtered < all, 'search did not filter: ' + all + ' → ' + filtered)
      setInput(input, '')
      await sleep(200)
      assert(cards().length === all, 'clearing search did not restore the stream')
    })

    /* -------------------------------------------------------- new section */
    await step('section can be added and removed', async function () {
      var before = snapshot().sections.length
      clickLabel(t('section.add'))
      await sleep(120)
      var input = q('.dsn-board-chip-input')
      assert(input, 'section name input did not appear')
      setInput(input, '自测分区')
      await sleep(80)
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await sleep(180)
      var sections = snapshot().sections
      assert(sections.length === before + 1, 'section count not incremented')
      var created = sections[sections.length - 1]
      assert(created.name === '自测分区', 'section name wrong: ' + created.name)
      assert(chips().some(function (chip) { return chip.textContent.indexOf('自测分区') >= 0 }),
        'new section chip not rendered')
      store.actions.deleteSection(created.id)
      await sleep(120)
      assert(snapshot().sections.length === before, 'section was not removed')
    })

    /* ---------------------------------------- composer saves and clears */
    await step('the composer clears after saving with Ctrl+Enter', async function () {
      openPanel()
      await sleep(80)
      var editor = q('.dsn-composer [contenteditable="true"]')
      assert(editor, 'composer editor missing')
      var before = liveNotes().length
      editor.focus()
      editor.innerHTML = '<p>自测草稿</p>'
      editor.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(200)
      editor.focus()
      editor.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', ctrlKey: true, bubbles: true, cancelable: true,
      }))
      await sleep(200)
      assert(liveNotes().length === before + 1,
        'Ctrl+Enter did not save a note: ' + before + ' → ' + liveNotes().length)
      assert(editor.textContent.replace(/\s+/g, '') === '',
        'composer still shows text: ' + JSON.stringify(editor.innerHTML))
      assert(document.activeElement === editor, 'composer lost focus after saving')
      var saved = liveNotes().filter(function (note) { return String(note.text).indexOf('自测草稿') >= 0 })[0]
      assert(saved, 'the saved note is missing from the store')
      store.actions.purgeNote(saved.id)
      await sleep(100)
    })

    /* --------------------------------------------------------------- trash */
    await step('delete moves a note to trash and restore brings it back', async function () {
      openPanel()
      await sleep(80)
      var card = cards()[0]
      var id = card.getAttribute('data-note-id')
      var live = liveNotes().length
      clickLabel(t('note.delete'))
      await sleep(160)
      assert(liveNotes().length === live - 1, 'note was not removed from the board')
      assert(trashedNotes().length >= 1, 'note did not land in the trash')
      var trashTab = qa('.dsn-tab').filter(function (node) { return node.textContent.indexOf(t('tab.trash')) >= 0 })[0]
      assert(trashTab, 'trash tab missing')
      click(trashTab)
      await sleep(180)
      assert(q('.dsn-board-trash'), 'trash view did not render')
      clickLabel(t('note.restore'))
      await sleep(160)
      var restored = snapshot().notes.filter(function (item) { return item.id === id })[0]
      assert(restored && !restored.deletedAt, 'restore did not clear deletedAt')
      var boardTab = qa('.dsn-tab').filter(function (node) { return node.textContent.indexOf(t('tab.all')) >= 0 })[0]
      if (boardTab) click(boardTab)
      await sleep(160)
    })

    /* --------------------------------------------- drag a card to the trash */
    await step('dragging a card onto the trash zone deletes it', async function () {
      openPanel()
      await sleep(80)
      var card = cards()[0]
      assert(card, 'no card to drag')
      var id = card.getAttribute('data-note-id')
      var live = liveNotes().length
      var dataTransfer = new DataTransfer()
      card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dataTransfer }))
      await sleep(140)
      assert(dataTransfer.getData('application/x-dsn-note') === id, 'dragstart did not publish the note id')
      var zone = q('.dsn-dropzone')
      assert(zone, 'trash drop zone did not appear during the drag')
      zone.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dataTransfer }))
      zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dataTransfer }))
      zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dataTransfer }))
      card.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dataTransfer }))
      await sleep(200)
      assert(liveNotes().length === live - 1, 'dropping on the trash zone did not delete the note')
    })

    /* ------------------------------------- drag a card onto another section */
    await step('dragging a card onto a section chip moves it', async function () {
      var sections = snapshot().sections
      assert(sections.length >= 2, 'need two sections')
      var target = sections.filter(function (item) { return item.id !== snapshot().ui.activeSectionId })[0]
      var card = qa('.dsn-stream .dsn-note').filter(function (node) {
        var note = snapshot().notes.filter(function (item) { return item.id === node.getAttribute('data-note-id') })[0]
        return note && note.sectionId !== target.id && !note.deletedAt
      })[0]
      assert(card, 'no card outside the target section')
      var id = card.getAttribute('data-note-id')
      var dataTransfer = new DataTransfer()
      card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dataTransfer }))
      await sleep(120)
      var chip = chips().filter(function (node) { return node.textContent.indexOf(target.name) >= 0 })[0]
      assert(chip, 'target section chip missing')
      chip.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dataTransfer }))
      chip.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dataTransfer }))
      chip.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dataTransfer }))
      card.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dataTransfer }))
      await sleep(200)
      var moved = snapshot().notes.filter(function (item) { return item.id === id })[0]
      assert(moved && moved.sectionId === target.id, 'note did not move to ' + target.name)
    })

    /* ------------------------- drag a note into the composer */
    await step('dragging a note onto the composer inserts it', async function () {
      openPanel()
      await sleep(80)
      var harness = window.__HARNESS__
      assert(harness && harness.composer && harness.composer.input, 'harness composer missing')
      harness.composer.reset()
      var card = qa('.dsn-stream .dsn-note').filter(function (node) {
        return (node.textContent || '').indexOf('generateView') >= 0
      })[0]
      assert(card, 'code note card missing')
      var dataTransfer = new DataTransfer()
      card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dataTransfer }))
      await sleep(140)
      assert(dataTransfer.getData('application/x-dsn-note'), 'dragstart published no note id')
      assert(dataTransfer.getData('text/html').indexOf('<pre>') >= 0, 'dragstart published no rich html')
      var input = harness.composer.input
      var over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dataTransfer })
      input.dispatchEvent(over)
      await frame()
      await sleep(40)
      assert(over.defaultPrevented, 'the composer did not accept the note drag')
      var ring = q('.dsn-drop-ring')
      assert(ring && ring.style.opacity === '1', 'the drop ring did not appear')
      assert(q('.dsn-drop-hint') && q('.dsn-drop-hint').textContent.length > 0, 'the drop hint did not appear')
      var drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dataTransfer })
      input.dispatchEvent(drop)
      card.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dataTransfer }))
      await sleep(260)
      var text = harness.composer.text()
      assert(text.length > 0, 'the composer stayed empty after the drop')
      assert(text.indexOf('generateView') >= 0, 'the dropped note body is missing: ' + text)
      assert(text.indexOf('```') === 0 || text.indexOf('```') > 0, 'the dropped note lost its markdown fence: ' + text)
      assert(!ring.style.opacity || ring.style.opacity === '0', 'the drop ring stayed visible after the drop')
    })

    /* ------------------- dropping a note outside the composer pops it out */
    await step('dropping a note outside the composer pops it out', async function () {
      openPanel()
      await sleep(80)
      var floaters = window.__HARNESS__.floaters
      assert(floaters, 'floater helpers missing')
      var before = floaters.list().length
      assert(floaters.popOut(0), 'no card to drag')
      await sleep(280)
      var windows = floaters.list()
      assert(windows.length === before + 1, 'no detached window appeared: ' + windows.length)
      assert(floaters.notes().length === before + 1, 'the window was not stored in the document')
      var latest = windows[windows.length - 1]
      assert(latest.getAttribute('data-dsn-float'), 'the window carries no note id')
      assert((latest.textContent || '').length > 4, 'the detached window rendered no content')
      assert(q('#fake-transcript, .bubble') !== null, 'sanity: transcript target still present')
    })

    /* ------------------------------- a detached window drags, collapses, closes */
    await step('a detached window can be moved, collapsed and closed', async function () {
      var floaters = window.__HARNESS__.floaters
      var win = floaters.list()[0]
      assert(win, 'no detached window to drive')
      var noteId = win.getAttribute('data-dsn-float')
      var entry = floaters.notes().filter(function (item) { return item.noteId === noteId })[0]
      assert(entry, 'no geometry entry for the window')
      var startX = entry.x
      var startY = entry.y
      var head = win.querySelector('.dsn-float-head')
      assert(head, 'window header missing')
      head.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, pointerId: 7, button: 0, clientX: 300, clientY: 300, isPrimary: true,
      }))
      head.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, cancelable: true, pointerId: 7, button: 0, clientX: 360, clientY: 350, isPrimary: true,
      }))
      await sleep(60)
      head.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, cancelable: true, pointerId: 7, button: 0, clientX: 360, clientY: 350, isPrimary: true,
      }))
      await sleep(200)
      var moved = floaters.notes().filter(function (item) { return item.noteId === noteId })[0]
      assert(moved && (Math.abs(moved.x - startX) > 20 || Math.abs(moved.y - startY) > 20),
        'dragging the header did not move the window: ' + JSON.stringify(moved))
      var collapseBtn = win.querySelector('.dsn-float-btn[aria-label="' + t(entry.collapsed ? 'float.expand' : 'float.collapse') + '"]')
      assert(collapseBtn, 'collapse button missing')
      click(collapseBtn)
      await sleep(160)
      var collapsedEntry = floaters.notes().filter(function (item) { return item.noteId === noteId })[0]
      assert(collapsedEntry && collapsedEntry.collapsed === true, 'the window did not collapse')
      assert(q('.dsn-float.is-collapsed'), 'the collapsed class is missing')
      var closeBtn = q('.dsn-float .dsn-float-btn[aria-label="' + t('float.close') + '"]')
      assert(closeBtn, 'close button missing')
      click(closeBtn)
      await sleep(200)
      assert(!floaters.list().some(function (node) { return node.getAttribute('data-dsn-float') === noteId }),
        'closing did not remove the window')
    })

    /* ----------------------------------------- two notes float side by side */
    await step('two notes can float side by side', async function () {
      openPanel()
      await sleep(60)
      var floaters = window.__HARNESS__.floaters
      floaters.popOut(0)
      await sleep(200)
      floaters.popOut(1)
      await sleep(220)
      var windows = floaters.list()
      assert(windows.length >= 2, 'expected two detached windows, got ' + windows.length)
      var zIndexes = windows.map(function (node) { return Number(node.style.zIndex) || 0 })
      assert(zIndexes[zIndexes.length - 1] > zIndexes[0], 'the newest window is not on top: ' + zIndexes.join(','))
      var lefts = windows.map(function (node) { return parseFloat(node.style.left) || 0 })
      assert(new Set(lefts).size > 1 || windows.length === 1, 'windows stack exactly on top of each other: ' + lefts.join(','))
    })


    await step('dropping dragged text creates a note', async function () {
      openPanel()
      await sleep(80)
      var before = liveNotes().length
      var board = q('.dsn-app')
      assert(board, 'board root missing')
      var dataTransfer = new DataTransfer()
      dataTransfer.setData('text/plain', '从对话里拖进来的结论：便签要能跨会话搬运。')
      board.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dataTransfer }))
      board.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dataTransfer }))
      board.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dataTransfer }))
      await sleep(400)
      var notes = liveNotes()
      assert(notes.length === before + 1, 'dropping text did not create a note')
      assert(notes.some(function (note) { return note.text.indexOf('跨会话搬运') >= 0 }), 'dropped text was not stored')
    })


    /* ----------------------------------------------- selection → save chip */
    await step('selection chip waits for the pointer to be released', async function () {
      openPanel()
      await sleep(80)
      var evidence = document.getElementById('evidence')
      assert(evidence, 'evidence paragraph missing')
      document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
      document.dispatchEvent(new Event('selectstart', { bubbles: true, cancelable: true }))
      var range = document.createRange()
      range.selectNodeContents(evidence)
      var selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange', { bubbles: true }))
      await sleep(360)
      var midDrag = q('.dsn-capture-chip')
      assert(!midDrag || midDrag.style.display === 'none',
        'chip appeared while the pointer was still down')
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
      await sleep(420)
      var released = q('.dsn-capture-chip')
      assert(released && released.style.display !== 'none',
        'chip did not appear after the pointer was released')
    })

    await step('selection chip saves the selected text', async function () {
      openPanel()
      await sleep(80)
      var evidence = document.getElementById('evidence')
      assert(evidence, 'evidence paragraph missing')
      var range = document.createRange()
      range.selectNodeContents(evidence)
      var selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange', { bubbles: true }))
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
      await sleep(320)
      var chip = q('.dsn-chip-layer button') || q('.dsn-capture-chip')
      assert(chip, 'capture chip did not appear for a selection')
      var before = liveNotes().length
      click(chip)
      await sleep(320)
      assert(liveNotes().length === before + 1, 'chip did not save a note')
      assert(liveNotes()[0].text.indexOf('跨对话复用') >= 0, 'saved note lost the selected text')
    })

    /* -------------------------------- chat selection surface (quote + save) */
    await step('chat surface offers quote and save actions', async function () {
      openPanel()
      await sleep(80)
      var mounted = H.surface.mount({ text: 'surface selection text' })
      assert(mounted && mounted.host, 'surface host missing')
      await sleep(160)
      var buttons = qa('.dsn-surface-btn', mounted.host)
      assert(buttons.length === 2, 'expected two surface actions, got ' + buttons.length)
      var labels = buttons.map(function (node) { return node.getAttribute('aria-label') })
      assert(labels.indexOf(t('capture.quote')) >= 0, 'quote action missing: ' + labels.join('|'))
      assert(labels.indexOf(t('capture.chip')) >= 0, 'save action missing: ' + labels.join('|'))
      H.surface.hide()
    })

    await step('chat surface quote inserts the selected text', async function () {
      var dismissed = 0
      var mounted = H.surface.mount({
        text: 'surface selection text',
        dismiss: function () { dismissed += 1 },
      })
      await sleep(160)
      var quote = q('.dsn-surface-btn[data-dsn-action="quote"]', mounted.host)
      assert(quote, 'quote button missing')
      click(quote)
      await sleep(160)
      assert(mounted.quotes.length === 1, 'insertQuote calls=' + mounted.quotes.length)
      assert(mounted.quotes[0] === 'surface selection text', 'quoted text mismatch: ' + mounted.quotes[0])
      assert(dismissed === 1, 'surface was not dismissed after quoting')
      H.surface.hide()
    })

    await step('chat surface save stores a note', async function () {
      // The save action prefers the live DOM selection, so drop any leftover one
      // to exercise the surface's own text.
      var live = window.getSelection()
      if (live) live.removeAllRanges()
      var before = liveNotes().length
      var mounted = H.surface.mount({ text: 'surface selection text' })
      await sleep(160)
      var save = q('.dsn-surface-btn[data-dsn-action="note"]', mounted.host)
      assert(save, 'save button missing')
      click(save)
      await sleep(320)
      assert(liveNotes().length === before + 1, 'surface save did not store a note')
      assert(liveNotes()[0].text.indexOf('surface selection text') >= 0,
        'stored note lost the surface text: ' + liveNotes()[0].text)
      H.surface.hide()
    })

    await step('a note can be quoted back into the composer', async function () {
      openPanel()
      var noteId = store.actions.addNote({
        html: '<p>引用回来的文本</p>',
        text: '引用回来的文本',
        origin: { sessionId: 'session-a', sessionTitle: '对话 A', turn: 4, nodeKey: 'message:4' },
      })
      var DSN = window.__DSH_STICKY_BOARD__
      var realGet = DSN.bridge.get
      var realQuote = DSN.bridge.quote
      var quoted = ''
      DSN.bridge.get = function () { return { sessionId: 'session-b', sessionTitle: '对话 B' } }
      DSN.bridge.quote = function (text) { quoted = text; return true }
      try {
        await sleep(160)
        var card = q('[data-note-id="' + noteId + '"]')
        assert(card, 'quoted note card missing')
        var action = qa('button', card).filter(function (node) {
          return node.getAttribute('aria-label') === t('note.quote')
        })[0]
        assert(action, 'quote action missing on the card')
        click(action)
        await sleep(260)
        assert(quoted === '引用回来的文本', 'quoted text mismatch: ' + quoted)
        assert(qa('.dsn-toast').length > 0, 'no toast after quoting')
        assert(byLabel(t('note.quote')).length > 0, 'quote label lost')
      } finally {
        DSN.bridge.get = realGet
        DSN.bridge.quote = realQuote
        store.actions.purgeNote(noteId)
      }
    })

    await step('chip yields to the chat flow surface', async function () {
      var bubble = q('.bubble')
      assert(bubble, 'fake chat bubble missing')
      bubble.setAttribute('data-text-interaction-source', '')
      var evidence = document.getElementById('evidence')
      var range = document.createRange()
      range.selectNodeContents(evidence)
      var selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange', { bubbles: true }))
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
      await sleep(360)
      var chip = q('.dsn-chip-layer button')
      assert(!chip || chip.style.display === 'none',
        'chip should stay hidden while the chat flow owns the selection')
      bubble.removeAttribute('data-text-interaction-source')
      selection.removeAllRanges()
    })

    /* ----------------------------------------------------------- launcher */
    await step('header launcher toggles the panel', async function () {
      var button = qa('[aria-label]').filter(function (node) {
        return node.className && String(node.className).indexOf('dsn-header-btn') >= 0
      })[0]
      assert(button, 'header launcher button missing')
      assert(button.closest('#fake-actions'), 'header launcher must sit in the session header row')
      var before = panelOpen()
      click(button)
      await sleep(160)
      assert(panelOpen() !== before, 'launcher did not toggle the panel')
      click(button)
      await sleep(160)
      assert(panelOpen() === before, 'launcher toggle was not reversible')
      openPanel()
      await sleep(120)
    })

    /* ------------------------------------------------------- storage state */
    await step('footer reports the storage state', async function () {
      openPanel()
      await sleep(120)
      var pill = q('.dsn-footer .dsn-sync')
      assert(pill, 'storage-state pill missing from the footer')
      assert(/dsn-sync--(idle|loading|saving|saved|local|error)/.test(String(pill.className)),
        'unknown storage state: ' + pill.className)
      assert(!!pill.getAttribute('title'), 'storage-state pill needs a tooltip')
    })

    /* -------------------------------------------------- reply row action */
    await step('reply row saves the whole reply', async function () {
      var button = q('#fake-reply-row .dsn-inline-action')
      assert(button, 'reply-row save button missing')
      assert(button.getAttribute('aria-label') === t('inline.saveReply'),
        'unexpected label: ' + button.getAttribute('aria-label'))
      var before = liveNotes().length
      click(button)
      await sleep(220)
      var notes = liveNotes()
      assert(notes.length === before + 1, 'reply click did not add a note (' + notes.length + ')')
      var note = notes[0]
      assert(note.html.indexOf('结论') >= 0, 'stored reply lost its text: ' + note.html.slice(0, 120))
      assert(note.html.indexOf('跨会话复用') >= 0, 'stored reply lost its table: ' + note.html.slice(0, 200))
      assert(note.html.indexOf('<button') < 0, 'stored reply still carries transcript chrome')
      assert(!!note.source && note.source.sessionId === 's1', 'stored reply lost its session source')
      assert(!!q('.dsn-toast'), 'no confirmation toast for the saved reply')
    })

    /* ------------------------------------------------ image context menu */
    await step('image menu action saves the rendered image', async function () {
      for (var index = 0; index < 8; index += 1) {
        if (q('.dsn-toast')) break
        await sleep(120)
      }
      var contributions = (H.menus || []).filter(function (item) { return item && item.target === 'image' })
      assert(contributions.length === 1, 'image menu contribution missing')
      var actions = contributions[0].resolve({
        url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        name: 'chart.png',
        mediaType: 'image/png',
      })
      assert(actions.length === 1, 'image menu should offer exactly one action')
      assert(actions[0].label === t('menu.saveImage'), 'unexpected image action label: ' + actions[0].label)
      var before = liveNotes().length
      await actions[0].run()
      await sleep(160)
      var notes = liveNotes()
      assert(notes.length === before + 1, 'image action did not add a note (' + notes.length + ')')
      var note = notes[0]
      assert(note.kind === 'image', 'image note kind was ' + note.kind)
      assert(note.html.indexOf('<img') >= 0, 'image note has no <img>: ' + note.html.slice(0, 120))
      assert(note.html.indexOf('chart.png') >= 0, 'image note lost its alt text')
    })

    /* ------------------------------------------------------- priorities */
    await step('priority can be set, sorted and filtered from the board', async function () {
      openPanel()
      await sleep(120)
      var trigger = q('.dsn-stream .dsn-note .dsn-prio--pick')
      assert(trigger, 'priority picker missing on the card')
      var card = trigger.closest('.dsn-note')
      var id = card.getAttribute('data-note-id')
      click(trigger)
      await sleep(140)
      var menu = q('.dsn-menu')
      assert(menu, 'priority menu did not open')
      assert(menu.parentNode === document.body, 'the menu must be portalled out of the panel')
      assert(qa('.dsn-menu .dsn-menu-item').length === 4, 'priority menu should list four steps')
      var urgent = menu.querySelector('.dsn-menu-item[data-value="urgent"]')
      assert(urgent, 'urgent option missing')
      click(urgent)
      await sleep(160)
      assert(!q('.dsn-menu'), 'menu did not close after choosing')
      var note = noteById(id)
      assert(note && note.priority === 'urgent', 'priority stayed at ' + (note && note.priority) + ' for ' + id)
      assert(q('.dsn-stream .dsn-note[data-note-id="' + id + '"] .dsn-prio--urgent'), 'the pill did not adopt the urgent style')
      store.actions.setSort('priority')
      await sleep(140)
      assert(cards()[0].getAttribute('data-note-id') === id, 'priority sort did not lift the urgent note')
      store.actions.setPriorityFilter('urgent')
      await sleep(140)
      var visible = cards().map(function (node) { return node.getAttribute('data-note-id') })
      assert(visible.length >= 1, 'priority filter hid every note')
      for (var i = 0; i < visible.length; i += 1) {
        assert(noteById(visible[i]).priority === 'urgent', 'filter let a non-urgent note through')
      }
      store.actions.setPriorityFilter('all')
      store.actions.setSort('time')
      await sleep(140)
    })

    /* --------------------------------------------------- filter menus */
    await step('filter dropdowns behave like themed menus', async function () {
      openPanel()
      await sleep(120)
      var triggers = qa('.dsn-filters .dsn-select')
      assert(triggers.length === 2, 'expected two filter menus, found ' + triggers.length)
      click(triggers[0])
      await sleep(140)
      var menu = q('.dsn-menu')
      assert(menu, 'sort menu did not open')
      assert(qa('.dsn-menu .dsn-menu-item').length === 2, 'sort menu should list two orders')
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
      await sleep(60)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      await sleep(160)
      assert(!q('.dsn-menu'), 'sort menu did not close after Enter')
      assert(store.getSnapshot().ui.sort === 'priority', 'keyboard pick did not change the sort')
      store.actions.setSort('time')
      await sleep(120)
      click(triggers[1])
      await sleep(140)
      var prioMenu = q('.dsn-menu')
      assert(prioMenu, 'priority filter menu did not open')
      assert(qa('.dsn-menu .dsn-menu-item').length === 5, 'priority filter should list all four steps plus 全部')
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      await sleep(140)
      assert(!q('.dsn-menu'), 'Escape did not close the menu')
      assert(panelOpen(), 'closing the menu must not close the panel')
    })

    /* ------------------------------------------------------- checklist */
    await step('checklist items can be added, ticked and counted', async function () {
      openPanel()
      await sleep(100)
      var card = cards()[0]
      var id = card.getAttribute('data-note-id')
      store.actions.setDetail(id)
      await sleep(180)
      var sheet = q('.dsn-sheet')
      assert(sheet, 'detail sheet did not open')
      var input = q('.dsn-sheet .dsn-task-input')
      assert(input, 'task input missing in the sheet')
      setInput(input, '第一项待办')
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      await sleep(160)
      var note = noteById(id)
      assert(note.tasks.length === 1, 'task was not added (' + note.tasks.length + ')')
      assert(note.tasks[0].text === '第一项待办', 'task text is ' + note.tasks[0].text)
      var check = q('.dsn-sheet .dsn-task-check')
      assert(check, 'task checkbox missing')
      click(check)
      await sleep(160)
      assert(noteById(id).tasks[0].done === true, 'task did not become done')
      assert(q('.dsn-sheet .dsn-tasks-progress').textContent.indexOf('1/1') >= 0, 'progress label is wrong')
      var closed = byLabel(t('detail.close'))[0]
      assert(closed, 'sheet close button missing')
      click(closed)
      await sleep(160)
      var chip = q('.dsn-stream .dsn-note[data-note-id="' + id + '"] .dsn-note-meta .dsn-chip--warn')
      assert(chip, 'the card should surface its finished checklist')
      assert(chip.textContent.indexOf('1/1') >= 0, 'card chip lost the progress: ' + chip.textContent)
    })

    /* -------------------------------------------------------- comments */
    await step('comments are stored, rendered and counted', async function () {
      openPanel()
      await sleep(100)
      var card = cards()[0]
      var id = card.getAttribute('data-note-id')
      store.actions.setDetail(id)
      await sleep(180)
      var box = q('.dsn-sheet .dsn-comment-input')
      assert(box, 'comment box missing')
      setInput(box, '这条便签说得对')
      var send = q('.dsn-sheet .dsn-comment-formbar .dsn-btn-primary')
      assert(send, 'comment send button missing')
      click(send)
      await sleep(200)
      var note = noteById(id)
      assert(note.comments.length === 1, 'comment was not stored (' + note.comments.length + ')')
      assert(note.comments[0].text.indexOf('说得对') >= 0, 'comment text lost')
      var rendered = qa('.dsn-sheet .dsn-comment')
      assert(rendered.length === 1, 'comment row missing in the thread')
      assert(rendered[0].textContent.indexOf('说得对') >= 0, 'rendered comment lost its text')
      click(byLabel(t('detail.close'))[0])
      await sleep(160)
      var chip = q('.dsn-stream .dsn-note[data-note-id="' + id + '"] .dsn-note-meta button.dsn-chip--btn:last-of-type')
      assert(chip, 'comment chip missing on the card')
      assert(chip.textContent.indexOf('1') >= 0, 'comment chip should show the count: ' + chip.textContent)
    })

    /* ------------------------------------------- comments in float windows */
    await step('detached window shows and accepts comments', async function () {
      openPanel()
      await sleep(120)
      var all = liveNotes()
      var target = null
      for (var i = 0; i < all.length; i += 1) {
        if ((all[i].comments || []).length >= 2 && all[i].html.indexOf('acceptance') >= 0) target = all[i]
      }
      if (!target) for (var j = 0; j < all.length; j += 1) if ((all[j].comments || []).length >= 1) target = all[j]
      assert(target, 'no note with comments to pop out')
      var expected = (target.comments || []).length
      store.actions.addFloater(target.id, { x: 140, y: 90, w: 380, h: 460 })
      await sleep(200)
      var win = q('.dsn-float[data-dsn-float="' + target.id + '"]')
      assert(win, 'detached window did not open')
      var thread = win.querySelector('.dsn-comments')
      assert(thread, 'the detached window does not show the comment thread')
      assert(thread.className.indexOf('dsn-comments--compact') >= 0, 'the window thread should be the compact variant')
      assert(thread.querySelectorAll('.dsn-comment').length === expected, 'window thread lost comments')
      var box = win.querySelector('.dsn-comment-input')
      assert(box, 'comment box missing in the detached window')
      setInput(box, '窗口里也能评论')
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      await sleep(220)
      var note = noteById(target.id)
      assert(note.comments.length === expected + 1, 'comment typed in the window was not stored (' + note.comments.length + ')')
      assert(note.comments[note.comments.length - 1].text.indexOf('窗口里也能评论') >= 0, 'stored comment text is wrong')
      assert(win.textContent.indexOf('窗口里也能评论') >= 0, 'the new comment did not render inside the window')
      var head = win.querySelector('.dsn-float-head')
      assert(head && head.querySelector('.dsn-prio'), 'the window header should show the priority pill')
      store.actions.removeFloater(target.id)
      await sleep(140)
    })

    /* ------------------------------------------------------- tasks view */
    await step('the to-do tab aggregates open items', async function () {
      store.actions.setView('tasks')
      await sleep(200)
      var view = q('.dsn-tasksview')
      assert(view, 'tasks view did not render')
      assert(qa('.dsn-tasksview .dsn-task').length >= 1, 'tasks view listed no checklist rows')
      assert(q('.dsn-tasksview .dsn-tasksgroup'), 'tasks view has no note group')
      store.actions.setView('board')
      await sleep(160)
    })

    /* --------------------------------------------------------------- PiP */
    await step('PiP button degrades gracefully when unsupported', async function () {
      var supported = typeof window.documentPictureInPicture !== 'undefined'
      openPanel()
      await sleep(120)
      var button = byLabel(t('panel.pip'))[0]
      assert(button, 'PiP button missing')
      click(button)
      await sleep(320)
      assert(panelOpen(), 'PiP click must not close the panel')
      if (!supported) assert(!!q('.dsn-toast'), 'unsupported PiP should explain itself with a toast')
    })
    /* ---------------------------------- insert falls back when no session */
    await step('insert without a session copies and toasts', async function () {
      openPanel()
      await sleep(80)
      var button = q('.dsn-stream .dsn-note button[aria-label="' + t('note.insert') + '"]')
      assert(button, 'insert button missing')
      click(button)
      await sleep(260)
      var toast = q('.dsn-toast')
      assert(toast, 'no toast shown for the clipboard fallback')
    })


    finish()
  }

  run().catch(function (error) {
    results.push({ name: 'selftest crashed', ok: false, error: String((error && error.stack) || error) })
    finish()
  })
})()
