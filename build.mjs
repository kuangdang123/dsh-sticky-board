// Build script: concatenates the authored browser sources into the single
// plain-JS bundle the DSH client module loader expects.
//
// The client half is authored as ordinary scripts (no JSX, no imports) that all
// share one factory scope, so every file assigns onto the `DSN` namespace
// object created in `00-head.js`. Run `node build.mjs` after any edit.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))

const ORDER = [
  '00-head.js',
  '10-core.js',
  '15-i18n.js',
  '20-model.js',
  '25-sync.js',
  '30-content.js',
  '40-styles.js',
  '45-panel.js',
  '50-board.js',
  '60-capture.js',
  '65-drop.js',
  '68-float.js',
  '70-pip.js',
  '80-sidebar.js',
  '85-inline.js',
  '90-apply.js',
  '95-tail.js',
]

const parts = []
const missing = []
for (const name of ORDER) {
  let text
  try {
    text = readFileSync(join(root, 'src', name), 'utf8')
  } catch {
    missing.push(name)
    parts.push(`/* ================= ${name} (MISSING) ================= */\n`)
    continue
  }
  parts.push(`/* ================= ${name} ================= */\n${text.trimEnd()}\n`)
}
if (missing.length > 0) console.warn(`warning: missing source fragments: ${missing.join(', ')}`)

const out = parts.join('\n')
writeFileSync(join(root, 'client.js'), `${out}//# sourceURL=dsh-sticky-board/client.js\n`, 'utf8')
console.log(`client.js written (${out.length} bytes) from ${ORDER.length} source files`)
