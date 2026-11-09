// A tiny static server for the visual harness that ALSO mounts the real Host
// data route, so the browser can exercise durable storage over genuine HTTP
// (location.protocol === 'http:' is what the client sync layer requires).
//
//   node tests/visual/serve.mjs [--port=8791] [--dir=<profile-dir>]
//
// It prints the harness URL and stays up until interrupted.
import { readFileSync, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')

function arg(name, fallback) {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const port = Number(arg('port', '8791'))
const profile = arg('dir', '') || mkdtempSync(join(tmpdir(), 'dsn-serve-'))
process.env.DSH_PROFILE_DIR = profile

const host = await import(pathToFileURL(join(root, 'index.js')).href)
const routes = []
const routeCtx = {
  get(name) {
    if (name !== 'webServer') return undefined
    return { register(route) { routes.push(route); return () => {} } }
  },
  effect(fn) { return fn() || (() => {}) },
  logger: { warn(message) { console.log(`[host] ${message}`) } },
}
host.apply(routeCtx)
const dataRoute = routes[0]

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

/**
 * Resolve a request path to a file under the allowed roots.
 * @param pathname - the URL path.
 * @returns the absolute file path, or null.
 */
function resolveStatic(pathname) {
  const clean = decodeURIComponent(pathname.split('?')[0])
  if (clean === '/' || clean === '') return join(here, 'index.html')
  const candidates = [join(here, clean), join(root, clean.replace(/^\/+/, ''))]
  for (const candidate of candidates) {
    const absolute = resolve(candidate)
    if (!absolute.startsWith(here + sep) && !absolute.startsWith(root + sep) && absolute !== join(root, 'client.js')) continue
    if (!existsSync(absolute)) continue
    if (statSync(absolute).isDirectory()) continue
    return absolute
  }
  return null
}

const server = createServer((request, response) => {
  const url = new URL(request.url || '/', `http://127.0.0.1:${port}`)
  if (url.pathname === '/dsh-sticky-board/data') {
    dataRoute.handler(request, response)
    return
  }
  const file = resolveStatic(url.pathname)
  if (!file) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('not found')
    return
  }
  try {
    const body = readFileSync(file)
    response.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
      'content-length': String(body.length),
    })
    response.end(body)
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('read failed: ' + error.message)
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`harness: http://127.0.0.1:${port}/index.html`)
  console.log(`data:    http://127.0.0.1:${port}/dsh-sticky-board/data`)
  console.log(`profile: ${profile}`)
})

process.on('SIGINT', () => { server.close(() => process.exit(0)) })
