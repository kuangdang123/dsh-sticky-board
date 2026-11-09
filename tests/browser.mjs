// Real-browser self-test runner: launches headless Chrome against the visual
// harness in `?selftest=1` mode, then reads the JSON the page wrote into
// <pre id="harness-test">. Run with:  node tests/browser.mjs [--shots]
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const harness = join(here, 'visual', 'index.html')
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
]
const chrome = CHROME_CANDIDATES.find((candidate) => candidate && existsSync(candidate))
if (!chrome) {
  console.error('Chrome not found; set CHROME_PATH or install Chrome.')
  process.exit(2)
}

function chromeArgs(url, extra) {
  const profile = mkdtempSync(join(tmpdir(), 'dsn-chrome-'))
  return [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--user-data-dir=${profile}`,
    '--window-size=1280,900',
    '--virtual-time-budget=20000',
    '--allow-file-access-from-files',
    ...extra,
    url,
  ]
}

function toUrl(query) {
  const path = harness.replace(/\\/g, '/')
  return `file:///${path}?${query}`
}

function runDump(query) {
  const result = spawnSync(chrome, chromeArgs(toUrl(query), ['--dump-dom']), {
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) throw result.error
  return String(result.stdout || '')
}

function decode(text) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function extractTestJson(dom) {
  const match = /<pre id="harness-test"[^>]*>([\s\S]*?)<\/pre>/.exec(dom)
  if (!match) return null
  return JSON.parse(decode(match[1]))
}

function extractHarnessError(dom) {
  const match = /<pre id="harness-error"[^>]*>([\s\S]*?)<\/pre>/.exec(dom)
  return match ? decode(match[1]) : null
}

const query = process.argv.includes('--dark')
  ? 'selftest=1&theme=dark&panel=520x760'
  : 'selftest=1&theme=light&panel=520x760'

console.log(`chrome: ${chrome}`)
console.log(`url:    ${toUrl(query)}`)

const dom = runDump(query)
writeFileSync(join(here, 'visual', 'selftest-dom.html'), dom)

const harnessError = extractHarnessError(dom)
if (harnessError) {
  console.error(harnessError)
  process.exit(1)
}

const report = extractTestJson(dom)
if (!report) {
  console.error('No #harness-test output found; the selftest script did not finish.')
  console.error(`title: ${(/<title>([\s\S]*?)<\/title>/.exec(dom) || [])[1] || '(none)'}`)
  console.error('DOM saved to tests/visual/selftest-dom.html')
  process.exit(1)
}

for (const item of report.results) {
  if (item.ok) console.log(`  ok   ${item.name}`)
  else console.log(`  FAIL ${item.name} — ${item.error}`)
}
console.log(`\n${report.passed}/${report.total} browser checks passed in ${report.elapsed}ms`)
process.exit(report.passed === report.total ? 0 : 1)
