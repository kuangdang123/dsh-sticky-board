// Deterministic screenshot + assertion harness over the Chrome DevTools
// Protocol. `chrome --headless --screenshot` fires the capture on its own
// schedule, which is what made the capture chip look "missing": the page is
// still settling when the shot is taken. Here we wait for the DOM to reach the
// expected state inside the page, then capture.
//
//   node tests/visual/cdp-shot.mjs --url='...' --out=shot.png --wait='selector'
//
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
]

function arg(name, fallback) {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) if (candidate && existsSync(candidate)) return candidate
  throw new Error('chrome not found')
}

const url = arg('url', 'file:///D:/Desktop/dsh-sticky-board/tests/visual/index.html')
const out = arg('out', 'D:\\Desktop\\dsh-sticky-board\\tests\\visual\\cdp-shot.png')
const waitFor = arg('wait', '')
const clickTarget = arg('click', '')
const viewport = Number(arg('width', '1180'))
const height = Number(arg('height', '880'))
const port = 9400 + Math.floor(Math.random() * 200)
const profile = mkdtempSync(join(tmpdir(), 'dsn-cdp-'))

const chrome = spawn(findChrome(), [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  `--user-data-dir=${profile}`,
  `--window-size=${viewport},${height}`,
  '--allow-file-access-from-files',
  `--remote-debugging-port=${port}`,
  'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function endpoint(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`)
  if (!response.ok) throw new Error(`devtools ${path} -> ${response.status}`)
  return response.json()
}

async function main() {
  let version = null
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { version = await endpoint('/json/version'); break } catch { await sleep(100) }
  }
  if (!version) throw new Error('devtools endpoint never came up')

  const target = await (await fetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,
    { method: 'PUT' },
  )).json()

  const socket = new WebSocket(target.webSocketDebuggerUrl)
  let nextId = 1
  const pending = new Map()
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(message.error.message))
    else entry.resolve(message.result)
  })

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: viewport, height, deviceScaleFactor: 1, mobile: false,
  })

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result.value
  }

  // Give the bundle time to apply, then optionally wait for a selector.
  const ready = await evaluate(`(async () => {
    const waitFor = ${JSON.stringify(waitFor)}
    const deadline = Date.now() + 12000
    while (Date.now() < deadline) {
      const hit = waitFor ? document.querySelector(waitFor) : document.body
      if (hit) return true
      await new Promise((resolve) => setTimeout(resolve, 60))
    }
    return false
  })()`)
  await sleep(700)
  // Optional probe: `--eval=<expression>` prints a JSON result before the
  // screenshot, which makes it a one-liner inspector for store/DOM questions.
  const probe = arg('eval', '')
  if (probe) {
    try {
      console.log('eval:', JSON.stringify(await evaluate(probe), null, 1))
    } catch (error) {
      console.log('eval failed:', error.message)
    }
  }

  // Optional real-input click: `Input.dispatchMouseEvent` goes through the
  // browser's own input pipeline, so pointer capture / preventDefault behave
  // exactly as they do for a human — unlike `element.click()` in a unit test.
  let clickReport = null
  if (clickTarget) {
    const box = await evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(clickTarget)})
      if (!node) return null
      node.scrollIntoView({ block: 'center', inline: 'center' })
      const rect = node.getBoundingClientRect()
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2),
        count: document.querySelectorAll(${JSON.stringify(clickTarget)}).length }
    })()`)
    if (!box) {
      clickReport = { target: clickTarget, found: false }
    } else {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, button: 'none', clickCount: 0 })
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 })
      await sleep(40)
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 })
      await sleep(400)
      clickReport = await evaluate(`(() => {
        const node = document.querySelector(${JSON.stringify(clickTarget)})
        return {
          target: ${JSON.stringify(clickTarget)},
          found: true,
          at: ${JSON.stringify([box.x, box.y])},
          before: ${box.count},
          after: document.querySelectorAll(${JSON.stringify(clickTarget)}).length,
          windows: document.querySelectorAll('.dsn-float').length,
          collapsed: document.querySelectorAll('.dsn-float.is-collapsed').length,
          stillThere: !!node,
        }
      })()`)
    }
  }
  const report = await evaluate(`(() => {
    const node = document.querySelector('.dsn-capture-chip')
    const surface = document.querySelector('.dsn-surface')
    const describe = (element) => {
      if (!element) return null
      const box = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return {
        box: [Math.round(box.left), Math.round(box.top), Math.round(box.width), Math.round(box.height)],
        display: style.display, visibility: style.visibility, opacity: style.opacity,
        background: style.backgroundColor, color: style.color, zIndex: style.zIndex,
      }
    }
    return { ready: ${JSON.stringify(ready)}, chip: describe(node), surface: describe(surface) }
  })()`)
  if (clickReport) report.click = clickReport
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  process.stdout.write(`${JSON.stringify(report, null, 2)}\nwrote ${out}\n`)
  socket.close()
}

main()
  .catch((error) => { process.stderr.write(`cdp-shot failed: ${error.message}\n`); process.exitCode = 1 })
  .finally(() => {
    try { chrome.kill() } catch {}
    setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }) } catch {} }, 300)
  })
