// End-to-end durability test: the real client bundle against the real Host
// handler, wired through a stubbed window.fetch. Proves the round trip
// browser ⇄ <profile>/plugin-data/dsh-sticky-board/notes.json.
// Run with:  node tests/sync.mjs
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
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

let failures = 0
let total = 0
/**
 * Record one assertion.
 * @param name - what is being checked.
 * @param ok - the outcome.
 * @param detail - optional context printed on failure.
 */
function check(name, ok, detail) {
  total += 1
  if (!ok) failures += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ` — ${detail}`}`)
}

/**
 * Poll until a predicate holds.
 * @param predicate - the condition.
 * @param label - what we are waiting for.
 * @param timeout - milliseconds before giving up.
 * @returns true when it held.
 */
async function waitFor(predicate, label, timeout) {
  const deadline = Date.now() + (timeout || 4000)
  for (;;) {
    let value = false
    try { value = predicate() } catch (error) { value = false }
    if (value) return true
    if (Date.now() > deadline) {
      console.log(`  ..   timed out waiting for ${label}`)
      return false
    }
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
}

// ------------------------------------------------------------- host half ----
const profileRoot = mkdtempSync(join(tmpdir(), 'dsn-sync-'))
process.env.DSH_PROFILE_DIR = profileRoot
const dataDir = join(profileRoot, 'plugin-data', 'dsh-sticky-board')
const dataFile = join(dataDir, 'notes.json')

const host = await import('../index.js')
const routes = []
const hostCtx = {
  get(name) { return name === 'webServer' ? { register(route) { routes.push(route); return () => {} } } : undefined },
  effect(fn) { return fn() || (() => {}) },
  logger: { warn() {} },
}
host.apply(hostCtx)
check('host route registered', routes.length === 1, String(routes.length))
const route = routes[0]

/**
 * Drive the host handler exactly like the HTTP server does.
 * @param method - HTTP method.
 * @param body - optional request body.
 * @returns the HTTP-shaped result.
 */
function callHost(method, body) {
  return new Promise((resolve, reject) => {
    const request = new EventEmitter()
    request.method = method
    request.url = '/dsh-sticky-board/data'
    const chunks = []
    let status = 0
    let headers = {}
    const response = {
      writeHead(code, list) { status = code; headers = list || {} },
      write(chunk) { chunks.push(Buffer.from(chunk)) },
      end(chunk) {
        if (chunk !== undefined) chunks.push(Buffer.from(chunk))
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({
          ok: status >= 200 && status < 300,
          status,
          headers,
          text,
          json: async () => (text === '' ? null : JSON.parse(text)),
        })
      },
    }
    try {
      route.handler(request, response)
    } catch (error) {
      reject(error)
      return
    }
    if (body === undefined) return
    const deliver = () => {
      if (request.listenerCount('data') === 0) { setTimeout(deliver, 5); return }
      request.emit('data', Buffer.from(body, 'utf8'))
      request.emit('end')
    }
    setTimeout(deliver, 5)
  })
}

/**
 * Read the document the Host wrote to disk.
 * @returns the parsed document, or null.
 */
function storedDocument() {
  if (!existsSync(dataFile)) return null
  try { return JSON.parse(readFileSync(dataFile, 'utf8')) } catch (error) { return null }
}

// Seed the durable file as if another window had already used it.
const seeded = {
  savedAt: 1700000000000,
  savedBy: 'seed',
  state: {
    version: 1,
    sections: [{ id: 'sec-inbox', name: '收集箱', order: 0 }],
    notes: [{ id: 'note-remote', sectionId: 'sec-inbox', html: '<p>来自另一个窗口</p>', text: '来自另一个窗口', kind: 'text', createdAt: 1700000000000, updatedAt: 1700000000000, pinned: false }],
    ui: { open: true, activeSectionId: 'sec-inbox', view: 'board', search: '', seen: true },
  },
}
const seedPut = await callHost('PUT', JSON.stringify(seeded))
check('seeded the durable document', seedPut.status === 200, String(seedPut.status))
check('seeded note is on disk', !!(storedDocument() && storedDocument().state.notes.length === 1))

// ------------------------------------------------------------ client half ---
const dom = new JSDOM('<!doctype html><html data-theme="light"><head></head><body><div id="host"></div></body></html>', {
  url: 'http://127.0.0.1:3080/',
  pretendToBeVisual: true,
})
const { window } = dom

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
defineGlobal('DragEvent', window.DragEvent)
defineGlobal('getComputedStyle', window.getComputedStyle.bind(window))
defineGlobal('requestAnimationFrame', (fn) => setTimeout(() => fn(Date.now()), 0))
defineGlobal('cancelAnimationFrame', (id) => clearTimeout(id))
defineGlobal('ResizeObserver', window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} })
defineGlobal('MutationObserver', window.MutationObserver)
defineGlobal('FileReader', window.FileReader)
defineGlobal('localStorage', window.localStorage)

let offline = false
let fetchCalls = []
window.fetch = async (url, init) => {
  fetchCalls.push({ url: String(url), method: (init && init.method) || 'GET' })
  if (offline) throw new Error('offline')
  return callHost((init && init.method) || 'GET', init && init.body)
}

const React = requireFromRoot(reactPath)
const ReactDOMClient = requireFromRoot(join(reactDomPath, 'client.js'))
let entry = null
window.__ModuleLoader__ = { load(spec) { entry = spec } }
runInThisContext(readFileSync(join(root, 'client.js'), 'utf8'), { filename: 'client.js' })
const mod = entry.factory((name) => {
  if (name === 'react') return React
  if (name === 'react-dom/client') return ReactDOMClient
  throw new Error('unexpected require: ' + name)
})

const localeTable = { zh: {}, en: {} }
const ctx = {
  slots: { inject(key, callback) { return callback() }, register() { return () => {} }, registerFactory() { return () => {} } },
  locale: {
    register(ns, locale, dict) { Object.assign(localeTable[locale], dict); return () => {} },
    bind() { return (key) => (localeTable.zh[key] != null ? localeTable.zh[key] : key) },
    getLocale() { return 'zh' },
  },
  uiConversation: { interactions: { register() { return () => {} } } },
  effect(callback) { const result = callback(); return () => { if (typeof result === 'function') result() } },
  get() { return undefined },
  logger: { info() {}, warn() {}, error() {}, debug() {} },
}

const dispose = mod.apply(ctx)
const DSN = window.__DSH_STICKY_BOARD__
const store = DSN && DSN.store
check('bundle applied with a store', !!store)
check('sync layer installed', typeof DSN.installSync === 'function' && !!DSN.syncStatus)

// Boot: the empty browser adopts the seeded note and pushes the merged copy.
const booted = await waitFor(
  () => DSN.syncStatus.getSnapshot().state === 'saved' && store.getSnapshot().notes.some((note) => note.id === 'note-remote'),
  'boot merge',
)
check('boot merged the durable document', booted, JSON.stringify(DSN.syncStatus.getSnapshot()))
check('boot issued a GET', fetchCalls.some((call) => call.method === 'GET'), JSON.stringify(fetchCalls))
check('boot state is pushed back', await waitFor(() => (storedDocument() || {}).state !== undefined, 'push after boot'))
check('merged note survived the push',
  !!(storedDocument() && storedDocument().state.notes.some((note) => note.id === 'note-remote')))

// A local edit reaches the file after the debounce.
const addedId = store.actions.addNote({ html: '<p>本地新增</p>', text: '本地新增' })
const pushed = await waitFor(
  () => !!(storedDocument() && storedDocument().state.notes.some((note) => note.id === addedId)),
  'local note pushed',
)
check('local note reaches the file', pushed, JSON.stringify((storedDocument() || {}).state && storedDocument().state.notes.map((note) => note.id)))
check('status settles on saved', await waitFor(() => DSN.syncStatus.getSnapshot().state === 'saved', 'saved status'))

// An edit while the Host is unreachable surfaces an error, and pagehide retries.
offline = true
store.actions.addNote({ html: '<p>离线</p>', text: '离线' })
const errored = await waitFor(() => DSN.syncStatus.getSnapshot().state === 'error', 'error status')
check('failed push reports an error', errored, JSON.stringify(DSN.syncStatus.getSnapshot()))
offline = false
window.dispatchEvent(new window.Event('pagehide'))
const retried = await waitFor(
  () => DSN.syncStatus.getSnapshot().state === 'saved'
    && !!(storedDocument() && storedDocument().state.notes.length === 3),
  'pagehide retry',
)
check('pagehide flushes the pending document', retried,
  JSON.stringify({ status: DSN.syncStatus.getSnapshot(), notes: (storedDocument() || {}).state && storedDocument().state.notes.length }))

// The stale browser copy must not clobber a newer durable note: merge keeps both.
const localCopy = store.getSnapshot()
const older = JSON.parse(JSON.stringify(seeded.state))
older.notes[0].html = '<p>旧版本</p>'
older.notes[0].text = '旧版本'
older.notes[0].updatedAt = 1600000000000
const mergedManually = DSN.mergeStates(localCopy, older, (key) => key)
check('merge keeps the newer revision', mergedManually.notes.some((note) => note.id === 'note-remote' && note.text === '来自另一个窗口'))
check('merge keeps local-only notes', mergedManually.notes.length >= 3, String(mergedManually.notes.length))

// localStorage stays the fast copy in parallel.
const mirrored = window.localStorage.getItem('dsh-notes/v1')
check('browser copy is persisted', !!mirrored && mirrored.indexOf('note-remote') >= 0)

dispose()
check('dispose does not throw', true)
const callsAfterDispose = fetchCalls.length
store.actions.addNote({ html: '<p>关闭后</p>', text: '关闭后' })
await new Promise((resolve) => setTimeout(resolve, 1200))
check('disposed sync stops pushing', fetchCalls.length === callsAfterDispose, `${fetchCalls.length} vs ${callsAfterDispose}`)

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} ${total - failures}/${total} sync checks`)
if (failures > 0) process.exitCode = 1
