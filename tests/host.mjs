// Host-half checks: the durable-storage route and its JSON document.
//
// The host half owns `<profile>/plugin-data/dsh-sticky-board/notes.json` and
// answers `/dsh-sticky-board/data`. This harness mounts it against a fake
// Cordis context, drives the raw (req, res) handler and inspects the files.
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const checks = []
let failures = 0

/**
 * Record one assertion.
 * @param name - what is being checked.
 * @param ok - the outcome.
 * @param detail - optional context printed on failure.
 */
function check(name, ok, detail) {
  checks.push({ name, ok })
  if (!ok) failures += 1
  const suffix = detail === undefined ? '' : ` — ${detail}`
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : suffix}`)
}

/**
 * Report the summary and set the exit code.
 */
function report() {
  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} ${checks.length - failures}/${checks.length} host checks`)
  if (failures > 0) process.exitCode = 1
}

const profileRoot = mkdtempSync(join(tmpdir(), 'dsn-host-'))
process.env.DSH_PROFILE_DIR = profileRoot
// Keep the shared `~/.dsh/plugin-data` lookup inside the sandbox: the real home
// directory holds the developer's own board, and the first empty read would
// adopt it (that is the behaviour, not a bug, but it makes this file useless).
const sandboxHome = mkdtempSync(join(tmpdir(), 'dsn-home-'))
process.env.USERPROFILE = sandboxHome
process.env.HOME = sandboxHome
const dataDir = join(profileRoot, 'plugin-data', 'dsh-sticky-board')
const dataFile = join(dataDir, 'notes.json')
const backupFile = join(dataDir, 'notes.bak.json')
const markerFile = join(dataDir, 'host.json')

const host = await import('../index.js')

const routes = []
const effects = []
const webServer = {
  register(route) {
    routes.push(route)
    return () => { routes.length = 0 }
  },
}
const ctx = {
  get(name) { return name === 'webServer' ? webServer : undefined },
  effect(fn, label) {
    const dispose = fn()
    effects.push({ label, dispose })
    return () => { if (typeof dispose === 'function') dispose() }
  },
  logger: { warn(message) { console.log(`  warn ${message}`) } },
}

check('host half exports apply', typeof host.apply === 'function')

let applyThrew = null
try {
  host.apply(ctx)
} catch (error) {
  applyThrew = error
}
check('host apply does not throw', applyThrew === null, applyThrew && String(applyThrew).slice(0, 300))
check('data route registered', routes.length === 1, String(routes.length))
const route = routes[0]
check('route is a prefix route', !!route && route.kind === 'prefix' && route.path === '/dsh-sticky-board/data',
  route && `${route.kind} ${route.path}`)

await new Promise((resolve) => setTimeout(resolve, 120))
check('data directory prepared', existsSync(dataDir), dataDir)
check('discovery marker written', existsSync(markerFile))
if (existsSync(markerFile)) {
  const marker = JSON.parse(readFileSync(markerFile, 'utf8'))
  check('marker points at the data route', marker.route === '/dsh-sticky-board/data', marker.route)
  check('marker records the profile directory', marker.directory === dataDir, marker.directory)
}

/**
 * Invoke the raw route handler the way the HTTP server does.
 * @param method - HTTP method.
 * @param body - optional request body text.
 * @returns `{ status, headers, body, json }`.
 */
function call(method, body) {
  return new Promise((resolve, reject) => {
    const request = new EventEmitter()
    request.method = method
    request.url = '/dsh-sticky-board/data'
    const response = {
      status: 0,
      headers: {},
      chunks: [],
      headersSent: false,
      writeHead(status, headers) {
        this.status = status
        this.headers = headers || {}
        this.headersSent = true
      },
      end(chunk) {
        if (chunk !== undefined) this.chunks.push(Buffer.from(chunk))
        const text = Buffer.concat(this.chunks).toString('utf8')
        let parsed = null
        try { parsed = text === '' ? null : JSON.parse(text) } catch (error) { parsed = null }
        resolve({ status: this.status, headers: this.headers, body: text, json: parsed })
      },
    }
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 5000)
    const originalEnd = response.end.bind(response)
    response.end = (chunk) => {
      clearTimeout(timer)
      originalEnd(chunk)
    }
    try {
      route.handler(request, response)
    } catch (error) {
      clearTimeout(timer)
      reject(error)
      return
    }
    if (body === undefined) return
    // Deliver the body once the handler attached its stream listeners.
    const deliver = () => {
      if (request.listenerCount('data') === 0) {
        setTimeout(deliver, 5)
        return
      }
      request.emit('data', Buffer.from(body, 'utf8'))
      request.emit('end')
    }
    setTimeout(deliver, 5)
  })
}

const emptyGet = await call('GET')
check('empty document answers 200', emptyGet.status === 200, String(emptyGet.status))
check('empty document is flagged empty', emptyGet.json && emptyGet.json.empty === true)
check('empty document reports the file path', emptyGet.json && emptyGet.json.file === dataFile, emptyGet.json && emptyGet.json.file)

const document = {
  savedAt: 1700000000000,
  savedBy: 'harness',
  state: {
    version: 1,
    sections: [{ id: 'sec-inbox', name: '收集箱', order: 0 }],
    notes: [{ id: 'note-1', sectionId: 'sec-inbox', html: '<p>持久化</p>', text: '持久化', kind: 'text', createdAt: 1, updatedAt: 2 }],
    ui: { open: true, activeSectionId: 'sec-inbox', view: 'board' },
  },
}

const put = await call('PUT', JSON.stringify(document))
check('PUT stores the document', put.status === 200, `${put.status} ${put.body.slice(0, 120)}`)
check('PUT reports stored bytes', put.json && put.json.bytes > 0, put.json && String(put.json.bytes))
check('document file exists', existsSync(dataFile))
if (existsSync(dataFile)) {
  const stored = JSON.parse(readFileSync(dataFile, 'utf8'))
  check('stored document keeps savedAt', stored.savedAt === document.savedAt, String(stored.savedAt))
  check('stored document keeps the note', stored.state.notes[0].text === '持久化', stored.state.notes[0].text)
}
check('chinese text survives as UTF-8', readFileSync(dataFile, 'utf8').includes('持久化'))

const reload = await call('GET')
check('GET returns the stored state', reload.json && reload.json.state && reload.json.state.notes.length === 1)
check('GET returns the stored savedAt', reload.json && reload.json.savedAt === document.savedAt, reload.json && String(reload.json.savedAt))
check('GET is not flagged empty', reload.json && reload.json.empty === false)

const second = JSON.parse(JSON.stringify(document))
second.savedAt = 1700000001000
second.state.notes.push({ id: 'note-2', sectionId: 'sec-inbox', html: '<p>二</p>', text: '二', kind: 'text', createdAt: 3, updatedAt: 4 })
const putTwo = await call('PUT', JSON.stringify(second))
check('second PUT succeeds', putTwo.status === 200, String(putTwo.status))
check('previous document kept as backup', existsSync(backupFile))
if (existsSync(backupFile)) {
  const backup = JSON.parse(readFileSync(backupFile, 'utf8'))
  check('backup holds the previous revision', backup.state.notes.length === 1, String(backup.state.notes.length))
}

const bad = await call('PUT', '{not json')
check('invalid JSON is rejected', bad.status === 400, String(bad.status))
const wrongShape = await call('PUT', JSON.stringify({ savedAt: 1 }))
check('document without state is rejected', wrongShape.status === 400, String(wrongShape.status))

const methodNotAllowed = await call('PATCH')
check('unknown method answers 405', methodNotAllowed.status === 405, String(methodNotAllowed.status))
const head = await call('HEAD')
check('HEAD answers 200', head.status === 200, String(head.status))

writeFileSync(dataFile, 'garbage{{{', 'utf8')
const afterCorrupt = await call('GET')
check('corrupt document falls back to empty', afterCorrupt.json && afterCorrupt.json.empty === true)
check('corrupt document is preserved for forensics',
  readdirSync(dataDir).some((name) => name.indexOf('notes.json.corrupt-') === 0),
  readdirSync(dataDir).join(','))

await call('PUT', JSON.stringify(document))
const remove = await call('DELETE')
check('DELETE answers 200', remove.status === 200, String(remove.status))
check('DELETE removes the document', !existsSync(dataFile))
const afterDelete = await call('GET')
check('GET after DELETE is empty', afterDelete.json && afterDelete.json.empty === true)

check('effect disposer recorded', effects.length === 1, String(effects.length))
let disposeThrew = null
try {
  effects[0].dispose()
} catch (error) { disposeThrew = error }
check('route disposer does not throw', disposeThrew === null, disposeThrew && String(disposeThrew))

// ------------------------------------------------------------- adoption ---
// A `dsh web` started from a profile shell sets DSH_PROFILE_DIR and therefore
// owns a different directory than one started from a plain terminal. The first
// read in the new location must adopt the document the old one already has.

const legacyHome = mkdtempSync(join(tmpdir(), 'dsn-home-'))
const legacyDir = join(legacyHome, '.dsh', 'plugin-data', 'dsh-sticky-board')
const freshProfile = mkdtempSync(join(tmpdir(), 'dsn-profile-'))
const freshDir = join(freshProfile, 'plugin-data', 'dsh-sticky-board')
mkdirSync(legacyDir, { recursive: true })

process.env.USERPROFILE = legacyHome
process.env.HOME = legacyHome
process.env.DSH_PROFILE_DIR = freshProfile
const adoptedRoutes = []
const adoptedCtx = {
  get(name) { return name === 'webServer' ? { register(route) { adoptedRoutes.push(route); return () => {} } } : undefined },
  effect(fn) { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose() } },
  logger: { warn(message) { console.log(`  warn ${message}`) } },
}

const legacyDocument = {
  savedAt: 1700000002000,
  savedBy: 'harness',
  state: {
    version: 1,
    sections: [{ id: 'sec-inbox', name: '收集箱', order: 0 }],
    notes: [{ id: 'note-legacy', sectionId: 'sec-inbox', html: '<p>旧便签</p>', text: '旧便签', kind: 'text', createdAt: 1, updatedAt: 2 }],
    ui: { activeSectionId: 'sec-inbox', view: 'board', search: '' },
  },
}
writeFileSync(join(legacyDir, 'notes.json'), JSON.stringify(legacyDocument), 'utf8')
host.apply(adoptedCtx)
const adopted = await new Promise((resolve) => {
  setTimeout(() => {
    const route = adoptedRoutes[0]
    const request = new EventEmitter()
    request.method = 'GET'
    request.url = '/dsh-sticky-board/data'
    const response = {
      status: 0,
      headers: {},
      chunks: [],
      writeHead(status, headers) { this.status = status; this.headers = Object.assign({}, headers) },
      end(chunk) {
        const text = Buffer.concat(this.chunks.concat(chunk ? [Buffer.from(chunk)] : [])).toString('utf8')
        let json = null
        try { json = JSON.parse(text) } catch (error) { json = null }
        resolve({ status: this.status, json })
      },
    }
    request.on('data', (chunk) => response.chunks.push(Buffer.from(chunk)))
    request.on('end', () => {})
    route.handler(request, response)
    request.emit('end')
  }, 150)
})
check('fresh profile adopts the earlier document', !!(adopted.json && adopted.json.state),
  adopted.json && JSON.stringify(adopted.json).slice(0, 160))
check('adopted document keeps the earlier notes',
  !!(adopted.json && adopted.json.state && adopted.json.state.notes && adopted.json.state.notes.length === 1))
check('adopted document lands in the new directory', existsSync(join(freshDir, 'notes.json')), freshDir)
if (existsSync(join(freshDir, 'host.json'))) {
  const marker = JSON.parse(readFileSync(join(freshDir, 'host.json'), 'utf8'))
  check('marker records where the document came from', marker.adoptedFrom === legacyDir, marker.adoptedFrom)
  check('marker says the route is registered', marker.registered === true, String(marker.registered))
}

report()
