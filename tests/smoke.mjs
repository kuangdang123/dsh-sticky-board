// Integration smoke test: loads the built client.js in jsdom with a fake DSH
// client context, mounts the registered slot components, and exercises the
// store → UI path. Run with:  node tests/smoke.mjs
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInThisContext } from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const REPO = 'D:\\Desktop\\deepseek-harness\\node_modules\\.pnpm'

const reactPath = join(REPO, 'react@18.3.1', 'node_modules', 'react')
const reactDomPath = join(REPO, 'react-dom@18.3.1_react@18.3.1', 'node_modules', 'react-dom')
const jsdomPath = join(REPO, 'jsdom@29.1.1_@noble+hashes@2.4.0', 'node_modules', 'jsdom')

const requireFromRoot = createRequire(join(root, 'package.json'))
const { JSDOM } = requireFromRoot(jsdomPath)

const dom = new JSDOM('<!doctype html><html data-theme="light"><head></head><body><div id="host"></div></body></html>', {
  url: 'http://127.0.0.1:3080/',
  pretendToBeVisual: true,
})
const { window } = dom

const failures = []
const passes = []
function check(name, condition, detail) {
  if (condition) passes.push(name)
  else failures.push(name + (detail ? ` — ${detail}` : ''))
}
function text() { return window.document.body.textContent || '' }
function report() {
  const total = passes.length + failures.length
  if (failures.length === 0) {
    console.log(`PASS ${passes.length}/${total} checks`)
    process.exit(0)
  }
  console.log(`FAIL ${failures.length}/${total} checks`)
  for (const item of passes) console.log('  ok   ' + item)
  for (const item of failures) console.log('  FAIL ' + item)
  process.exit(1)
}

// ---------------------------------------------------------------- globals --
function defineGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
}
defineGlobal('window', window)
defineGlobal('document', window.document)
defineGlobal('navigator', window.navigator)
defineGlobal('location', window.location)
defineGlobal('HTMLElement', window.HTMLElement)
defineGlobal('Node', window.Node)
defineGlobal('Element', window.Element)
defineGlobal('Event', window.Event)
defineGlobal('MouseEvent', window.MouseEvent)
defineGlobal('KeyboardEvent', window.KeyboardEvent)
defineGlobal('ClipboardEvent', window.ClipboardEvent)
defineGlobal('DragEvent', window.DragEvent)
defineGlobal('getComputedStyle', window.getComputedStyle.bind(window))
defineGlobal('requestAnimationFrame', (fn) => setTimeout(() => fn(Date.now()), 0))
defineGlobal('cancelAnimationFrame', (id) => clearTimeout(id))
defineGlobal('ResizeObserver', window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} })
defineGlobal('MutationObserver', window.MutationObserver)
defineGlobal('FileReader', window.FileReader)
defineGlobal('DOMParser', window.DOMParser)
defineGlobal('localStorage', window.localStorage)

// jsdom has no layout engine, so ranges report a zero-size box; the chip only
// appears for a non-degenerate rect, so hand it one.
const FAKE_BOX = { left: 100, top: 100, right: 220, bottom: 120, width: 120, height: 20, x: 100, y: 100 }
try {
  window.Range.prototype.getBoundingClientRect = () => FAKE_BOX
  window.Range.prototype.getClientRects = () => [FAKE_BOX]
} catch (error) { /* ignore */ }

// --------------------------------------------------------------- loader ----
const React = requireFromRoot(reactPath)
const ReactDOMClient = requireFromRoot(join(reactDomPath, 'client.js'))
const { flushSync } = requireFromRoot(reactDomPath)
let entry = null
window.__ModuleLoader__ = { load(spec) { entry = spec } }

runInThisContext(readFileSync(join(root, 'client.js'), 'utf8'), { filename: 'client.js' })

check('module loader received a registration', !!entry)
if (!entry) report()
check('module id is the package name', entry.id === 'dsh-sticky-board', String(entry && entry.id))

const fakeRequire = (name) => {
  if (name === 'react') return React
  if (name === 'react-dom/client') return ReactDOMClient
  if (name === 'react-dom') return requireFromRoot(reactDomPath)
  throw new Error('unexpected require: ' + name)
}
const mod = entry.factory(fakeRequire)
check('exports.apply is a function', typeof mod.apply === 'function')
check('exports.inject lists slots and locale', Array.isArray(mod.inject) && mod.inject.indexOf('slots') >= 0)

// ----------------------------------------------------------- fake ctx ------
const registered = []
const dictionaryLocales = []
const interactions = []
const menuContributions = []
const localeTable = {}

const ctx = {
  slots: {
    inject(key, callback) { return callback() },
    register(declaration, component) {
      registered.push({ declaration, component })
      return () => {}
    },
    registerFactory() { return () => {} },
  },
  locale: {
    register(ns, locale, dict) {
      dictionaryLocales.push(locale)
      Object.assign(localeTable[locale] || (localeTable[locale] = {}), dict)
      return () => {}
    },
    bind() {
      return (key, params) => {
        const table = localeTable.zh || {}
        const template = table[key] != null ? table[key] : key
        return params
          ? String(template).replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
          : String(template)
      }
    },
    getLocale() { return 'zh' },
  },
  uiConversation: {
    interactions: { register(definition) { interactions.push(definition); return () => {} } },
  },
  effect(callback) {
    const result = callback()
    return () => { if (typeof result === 'function') result() }
  },
  // Mirrors Cordis: the described service is handed to the callback scope.
  inject(dependencies, callback) {
    const scoped = {}
    for (const dependency of dependencies) {
      const service = ctx.get(dependency)
      if (service) scoped[dependency] = service
    }
    return callback(scoped)
  },
  get(name) {
    if (name === 'contextMenus') {
      return {
        register(contribution) {
          menuContributions.push(contribution)
          return () => {}
        },
      }
    }
    return undefined
  },
  logger: { info() {}, warn() {}, error() {}, debug() {} },
}

const dispose = mod.apply(ctx)
const names = registered.map((item) => item.declaration.id || item.declaration.key).join(',')
check('apply registered slot components', registered.length >= 2, `count=${registered.length}`)
check('zh + en dictionaries registered', dictionaryLocales.indexOf('zh') >= 0 && dictionaryLocales.indexOf('en') >= 0,
  dictionaryLocales.join(','))
check('text-interaction definition registered',
  interactions.some((item) => item && item.id === 'dsh-sticky-board'))
const interaction = interactions.find((item) => item && item.id === 'dsh-sticky-board')
let selectionOpened = 0
let contextOpened = 0
if (interaction) {
  interaction.onInteraction({ trigger: 'selection', hasSelection: true, readText: () => 'hello', open() { selectionOpened += 1 } })
  interaction.onInteraction({ trigger: 'contextmenu', hasSelection: true, readText: () => 'hello', open() { contextOpened += 1 } })
  interaction.onInteraction({ trigger: 'selection', hasSelection: true, readText: () => '   ', open() { selectionOpened += 1 } })
  interaction.onInteraction({ trigger: 'selection', hasSelection: false, readText: () => 'hello', open() { selectionOpened += 1 } })
}
check('selection gesture opens the surface', selectionOpened === 1, `opened=${selectionOpened}`)
check('contextmenu gesture opens the surface', contextOpened === 1, `opened=${contextOpened}`)
check('panel slot registered on shell.overlay', registered.some((item) => item.declaration.name === 'shell.overlay'))
check('toast slot registered on shell.overlay',
  registered.filter((item) => item.declaration.name === 'shell.overlay').length >= 2)
check('session header launcher registered',
  registered.some((item) => item.declaration.name === 'conversation.session.header.utilities'), names)
const headerReg = registered.find((item) => item.declaration.name === 'conversation.session.header.utilities')
check('header launcher sits leftmost of the utilities row',
  !!headerReg && headerReg.declaration.order === -20,
  headerReg ? `order=${headerReg.declaration.order}` : 'missing')
check('text-interaction surface registered',
  registered.some((item) => item.declaration.name === 'conversation.chat.text-interaction'))
const surfaceRegs = registered.filter((item) => item.declaration.name === 'conversation.chat.text-interaction')
const shadowReg = surfaceRegs.find((item) => item.declaration.key === 'quote')
check('built-in quote surface is shadowed at a lower priority',
  !!shadowReg && shadowReg.declaration.priority === -10,
  shadowReg ? `priority=${shadowReg.declaration.priority}` : surfaceRegs.map((item) => item.declaration.key).join(','))
check('own surface key is registered too',
  surfaceRegs.some((item) => item.declaration.key === 'dsh-sticky-board'), surfaceRegs.map((item) => item.declaration.key).join(','))
check('composer bridge registered',
  registered.some((item) => item.declaration.name === 'conversation.input.dock'))

const DSN = window.__DSH_STICKY_BOARD__
check('debug handle exposes the store', !!DSN && !!DSN.store)
const store = DSN && DSN.store
if (!store) report()

// --------------------------------------------------------------- render ---
const panel = registered.find((item) => item.declaration.id === 'dsh-sticky-board-panel')
const launcher = registered.find((item) => item.declaration.name === 'conversation.session.header.utilities')
const container = window.document.getElementById('host')
const rootInstance = ReactDOMClient.createRoot(container)

let renderError = null
try {
  flushSync(() => {
    store.actions.setOpen(true)
    store.actions.addNote({ html: '<p>hello note</p><table><tr><td>cell</td></tr></table>', text: 'hello note cell' })
  })
  flushSync(() => { rootInstance.render(React.createElement(panel.component, { t: ctx.locale.bind() })) })
} catch (error) {
  renderError = error
}
check('panel renders without throwing', renderError === null,
  renderError && (renderError.stack || String(renderError)).slice(0, 800))

check('panel renders its title', text().indexOf('便签') >= 0, text().slice(0, 160))
check('css injected into the document', !!window.document.querySelector('style[data-dsn-style="1"]'))
check('saved note is rendered in the panel', text().indexOf('hello note') >= 0, text().slice(0, 300))
check('table cell survives sanitizing + rendering', text().indexOf('cell') >= 0, text().slice(0, 300))
check('panel has a search input', !!window.document.querySelector('input'))
check('panel has a contenteditable composer', !!window.document.querySelector('[contenteditable="true"]'))

// ----------------------------------------------------------- persistence ---
check('durable storage layer is installed', typeof DSN.installSync === 'function' && !!DSN.syncStatus)
check('jsdom falls back to browser-local storage', DSN.syncStatus.getSnapshot().state === 'local',
  DSN.syncStatus.getSnapshot().state)
check('sync exposes a retry for a missing data route', typeof DSN.syncStatus.retry === 'function',
  typeof DSN.syncStatus.retry)
const footerSync = window.document.querySelector('.dsn-sync')
check('panel footer reports the storage state', !!footerSync, footerSync && footerSync.className)
const mergeDict = ctx.locale.bind()
const mergedState = DSN.mergeStates(
  {
    sections: [{ id: 'sec-inbox', name: 'Inbox', order: 0 }],
    notes: [{ id: 'n1', sectionId: 'sec-inbox', html: '<p>a</p>', text: 'a', updatedAt: 10 }],
    ui: { activeSectionId: 'sec-inbox' },
  },
  {
    sections: [{ id: 'sec-inbox', name: 'Inbox', order: 0 }, { id: 'sec-two', name: 'Two', order: 1 }],
    notes: [
      { id: 'n1', sectionId: 'sec-inbox', html: '<p>b</p>', text: 'b', updatedAt: 20 },
      { id: 'n2', sectionId: 'sec-two', html: '<p>c</p>', text: 'c', updatedAt: 5 },
    ],
    ui: { activeSectionId: 'sec-two' },
  },
  mergeDict,
)
check('merge unions sections', mergedState.sections.length === 2, String(mergedState.sections.length))
check('merge unions notes', mergedState.notes.length === 2, String(mergedState.notes.length))
check('merge keeps the newer revision of a note',
  mergedState.notes.filter((note) => note.id === 'n1')[0].text === 'b')
check('merge keeps this window ui state', mergedState.ui.activeSectionId === 'sec-inbox')

// --------------------------------------------------------------- launcher --
if (launcher) {
  const launcherHost = window.document.createElement('div')
  window.document.body.appendChild(launcherHost)
  const launcherRoot = ReactDOMClient.createRoot(launcherHost)
  let launcherError = null
  try {
    flushSync(() => {
      launcherRoot.render(React.createElement(launcher.component, { t: ctx.locale.bind() }))
    })
  } catch (error) { launcherError = error }
  check('header launcher renders', launcherError === null, launcherError && String(launcherError).slice(0, 400))
  const button = launcherHost.querySelector('button')
  check('header launcher has an accessible button', !!button && !!button.getAttribute('aria-label'))
  check('header launcher uses the header circle style',
    !!button && button.className.indexOf('dsn-header-btn') >= 0,
    button && button.className)
  if (button) {
    const before = store.getSnapshot().ui.open
    try { flushSync(() => { button.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) }) } catch (error) { /* ignore */ }
    check('launcher click toggles the panel', store.getSnapshot().ui.open !== before)
    flushSync(() => { store.actions.setOpen(true) })
  }
}

// --------------------------------------------------------------- capture ---
const evidence = window.document.createElement('p')
evidence.textContent = 'conversation evidence text'
window.document.body.appendChild(evidence)
let chipError = null
try {
  const range = window.document.createRange()
  range.selectNodeContents(evidence)
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
  window.document.dispatchEvent(new window.Event('selectionchange', { bubbles: true }))
  window.document.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true }))
} catch (error) { chipError = error }
await new Promise((resolve) => setTimeout(resolve, 300))
check('selection handling does not throw', chipError === null, chipError && String(chipError))
const chipButton = window.document.querySelector('.dsn-chip-layer button')
check('fallback chip appears for text outside the chat flow',
  !!chipButton && chipButton.style.display !== 'none',
  chipButton ? `display=${chipButton.style.display}` : 'no chip layer')

// --------------------------------------- host text-interaction surface ----
const surfaceEntry = registered.find((item) => item.declaration.name === 'conversation.chat.text-interaction')
if (surfaceEntry) {
  const surfaceHost = window.document.createElement('div')
  window.document.body.appendChild(surfaceHost)
  const surfaceRoot = ReactDOMClient.createRoot(surfaceHost)
  const quotes = []
  let dismissed = 0
  let cleared = 0
  let surfaceError = null
  const notesBefore = store.getSnapshot().notes.length
  try {
    flushSync(() => {
      surfaceRoot.render(React.createElement(surfaceEntry.component, {
        t: ctx.locale.bind(),
        dismiss() { dismissed += 1 },
        readText: () => 'quoted evidence',
        clearSelection() { cleared += 1 },
        inputActions: { insertQuote(text) { quotes.push(text); return true } },
      }))
    })
  } catch (error) { surfaceError = error }
  check('surface renders without throwing', surfaceError === null,
    surfaceError && (surfaceError.stack || String(surfaceError)).slice(0, 600))
  const surfaceButtons = Array.from(surfaceHost.querySelectorAll('.dsn-surface-btn'))
  const surfaceLabels = surfaceButtons.map((node) => node.getAttribute('aria-label'))
  check('surface carries two actions', surfaceButtons.length === 2, surfaceLabels.join('|'))
  check('surface restores the built-in quote action',
    surfaceLabels.indexOf('引用文本') >= 0, surfaceLabels.join('|'))
  check('surface carries the note action', surfaceLabels.indexOf('存便签') >= 0, surfaceLabels.join('|'))

  const quoteButton = surfaceButtons.find((node) => node.getAttribute('data-dsn-action') === 'quote')
  if (quoteButton) {
    flushSync(() => { quoteButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  }
  check('quote action inserts the selected text', quotes.length === 1 && quotes[0] === 'quoted evidence',
    JSON.stringify(quotes))
  check('quote action dismisses + clears the selection', dismissed === 1 && cleared === 1,
    `dismissed=${dismissed} cleared=${cleared}`)

  const saveButton = surfaceButtons.find((node) => node.getAttribute('data-dsn-action') === 'note')
  if (saveButton) {
    flushSync(() => { saveButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  }
  const notesAfter = store.getSnapshot().notes.length
  check('surface save adds a note', notesAfter === notesBefore + 1, `${notesBefore} -> ${notesAfter}`)
  if (notesAfter > notesBefore) {
    const note = store.getSnapshot().notes[0]
    check('surface save keeps the selected text', String(note.text).indexOf('conversation evidence text') >= 0,
      JSON.stringify(note.text).slice(0, 120))
  }
  try { surfaceRoot.unmount() } catch (error) { /* ignore */ }
}

// ------------------- chip yields to a mounted interaction surface ---------
const chatSource = window.document.createElement('div')
chatSource.setAttribute('data-text-interaction-source', '')
const chatText = window.document.createElement('p')
chatText.textContent = 'chat flow evidence'
chatSource.appendChild(chatText)
window.document.body.appendChild(chatSource)
function selectChatText() {
  const range = window.document.createRange()
  range.selectNodeContents(chatText)
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
  window.document.dispatchEvent(new window.Event('selectionchange', { bubbles: true }))
  window.document.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true }))
}
let suppressionError = null
try { selectChatText() } catch (error) { suppressionError = error }
await new Promise((resolve) => setTimeout(resolve, 300))
const fallbackChip = window.document.querySelector('.dsn-chip-layer button')
check('chip still offers a way in before any surface is mounted',
  suppressionError === null && !!fallbackChip && fallbackChip.style.display !== 'none',
  suppressionError ? String(suppressionError) : `display=${fallbackChip && fallbackChip.style.display}`)

let chipSurfaceError = null
const chipSurfaceHost = window.document.createElement('div')
window.document.body.appendChild(chipSurfaceHost)
const chipSurfaceRoot = ReactDOMClient.createRoot(chipSurfaceHost)
try {
  flushSync(() => {
    chipSurfaceRoot.render(React.createElement(surfaceEntry.component, {
      t: ctx.locale.bind(),
      dismiss() {},
      readText: () => 'chat flow evidence',
      clearSelection() {},
      inputActions: { insertQuote() { return true } },
    }))
  })
} catch (error) { chipSurfaceError = error }
const chipWhileSurface = window.document.querySelector('.dsn-chip-layer button')
check('mounted surface hides the floating chip',
  chipSurfaceError === null && (!chipWhileSurface || chipWhileSurface.style.display === 'none'),
  chipSurfaceError ? String(chipSurfaceError) : `display=${chipWhileSurface && chipWhileSurface.style.display}`)

try { chipSurfaceRoot.unmount() } catch (error) { /* ignore */ }
try { selectChatText() } catch (error) { /* ignore */ }
await new Promise((resolve) => setTimeout(resolve, 300))
const chipAfterUnmount = window.document.querySelector('.dsn-chip-layer button')
check('chip comes back when the surface goes away',
  !!chipAfterUnmount && chipAfterUnmount.style.display !== 'none',
  `display=${chipAfterUnmount && chipAfterUnmount.style.display}`)

// ------------------------------------------------- drag into composer ---
const dropNoteId = store.actions.addNote({
  html: '<p>拖进来的结论</p><pre><code>x = 1</code></pre>',
  text: '拖进来的结论',
})

const markdownSample = typeof DSN.htmlToMarkdown === 'function'
  ? DSN.htmlToMarkdown('<p>hi <strong>bold</strong></p><ul><li>a</li><li>b</li></ul>'
    + '<pre><code>const x = 1</code></pre>'
    + '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>'
    + '<p><img src="data:image/png;base64,AAA" alt="pic"></p>')
  : ''
check('htmlToMarkdown keeps emphasis, lists, code, tables and images',
  markdownSample.includes('**bold**') && markdownSample.includes('- a')
  && markdownSample.includes('const x = 1') && markdownSample.includes('| A | B |')
  && markdownSample.includes('| --- | --- |') && markdownSample.includes('| 1 | 2 |')
  && markdownSample.includes('*[pic]*'),
  JSON.stringify(markdownSample))

const composerCard = window.document.createElement('div')
composerCard.setAttribute('data-composer-card', '')
composerCard.getBoundingClientRect = () => ({
  left: 40, top: 40, width: 320, height: 60, right: 360, bottom: 100, x: 40, y: 40,
})
const composerInput = window.document.createElement('div')
composerCard.appendChild(composerInput)
window.document.body.appendChild(composerCard)

function noteTransfer() {
  return {
    types: ['application/x-dsn-note', 'text/plain', 'text/html'],
    dropEffect: 'none',
    getData(name) {
      if (name === 'application/x-dsn-note') return dropNoteId
      if (name === 'text/plain') return '拖进来的结论'
      if (name === 'text/html') return '<p>拖进来的结论</p>'
      return ''
    },
    setData() {},
  }
}

function fireDrag(type, target, dataTransfer) {
  const event = new window.Event(type, { bubbles: true, cancelable: true })
  event.dataTransfer = dataTransfer
  target.dispatchEvent(event)
  return event
}

/* Drag affordances are painted once per animation frame (the pointer path must
 * never force a layout), so the assertions have to let a frame run first. */
function nextFrame() {
  return new Promise((resolve) => {
    const raf = window.requestAnimationFrame
    if (typeof raf === 'function') raf(() => resolve())
    else setTimeout(resolve, 20)
  })
}

check('installNoteDrop is exported', typeof DSN.installNoteDrop === 'function')

const bridgeInserts = []
const realBridge = DSN.bridge
DSN.bridge = Object.assign({}, realBridge, {
  insert(html, text) {
    bridgeInserts.push({ html, text })
    return true
  },
})
const overComposer = fireDrag('dragover', composerInput, noteTransfer())
await nextFrame()
check('dragover over the composer is accepted', overComposer.defaultPrevented === true,
  `defaultPrevented=${overComposer.defaultPrevented}`)
const dropRing = window.document.querySelector('.dsn-drop-layer .dsn-drop-ring')
check('drop ring is painted over the composer', !!dropRing && dropRing.style.opacity === '1',
  dropRing ? `opacity=${dropRing.style.opacity} left=${dropRing.style.left}` : 'no ring')
const dropEvent = fireDrag('drop', composerInput, noteTransfer())
check('drop inserts the note into the composer as markdown',
  dropEvent.defaultPrevented === true && bridgeInserts.length === 1
  && bridgeInserts.length === 1 && bridgeInserts[0].text.includes('x = 1'),
  JSON.stringify(bridgeInserts))
check('drop ring hides after the drop', !dropRing || dropRing.style.opacity === '0',
  dropRing ? `opacity=${dropRing.style.opacity}` : 'no ring')
DSN.bridge = realBridge
composerCard.remove()

// ------------------------------------------------- pop-out windows -------
// The host ignores text drops outside the composer; we use that instead of
// leaving it dead: releasing a note over the transcript opens its own window.
const floatersNow = () => store.getSnapshot().ui.floaters || []
const chatArea = window.document.createElement('div')
chatArea.className = 'fake-transcript'
window.document.body.appendChild(chatArea)

const overFlow = fireDrag('dragover', chatArea, noteTransfer())
await nextFrame()
check('dragover over the transcript is accepted for pop-out',
  overFlow.defaultPrevented === true, `defaultPrevented=${overFlow.defaultPrevented}`)
const floatHint = window.document.querySelector('.dsn-drop-layer .dsn-drop-hint')
check('the pop-out hint names the release action',
  !!floatHint && floatHint.style.display === 'inline-flex' && /独立|floating/.test(floatHint.textContent || ''),
  floatHint ? `${floatHint.textContent} display=${floatHint.style.display}` : 'no hint')
check('no drop ring is painted outside the composer',
  !dropRing || dropRing.style.opacity === '0',
  dropRing ? `opacity=${dropRing.style.opacity}` : 'no ring')

const dropFloat = fireDrag('drop', chatArea, noteTransfer())
check('releasing outside the composer pops the note out',
  dropFloat.defaultPrevented === true && floatersNow().length === 1
  && floatersNow()[0].noteId === dropNoteId,
  `floaters=${JSON.stringify(floatersNow().map((item) => item.noteId))}`)

const ownPanel = window.document.createElement('div')
ownPanel.setAttribute('data-dsn-panel', 'floating')
window.document.body.appendChild(ownPanel)
const overOwn = fireDrag('dragover', ownPanel, noteTransfer())
await nextFrame()
check('dragover over our own panel is left to the board', overOwn.defaultPrevented === false,
  `defaultPrevented=${overOwn.defaultPrevented}`)
fireDrag('drop', ownPanel, noteTransfer())
check('dropping back on the panel never pops a second window',
  floatersNow().length === 1 && bridgeInserts.length === 1,
  `floaters=${floatersNow().length} inserts=${bridgeInserts.length}`)

store.actions.moveFloater(dropNoteId, 120, 90)
store.actions.resizeFloater(dropNoteId, 460, 360)
store.actions.setFloaterCollapsed(dropNoteId, true)
const moved = floatersNow()[0]
check('a floating window keeps its geometry and collapse state',
  !!moved && moved.x === 120 && moved.y === 90 && moved.w === 460 && moved.h === 360 && moved.collapsed === true,
  JSON.stringify(moved))
const identity = (key) => key
const roundTripped = DSN.normalizeState(JSON.parse(JSON.stringify(store.getSnapshot())), identity)
check('floating windows survive a reload round trip',
  roundTripped.ui.floaters.length === 1 && roundTripped.ui.floaters[0].x === 120
  && roundTripped.ui.floaters[0].collapsed === true,
  JSON.stringify(roundTripped.ui.floaters))
check('floating windows are clamped into sane bounds',
  (() => {
    const clamped = DSN.normalizeState({
      sections: [{ id: 's1', name: 'x', order: 0 }],
      notes: [],
      ui: { floaters: [{ noteId: 'a', x: 0, y: 0, w: 5, h: 5, z: 1 }, { noteId: 'a', x: 1, y: 1, w: 100, h: 100, z: 2 }] },
    }, identity).ui.floaters
    return clamped.length === 1 && clamped[0].w >= DSN.FLOAT_MIN_W && clamped[0].h >= DSN.FLOAT_MIN_H
  })(),
  JSON.stringify(DSN.normalizeState({ sections: [{ id: 's1', name: 'x', order: 0 }], notes: [], ui: { floaters: [{ noteId: 'a', x: 0, y: 0, w: 5, h: 5, z: 1 }] } }, identity).ui.floaters))
check('floating windows are capped',
  (() => {
    const many = []
    for (let i = 0; i < DSN.MAX_FLOATERS + 3; i += 1) many.push({ noteId: 'n' + i, x: 1, y: 1, w: 320, h: 260, z: i })
    return DSN.normalizeState({ sections: [{ id: 's1', name: 'x', order: 0 }], notes: [], ui: { floaters: many } }, identity)
      .ui.floaters.length === DSN.MAX_FLOATERS
  })(),
  `cap=${DSN.MAX_FLOATERS}`)

store.actions.removeFloater(dropNoteId)
check('a floating window can be closed from the store', floatersNow().length === 0,
  `floaters=${floatersNow().length}`)
store.actions.addFloater(dropNoteId, { x: 10, y: 10, w: 320, h: 260 })
store.actions.deleteNote(dropNoteId)
check('deleting a note closes its floating window', floatersNow().length === 0,
  `floaters=${floatersNow().length}`)
store.actions.restoreNote(dropNoteId)
ownPanel.remove()
chatArea.remove()

// ------------------------------------------- reply row + image menu --------
const replyReg = registered.find((item) => item.declaration.name === 'conversation.chat.assistant-actions')
check('assistant action row registration exists',
  !!replyReg && replyReg.declaration.order === 50 && replyReg.declaration.id === 'dsh-sticky-board-reply',
  replyReg ? `order=${replyReg.declaration.order} id=${replyReg.declaration.id}` : 'missing')

const imageContribution = menuContributions.find((item) => item && item.target === 'image')
check('image context menu contribution registered',
  !!imageContribution && imageContribution.id === 'dsh-sticky-board.image' && imageContribution.order === 150,
  imageContribution ? `id=${imageContribution.id} order=${imageContribution.order}` : 'missing')

const imageTarget = { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', name: 'chart.png' }
const imageActions = imageContribution ? imageContribution.resolve(imageTarget) : []
check('image menu offers a save action', imageActions.length === 1 && imageActions[0].label.indexOf('便签') >= 0,
  JSON.stringify(imageActions.map((item) => item.label)))
if (imageActions.length === 1) {
  let imageError = null
  await imageActions[0].run().catch((error) => { imageError = error })
  const imageNote = store.getSnapshot().notes.find((note) => note.kind === 'image' && /<img/.test(note.html))
  check('image menu action stores an image note', imageError === null && !!imageNote,
    imageError ? String(imageError) : (imageNote ? imageNote.html.slice(0, 80) : 'no note'))
  check('image note keeps the data url and alt text',
    !!imageNote && imageNote.html.indexOf('data:image/png') >= 0 && imageNote.html.indexOf('chart.png') >= 0,
    imageNote ? imageNote.html.slice(0, 120) : 'no note')
}

const turnHost = window.document.createElement('div')
turnHost.innerHTML = [
  '<div data-chat-turn="3">',
  '  <div data-chat-turn="3" data-chat-flow-kind="assistant-step" data-chat-flow="main">',
  '    <h2>结论</h2><p>便签支持 <strong>富文本</strong> 与表格</p>',
  '    <table><tbody><tr><td>甲</td><td>乙</td></tr></tbody></table>',
  '    <button type="button">复制</button>',
  '  </div>',
  '  <div data-turn-tail="3" class="tail-host"></div>',
  '</div>',
].join('\n')
window.document.body.appendChild(turnHost)

const replyHost = turnHost.querySelector('.tail-host')
const replyRoot = ReactDOMClient.createRoot(replyHost)
let replyRenderError = null
try {
  flushSync(() => {
    replyRoot.render(React.createElement(replyReg.component, { t: ctx.locale.bind() }))
  })
} catch (error) {
  replyRenderError = error
}
const replyButton = replyHost.querySelector('button.dsn-inline-action[data-dsn-reply-save]')
check('reply row renders the save button', replyRenderError === null && !!replyButton,
  replyRenderError ? String(replyRenderError) : (replyButton ? replyButton.className : 'no button'))
check('reply button is labelled 存便签', !!replyButton && replyButton.getAttribute('aria-label') === '存便签',
  replyButton ? String(replyButton.getAttribute('aria-label')) : 'no button')

const replyNoteBefore = store.getSnapshot().notes.length
let replyClickError = null
if (replyButton) {
  try {
    flushSync(() => { replyButton.click() })
  } catch (error) {
    replyClickError = error
  }
}
const replyNotes = store.getSnapshot().notes.filter((note) => note.text && note.text.indexOf('结论') >= 0)
check('reply button stores the rendered reply', replyClickError === null && replyNotes.length >= 1
  && store.getSnapshot().notes.length === replyNoteBefore + 1,
  replyClickError ? String(replyClickError) : `notes=${store.getSnapshot().notes.length} before=${replyNoteBefore}`)
const replyNote = replyNotes[0]
check('stored reply keeps structure but drops chrome',
  !!replyNote && replyNote.html.indexOf('甲') >= 0 && replyNote.html.indexOf('<table') >= 0
  && replyNote.html.indexOf('<button') < 0 && replyNote.html.indexOf('复制') < 0,
  replyNote ? replyNote.html.slice(0, 200) : 'no note')
check('closed reply seat is ignored', DSN.replySeat(turnHost.querySelector('.tail-host')) !== null
  && DSN.replySeat(window.document.createElement('div')) === null)
turnHost.remove()

// --------------------------------------------------------------- pip -------
check('pip feature detected as unsupported in jsdom', window.documentPictureInPicture === undefined)
let pipError = null
try { DSN.togglePip({ store, t: ctx.locale.bind(), ctx }) } catch (error) { pipError = error }
check('PiP toggle degrades gracefully when unsupported', pipError === null, pipError && String(pipError))

// ------------------------------------------------------- better-sidebar ---
const sidebarTabs = []
const sidebarModule = entry.factory(fakeRequire)
const sidebarDispose = sidebarModule.apply(Object.assign({}, ctx, {
  slots: { inject(key, callback) { return callback() }, register() { return () => {} }, registerFactory() { return () => {} } },
  get(name) {
    if (name !== 'betterSidebar') return undefined
    return {
      version: '0.28.0',
      registerTab(descriptor) {
        sidebarTabs.push(descriptor)
        return () => {}
      },
    }
  },
}))
check('better-sidebar tab registered when the service exists', sidebarTabs.length === 1,
  `count=${sidebarTabs.length}`)
if (sidebarTabs.length === 1) {
  const tab = sidebarTabs[0]
  check('better-sidebar tab descriptor is well formed',
    tab.id === 'dsh-sticky-board' && typeof tab.title === 'string' && typeof tab.component === 'function' && tab.icon != null,
    JSON.stringify({ id: tab.id, title: tab.title, icon: typeof tab.icon, component: typeof tab.component }))
}
sidebarDispose()

// ------------------------------------------------ priorities, tasks, comments
const noteOf = (id) => store.getSnapshot().notes.filter((note) => note.id === id)[0]
const extraId = store.actions.addNote({ html: '<p>extras</p>', text: 'extras' })
check('a new note starts at the normal priority', noteOf(extraId).priority === 'normal',
  noteOf(extraId) && noteOf(extraId).priority)
store.actions.setPriority(extraId, 'urgent')
check('priority can be raised', noteOf(extraId).priority === 'urgent')
store.actions.setPriority(extraId, 'nonsense')
check('an unknown priority falls back to normal', noteOf(extraId).priority === 'normal')
store.actions.setPriority(extraId, 'high')

const taskId = store.actions.addTask(extraId, '  第一条   待办  ')
check('addTask trims and stores the item',
  !!taskId && noteOf(extraId).tasks.length === 1 && noteOf(extraId).tasks[0].text === '第一条 待办',
  JSON.stringify(noteOf(extraId).tasks))
check('a blank task is refused', store.actions.addTask(extraId, '   ') === null)
store.actions.toggleTask(extraId, taskId)
check('toggleTask marks it done', noteOf(extraId).tasks[0].done === true)
check('the update stamp moved with the checklist',
  noteOf(extraId).updatedAt >= noteOf(extraId).createdAt)
store.actions.clearDoneTasks(extraId)
check('clearDoneTasks drops the finished item', noteOf(extraId).tasks.length === 0)
const secondTask = store.actions.addTask(extraId, 'keep me')
store.actions.removeTask(extraId, secondTask)
check('removeTask deletes the item', noteOf(extraId).tasks.length === 0)

const commentId = store.actions.addComment(extraId, '<b>不错</b>', '不错')
check('addComment stores a sanitized comment',
  !!commentId && noteOf(extraId).comments.length === 1 && noteOf(extraId).comments[0].html.indexOf('<b>') >= 0,
  JSON.stringify(noteOf(extraId).comments))
check('an empty comment is refused', store.actions.addComment(extraId, '<p>  </p>', '  ') === null)
store.actions.removeComment(extraId, commentId)
check('removeComment deletes the comment', noteOf(extraId).comments.length === 0)

// Round-trip: the document must survive storage and the Host file unchanged.
store.actions.addTask(extraId, '持久化待办')
store.actions.addComment(extraId, '<p>持久化评论</p>', '持久化评论')
const roundTrip = DSN.normalizeState(JSON.parse(JSON.stringify(store.getSnapshot())), mergeDict)
const roundTripNote = roundTrip.notes.filter((note) => note.id === extraId)[0]
check('normalizeState keeps the priority', roundTripNote.priority === 'high', roundTripNote.priority)
check('normalizeState keeps the checklist', roundTripNote.tasks.length === 1 && roundTripNote.tasks[0].text === '持久化待办')
check('normalizeState keeps the comments', roundTripNote.comments.length === 1)
check('an unknown priority string normalizes to normal',
  DSN.normalizeState({ notes: [{ id: 'x', priority: 'bogus' }] }).notes[0].priority === 'normal')

// Merging two machines must not lose comments someone else wrote.
const unionMerge = DSN.mergeStates(
  {
    sections: [{ id: 'sec-inbox', name: 'Inbox', order: 0 }],
    notes: [{
      id: 'shared', sectionId: 'sec-inbox', html: '<p>local</p>', text: 'local', updatedAt: 10,
      priority: 'high',
      tasks: [{ id: 't-local', text: 'mine', done: false }],
      comments: [{ id: 'c-local', html: '<p>mine</p>', text: 'mine', createdAt: 5 }],
    }],
    ui: { activeSectionId: 'sec-inbox' },
  },
  {
    sections: [{ id: 'sec-inbox', name: 'Inbox', order: 0 }],
    notes: [{
      id: 'shared', sectionId: 'sec-inbox', html: '<p>remote</p>', text: 'remote', updatedAt: 20,
      priority: 'urgent',
      tasks: [{ id: 't-remote', text: 'theirs', done: true }],
      comments: [{ id: 'c-remote', html: '<p>theirs</p>', text: 'theirs', createdAt: 30 }],
    }],
    ui: { activeSectionId: 'sec-inbox' },
  },
  mergeDict,
)
const shared = unionMerge.notes.filter((note) => note.id === 'shared')[0]
check('merge takes the newer body', shared.text === 'remote', shared.text)
check('merge takes the newer priority', shared.priority === 'urgent', shared.priority)
check('merge unions the checklists by id', shared.tasks.length === 2,
  JSON.stringify(shared.tasks.map((task) => task.id)))
check('merge unions the comments by id', shared.comments.length === 2,
  JSON.stringify(shared.comments.map((comment) => comment.id)))
check('merged comments stay in time order', shared.comments[0].createdAt <= shared.comments[1].createdAt)

// ------------------------------------------- themed select menu ------------
const menuHost = document.createElement('div')
document.body.appendChild(menuHost)
const menuRoot = ReactDOMClient.createRoot(menuHost)
const menuPicks = []
let menuRenderedValue = ''
function MenuHarness() {
  const [value, setValue] = React.useState('time')
  menuRenderedValue = value
  return React.createElement(DSN.SelectMenu, {
    t: DSN.fallbackT,
    value,
    ariaLabel: 'sort by',
    options: [{ value: 'time', label: 'time' }, { value: 'priority', label: 'priority' }],
    onChange: (next) => { menuPicks.push(next); setValue(next) },
  })
}
flushSync(() => menuRoot.render(React.createElement(MenuHarness)))
const menuTrigger = menuHost.querySelector('.dsn-select')
check('select menu renders a themed trigger',
  !!menuTrigger && menuTrigger.getAttribute('aria-haspopup') === 'listbox')
check('select menu trigger shows the current option', menuTrigger.textContent.indexOf('time') >= 0)
check('select menu has no native select', menuHost.querySelectorAll('select').length === 0)
flushSync(() => menuTrigger.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
const portalMenu = document.body.querySelector('.dsn-menu')
check('opening the menu portals it out of the trigger', !!portalMenu && portalMenu.parentNode === document.body)
check('the menu lists one row per option', document.body.querySelectorAll('.dsn-menu .dsn-menu-item').length === 2)
const priorityRow = document.body.querySelector('.dsn-menu .dsn-menu-item[data-value="priority"]')
check('the current option is marked selected',
  document.body.querySelector('.dsn-menu .dsn-menu-item.is-selected').getAttribute('data-value') === 'time')
flushSync(() => priorityRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
check('choosing a row reports the new value', menuPicks.length === 1 && menuPicks[0] === 'priority',
  JSON.stringify(menuPicks))
check('choosing a row closes the menu', !document.body.querySelector('.dsn-menu'))
check('the trigger now shows the chosen option', menuHost.querySelector('.dsn-select').textContent.indexOf('priority') >= 0)
flushSync(() => menuTrigger.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
check('the menu reopens on a second click', !!document.body.querySelector('.dsn-menu'))
flushSync(() => {
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
})
check('Escape closes the menu', !document.body.querySelector('.dsn-menu'))
check('Escape does not change the value', menuRenderedValue === 'priority')

// -------------------------------- comments inside detached windows ----------
const floatNoteId = store.actions.addNote({ html: '<p>窗口里的便签</p>', text: '窗口里的便签', priority: 'high' })
store.actions.addComment(floatNoteId, DSN.textToHtml('窗口里的评论'), '窗口里的评论')
const floatHost = document.createElement('div')
document.body.appendChild(floatHost)
const floatRoot = ReactDOMClient.createRoot(floatHost)
flushSync(() => floatRoot.render(React.createElement(DSN.FloaterLayer, { store, t: DSN.fallbackT })))
check('floater layer renders nothing without entries', floatHost.querySelectorAll('.dsn-float').length === 0)
store.actions.addFloater(floatNoteId, { x: 40, y: 40, w: 360, h: 320 })
flushSync(() => {})
const floatWin = floatHost.querySelector('.dsn-float[data-dsn-float="' + floatNoteId + '"]')
check('a floater entry mounts a detached window', !!floatWin)
check('detached window renders the note body',
  !!floatWin && floatWin.textContent.indexOf('窗口里的便签') >= 0)
check('detached window header shows the priority pill', !!floatWin.querySelector('.dsn-float-head .dsn-prio'))
const floatThread = floatWin.querySelector('.dsn-comments')
check('detached window shows the comment thread', !!floatThread)
check('detached window uses the compact thread variant',
  !!floatThread && floatThread.className.indexOf('dsn-comments--compact') >= 0)
check('detached window lists the stored comment',
  !!floatThread && floatThread.textContent.indexOf('窗口里的评论') >= 0)
const floatBox = floatWin.querySelector('.dsn-comment-input')
check('detached window offers a comment box', !!floatBox)
floatBox.value = '从窗口发的评论'
const floatSend = floatWin.querySelector('.dsn-comment-formbar .dsn-btn-primary')
flushSync(() => floatSend.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
const floatNoteAfter = noteOf(floatNoteId)
check('a comment typed in the detached window is stored',
  floatNoteAfter.comments.length === 2, JSON.stringify(floatNoteAfter.comments.map((c) => c.text)))
check('detached window re-renders the new comment',
  floatHost.querySelector('.dsn-float').textContent.indexOf('从窗口发的评论') >= 0)
check('the note still keeps its own priority', floatNoteAfter.priority === 'high')
store.actions.removeFloater(floatNoteId)
flushSync(() => {})
check('closing the floater removes the window', !floatHost.querySelector('.dsn-float'))
flushSync(() => floatRoot.unmount())
flushSync(() => menuRoot.unmount())
floatHost.remove()
menuHost.remove()
store.actions.purgeNote(floatNoteId)

// --------------------------------------- composer saves and clears ----------
store.actions.setView('board')
flushSync(() => {})
const composerEditor = document.querySelector('.dsn-composer [contenteditable="true"]')
check('the composer editor is mounted in the board view', !!composerEditor)
if (composerEditor) {
  const beforeSave = store.getSnapshot().notes.length
  composerEditor.focus()
  composerEditor.innerHTML = '<p>随手记一条</p>'
  flushSync(() => {
    composerEditor.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
  check('the composer keeps focus while typing', document.activeElement === composerEditor,
    String(document.activeElement && document.activeElement.className))
  // Let the editor's debounce hand the draft to React, the way typing does.
  await new Promise((resolve) => setTimeout(resolve, 200))
  flushSync(() => {
    composerEditor.dispatchEvent(new window.KeyboardEvent('keydown', {
      key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true,
    }))
  })
  const savedCount = store.getSnapshot().notes.length
  check('Ctrl+Enter in the composer stores a note', savedCount === beforeSave + 1,
    beforeSave + ' -> ' + savedCount)
  check('the stored note carries the composer text', text().indexOf('随手记一条') >= 0)
  check('saving clears the composer even though it keeps focus',
    document.activeElement === composerEditor, 'focus moved away')
  check('the composer DOM is empty after saving',
    composerEditor.textContent.trim() === '' && composerEditor.innerHTML === '',
    JSON.stringify(composerEditor.innerHTML))
  check('the empty composer shows its placeholder again',
    composerEditor.getAttribute('data-empty') === 'true')
  const draftNote = store.getSnapshot().notes.filter((note) => String(note.text).indexOf('随手记一条') >= 0)[0]
  check('the composer draft became exactly one note', !!draftNote)
  if (draftNote) store.actions.purgeNote(draftNote.id)
}

// --------------------------------------- one way to add a section ----------
const addLabel = ctx.locale.bind()('section.add')
const addControls = Array.prototype.slice
  .call(document.querySelectorAll('button'))
  .filter((node) => node.getAttribute('aria-label') === addLabel)
check('exactly one control creates a section', addControls.length === 1,
  addControls.length + ': ' + addControls.map((node) => node.className).join(' | '))
check('the remaining add-section control lives in the rail',
  addControls.length === 1 && addControls[0].className.indexOf('is-add') >= 0,
  addControls.map((node) => node.className).join(' | '))

store.actions.purgeNote(extraId)
check('the temporary note is gone', !noteOf(extraId))

// ------------------------------------------------------------------ cleanup ---
let disposeError = null
try { dispose() } catch (error) { disposeError = error }
check('dispose() does not throw', disposeError === null, disposeError && String(disposeError))

report()
