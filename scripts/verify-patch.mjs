// Verifies cordis.patch.yml stays a top-level YAML array without pulling in a
// YAML dependency: the DSH loader rejects a non-array boot patch (HMR fails
// with "must be a top-level YAML array"), so this script enforces the shape —
// every line must be blank, a comment, or an array item ("-") / indented
// continuation — and at least one item must exist.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
const lines = patch.split(/\r?\n/)
const problems = []
let items = 0
lines.forEach((line, i) => {
  const text = line.replace(/^\s+/, '')
  if (text === '' || text.startsWith('#')) return
  if (text.startsWith('-')) {
    items++
    return
  }
  if (line.startsWith(' ') || line.startsWith('\t')) return
  problems.push(`line ${i + 1}: expected array item ("-") or indented continuation, got: ${line}`)
})
if (items === 0) problems.push('no array items found')
if (problems.length > 0) {
  console.error('cordis.patch.yml is not a valid top-level YAML array:')
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}
console.log(`cordis.patch.yml: OK (top-level array, ${items} item(s))`)
