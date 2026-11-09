/**
 * Host half of dsh-sticky-board: durable storage for the sticky-note board.
 *
 * The board itself is a browser surface, so the browser keeps its fast copy in
 * `localStorage`. This half makes the notes outlive that copy: it owns a JSON
 * file on disk and serves it to the page over one same-origin route, so any
 * browser, any window and any later session reads the same notes back.
 *
 * Contract:
 * - `GET    /dsh-sticky-board/data` -> `{ ok, empty, savedAt, file, state }`
 * - `PUT    /dsh-sticky-board/data` (JSON `{ savedAt, state }`) -> `{ ok, savedAt, bytes }`
 * - `DELETE /dsh-sticky-board/data` -> forget the stored document
 *
 * Writes are serialized, atomic (temp file + rename) and keep the previous
 * document as a `.bak` copy, so a crash mid-write cannot lose the board.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises'

/** Route the browser half talks to. */
const ROUTE_PATH = '/dsh-sticky-board/data'

/** Largest document we accept from the page (the board caps itself well below). */
const MAX_BODY_BYTES = 12 * 1024 * 1024

/** File names inside the data directory. */
const DATA_FILE = 'notes.json'
const BACKUP_FILE = 'notes.bak.json'
const MARKER_FILE = 'host.json'

/**
 * Directory names this plugin has used for its data, newest first.
 * `dsh-sticky-notes` is the name the plugin shipped under before the rename to
 * `dsh-sticky-board`; keeping it listed lets an existing board be adopted
 * instead of starting empty.
 */
const DIRECTORY_NAMES = ['dsh-sticky-board', 'dsh-sticky-notes']

/**
 * Resolve the directory this profile may own plugin data in.
 * @returns the absolute directory path.
 */
function dataDirectory() {
  const profile = process.env['DSH_PROFILE_DIR']
  if (typeof profile === 'string' && profile.trim() !== '') {
    return join(profile, 'plugin-data', DIRECTORY_NAMES[0])
  }
  return join(homedir(), '.dsh', 'plugin-data', DIRECTORY_NAMES[0])
}

/** Serialized write queue: one document mutation at a time. */
let writeQueue = Promise.resolve()

/**
 * Every directory that may hold this plugin's document, primary first.
 *
 * The location depends on `DSH_PROFILE_DIR`, which is set when `dsh web` runs
 * from a profile shell but not when it runs from a plain terminal. Enumerating
 * the alternatives keeps a moved profile from silently starting empty.
 * @returns absolute directory paths, de-duplicated, primary first.
 */
function candidateDirectories() {
  const list = [dataDirectory()]
  const root = join(homedir(), '.dsh')
  const profileDir = process.env['DSH_PROFILE_DIR']
  const profileName = process.env['DSH_PROFILE']
  for (const name of DIRECTORY_NAMES) {
    list.push(join(root, 'plugin-data', name))
    if (typeof profileDir === 'string' && profileDir.trim() !== '') {
      list.push(join(profileDir, 'plugin-data', name))
    } else if (typeof profileName === 'string' && profileName.trim() !== '') {
      list.push(join(root, 'profiles', profileName, 'plugin-data', name))
    }
  }
  const unique = []
  for (const directory of list) {
    if (unique.indexOf(directory) < 0) unique.push(directory)
  }
  return unique
}

/**
 * Copy an earlier document into the primary directory while that one is empty.
 * @param directory - the primary data directory.
 * @returns the source directory the document came from, or null when nothing was adopted.
 */
async function adoptEarlierDocument(directory) {
  const target = join(directory, DATA_FILE)
  const existing = await readFile(target, 'utf8').catch(() => null)
  if (existing !== null) return null
  for (const candidate of candidateDirectories()) {
    if (candidate === directory) continue
    const text = await readFile(join(candidate, DATA_FILE), 'utf8').catch(() => null)
    if (text === null) continue
    await mkdir(directory, { recursive: true }).catch(() => {})
    await writeFile(target, text, 'utf8').catch(() => {})
    const backup = await readFile(join(candidate, BACKUP_FILE), 'utf8').catch(() => null)
    if (backup !== null) {
      await writeFile(join(directory, BACKUP_FILE), backup, 'utf8').catch(() => {})
    }
    return candidate
  }
  return null
}

/**
 * Run one document mutation after every earlier mutation finished.
 * @param task - the mutation.
 * @returns the mutation's result.
 */
function serialize(task) {
  const next = writeQueue.then(task, task)
  writeQueue = next.then(() => undefined, () => undefined)
  return next
}

/**
 * Read the stored document.
 * @param file - absolute path.
 * @returns the parsed document or null when it does not exist yet.
 */
async function readDocument(file) {
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw error
  }
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') return null
    if (!parsed.state || typeof parsed.state !== 'object') return null
    return parsed
  } catch (error) {
    // A half-written or hand-edited file must not wedge the board: keep it for
    // forensics and start from an empty document.
    try {
      await rename(file, `${file}.corrupt-${Date.now()}`)
    } catch (renameError) { /* keep going: reporting the damage matters more */ }
    return null
  }
}

/**
 * Replace the stored document atomically, keeping the previous one as backup.
 * @param file - absolute path of the document.
 * @param backup - absolute path of the backup copy.
 * @param document - the payload to store.
 * @returns the number of bytes written.
 */
async function writeDocument(file, backup, document) {
  const text = JSON.stringify(document)
  const temporary = `${file}.tmp-${process.pid}`
  await writeFile(temporary, text, 'utf8')
  const current = await readFile(file, 'utf8').catch(() => null)
  if (current !== null) await writeFile(backup, current, 'utf8').catch(() => {})
  await rename(temporary, file)
  return text.length
}

/**
 * Collect the request body, bounded.
 * @param request - the incoming message.
 * @returns the decoded text.
 */
function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('payload-too-large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')) })
    request.on('error', reject)
  })
}

/**
 * Serve one request against the document directory.
 * @param request - the incoming message.
 * @param response - the server response.
 * @param directory - the data directory.
 * @returns resolution once the response is written.
 */
async function handle(request, response, directory) {
  const file = join(directory, DATA_FILE)
  const backup = join(directory, BACKUP_FILE)
  const method = (request.method || 'GET').toUpperCase()

  /**
   * Write one JSON response.
   * @param status - HTTP status.
   * @param payload - serializable body.
   */
  const send = (status, payload) => {
    const body = Buffer.from(JSON.stringify(payload), 'utf8')
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(body.length),
      'cache-control': 'no-store',
    })
    response.end(body)
  }

  if (method === 'GET' || method === 'HEAD') {
    const document = await readDocument(file)
    if (document === null) {
      send(200, { ok: true, empty: true, savedAt: 0, file, state: null })
      return
    }
    send(200, {
      ok: true,
      empty: false,
      savedAt: Number(document.savedAt) || 0,
      savedBy: typeof document.savedBy === 'string' ? document.savedBy : '',
      file,
      state: document.state,
    })
    return
  }

  if (method === 'PUT' || method === 'POST') {
    let text
    try {
      text = await readBody(request)
    } catch (error) {
      send(error && error.message === 'payload-too-large' ? 413 : 400, { ok: false, error: 'unreadable-body' })
      return
    }
    let payload
    try {
      payload = JSON.parse(text)
    } catch (error) {
      send(400, { ok: false, error: 'invalid-json' })
      return
    }
    if (!payload || typeof payload !== 'object' || !payload.state || typeof payload.state !== 'object') {
      send(400, { ok: false, error: 'invalid-document' })
      return
    }
    const document = {
      savedAt: Number(payload.savedAt) || Date.now(),
      savedBy: typeof payload.savedBy === 'string' ? payload.savedBy.slice(0, 120) : '',
      state: payload.state,
    }
    try {
      const bytes = await serialize(() => writeDocument(file, backup, document))
      send(200, { ok: true, savedAt: document.savedAt, bytes })
    } catch (error) {
      send(500, { ok: false, error: 'write-failed', message: String(error && error.message || error) })
    }
    return
  }

  if (method === 'DELETE') {
    await serialize(async () => {
      await rm(file, { force: true })
    })
    send(200, { ok: true, deleted: true })
    return
  }

  send(405, { ok: false, error: 'method-not-allowed' })
}

/**
 * Report a problem without ever taking the host down.
 * @param ctx - the host context.
 * @param message - what went wrong.
 */
function warn(ctx, message) {
  try {
    if (typeof ctx.logger === 'object' && ctx.logger && typeof ctx.logger.warn === 'function') {
      ctx.logger.warn(`dsh-sticky-board: ${message}`)
    }
  } catch (error) { /* nothing else to do */ }
}

/**
 * Host entry point: claim the data route and drop a discovery marker.
 * @param ctx - the host context.
 */
export function apply(ctx) {
  const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : ctx.webServer
  if (!webServer || typeof webServer.register !== 'function') {
    // `inject = ['webServer']` normally holds this open until the service exists;
    // the guard only covers direct calls (tests) and reports why nothing happened.
    warn(ctx, 'webServer service is missing, so the data route was not registered')
    return
  }

  const directory = dataDirectory()
  const ready = mkdir(directory, { recursive: true })
    .catch(() => {})
    .then(() => adoptEarlierDocument(directory))

  try {
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: ROUTE_PATH,
      handler: (request, response) => {
        ready
          .then(() => handle(request, response, directory))
          .catch((error) => {
            if (response.headersSent) {
              response.end()
              return
            }
            const body = Buffer.from(JSON.stringify({
              ok: false,
              error: 'internal',
              message: String(error && error.message || error),
            }), 'utf8')
            response.writeHead(500, {
              'content-type': 'application/json; charset=utf-8',
              'content-length': String(body.length),
            })
            response.end(body)
          })
      },
    }), 'dsh-sticky-board: data route')
  } catch (error) {
    // A duplicate route means another copy of this plugin owns the path already.
    warn(ctx, `data route not registered: ${String(error && error.message || error)}`)
    return
  }

  // The marker means "this profile really serves the data route", so it lands
  // only after the route exists: an unloaded or failed host half then stays
  // visible instead of leaving a stale marker behind.
  ready
    .then((adoptedFrom) => {
      if (adoptedFrom) warn(ctx, `adopted the stored document from ${adoptedFrom}`)
      return writeFile(join(directory, MARKER_FILE), JSON.stringify(Object.assign({
        plugin: 'dsh-sticky-board',
        route: ROUTE_PATH,
        directory,
        registered: true,
        appliedAt: new Date().toISOString(),
        pid: process.pid,
      }, adoptedFrom ? { adoptedFrom } : {}), null, 2), 'utf8')
    })
    .catch(() => {})
}

/** Package name, mirrored from package.json for diagnostics. */
export const name = 'dsh-sticky-board'

/**
 * The data route lives on the web server, so wait for that service instead of
 * sampling it: a host process applies plugins long before the server is up.
 */
export const inject = ['webServer']
