/**
 * Functional smoke test for the v2 skin-center engine adapter.
 *
 * Builds a synthetic DSH home under a temp dir and redirects os.homedir()
 * to it (USERPROFILE on win32) BEFORE importing the host module, so no real
 * ~/.dsh is touched. Covers: v2 discovery + merge, boot reconcile
 * (legacy-active-with-twin migration + center-row lift), v2 / legacy /
 * official switching in both worlds, and the pure-legacy regression path.
 *
 * Run: node scripts/v2-smoke.mjs   (exit code 1 on any FAIL)
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

// --- redirect homedir() BEFORE the host module resolves any path ------------
const fakeHome = join(tmpdir(), `ssw-v2-${process.pid}`)
process.env.USERPROFILE = fakeHome
process.env.HOMEDRIVE = fakeHome.slice(0, 2)
process.env.HOMEPATH = fakeHome.slice(2)
delete process.env.DSH_SKINS_HOME

const mod = await import('../lib/index.js')
const {
  MANAGED_START,
  MANAGED_END,
  currentSkin,
  isV2World,
  loadRegistry,
  reconcileV2AtBoot,
  resolvePaths,
  useSkin,
} = mod

// --- helpers ------------------------------------------------------------------
let failures = 0
function check(label, cond) {
  if (cond) console.log(`PASS  ${label}`)
  else {
    failures += 1
    console.error(`FAIL  ${label}`)
  }
}
function writeJson(p, obj) {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`)
}
function w(p, text) {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, text)
}
const readActive = (p) => JSON.parse(readFileSync(p, 'utf8')).active

// --- fixture ------------------------------------------------------------------
const profileDir = join(fakeHome, '.dsh', 'profiles', 'web')
const modules = join(profileDir, 'node_modules')
const patchPath = join(fakeHome, '.dsh', 'cordis.patch.yml')
const activePath = join(fakeHome, '.dsh', 'skin-center-active.json')

writeJson(join(profileDir, 'package.json'), {
  name: 'web-profile',
  dsh: { profile: { bundles: ['@dsh-external/dsh-client-ui-skin-maid-atelier', 'dsh-skins'] } },
})

// legacy bundle-wired maid-atelier package (the v2 twin of the asset skin)
const maidDir = join(modules, '@dsh-external', 'dsh-client-ui-skin-maid-atelier')
writeJson(join(maidDir, 'package.json'), { name: '@dsh-external/dsh-client-ui-skin-maid-atelier', version: '0.0.1', main: 'index.js' })
w(join(maidDir, 'index.js'), 'export default {}\n')
writeJson(join(maidDir, 'skin.json'), {
  id: 'maid-atelier',
  package: '@dsh-external/dsh-client-ui-skin-maid-atelier',
  wiring: { id: 'ui-skin-maid-atelier', bundleWired: true },
  name: '深海女仆工坊',
})

// dsh-skins carrier bundle patch: inserts the v2 center row
const skinsDir = join(modules, 'dsh-skins')
writeJson(join(skinsDir, 'package.json'), { name: 'dsh-skins', version: '0.2.2' })
w(join(skinsDir, 'cordis.patch.yml'), "- insert:\n    - id: web-ui-skin-center\n      name: '@linxin666/dsh-client-ui-skin-center'\n")

// v2 center 0.2.2 with two builtin asset skins
const centerDir = join(modules, '@linxin666', 'dsh-client-ui-skin-center')
writeJson(join(centerDir, 'package.json'), { name: '@linxin666/dsh-client-ui-skin-center', version: '0.2.2' })
for (const [id, name] of [['blue-fantasy', '蓝色幻想'], ['maid-atelier', '深海女仆工坊']]) {
  writeJson(join(centerDir, 'skins', id, 'skin.json'), { skinManifestVersion: 2, id, name })
}

// user skin in ~/.dsh/skins
writeJson(join(fakeHome, '.dsh', 'skins', 'my-skin', 'skin.json'), { skinManifestVersion: 2, id: 'my-skin', name: '我的皮肤' })

// boot patch: previous version disabled the center under the old convention
w(patchPath, `${MANAGED_START}\n- id: web-ui-skin-center\n  disabled: true\n${MANAGED_END}\n`)

// --- test 1: v2 discovery + merge ---------------------------------------------
check('v2 world detected (center 0.2.2)', isV2World(modules) === true)
const registry = loadRegistry(modules, join(profileDir, 'package.json'))
check('blue-fantasy discovered as v2', registry['blue-fantasy']?.kind === 'v2')
check('user skin my-skin discovered', registry['my-skin']?.kind === 'v2' && registry['my-skin'].source.includes('用户目录'))
check('maid-atelier merged (v2 + legacy wiring facts)',
  registry['maid-atelier']?.kind === 'v2'
  && registry['maid-atelier'].legacyWiringId === 'ui-skin-maid-atelier'
  && registry['maid-atelier'].legacyBundleWired === true)

// --- test 2: boot reconcile migrates the legacy-active twin -------------------
reconcileV2AtBoot(resolvePaths())
check('reconcile migrated active file to maid-atelier', readActive(activePath) === 'maid-atelier')
const patch2 = readFileSync(patchPath, 'utf8')
check('center row no longer disabled', !patch2.includes('web-ui-skin-center'))
check('legacy twin disabled', /- id: ui-skin-maid-atelier\n  disabled: true/.test(patch2))
check('currentSkin reads the active file', currentSkin(registry) === 'maid-atelier')

// --- test 3: switch to a v2-only skin -----------------------------------------
useSkin('blue-fantasy', registry)
check('active file = blue-fantasy', readActive(activePath) === 'blue-fantasy')
check('currentSkin = blue-fantasy', currentSkin(registry) === 'blue-fantasy')
const patch3 = readFileSync(patchPath, 'utf8')
check('no insert rows for a v2 skin', !patch3.includes('insert:'))
check('center stays enabled under v2', !patch3.includes('web-ui-skin-center'))

// --- test 4: official restores the stock look ---------------------------------
useSkin('official', registry)
check('active file cleared', readActive(activePath) === null)
check('currentSkin = none', currentSkin(registry) === 'none')

// --- test 5: legacy-only skin still works under the v2 engine -----------------
const retroDir = join(modules, 'dsh-client-ui-skin-retro')
writeJson(join(retroDir, 'package.json'), { name: 'dsh-client-ui-skin-retro', version: '1.0.0', main: 'index.js' })
w(join(retroDir, 'index.js'), 'export default {}\n')
writeJson(join(retroDir, 'skin.json'), { id: 'retro', package: 'dsh-client-ui-skin-retro', wiring: { id: 'ui-skin-retro' }, name: '复古' })
const registry2 = loadRegistry(modules, join(profileDir, 'package.json'))
check('retro stays legacy', registry2['retro']?.kind === undefined)
useSkin('retro', registry2)
check('active file cleared for a legacy target', readActive(activePath) === null)
const patch5 = readFileSync(patchPath, 'utf8')
check('retro insert row present', patch5.includes('- insert:') && patch5.includes("name: 'dsh-client-ui-skin-retro'"))
check('retro row not disabled', !/- id: ui-skin-retro\n  disabled: true/.test(patch5))
check('maid-atelier twin still disabled', /- id: ui-skin-maid-atelier\n  disabled: true/.test(patch5))
check('currentSkin = retro', currentSkin(registry2) === 'retro')

// --- test 6: pure legacy world (v2 center removed) ----------------------------
rmSync(centerDir, { recursive: true, force: true })
check('v2 world gone', isV2World(modules) === false)
const registry3 = loadRegistry(modules, join(profileDir, 'package.json'))
check('no v2 entries remain', registry3['blue-fantasy'] === undefined && registry3['my-skin'] === undefined)
check('maid-atelier back to legacy', registry3['maid-atelier']?.kind === undefined && registry3['maid-atelier'].bundleWired === true)
useSkin('maid-atelier', registry3)
const patch6 = readFileSync(patchPath, 'utf8')
check('legacy world disables the center row', patch6.includes('- id: web-ui-skin-center\n  disabled: true'))
check('retro insert row removed (not composed, not active)', !patch6.includes('ui-skin-retro'))
check('active bundle-wired maid-atelier needs no rows', !/- id: ui-skin-maid-atelier/.test(patch6))
check('currentSkin = maid-atelier (patch)', currentSkin(registry3) === 'maid-atelier')

// --- cleanup -------------------------------------------------------------------
rmSync(fakeHome, { recursive: true, force: true })

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nAll checks passed.')
