/**
 * dsh-skin-switcher — host half.
 *
 * Mounts the `/api/skin-switcher/*` routes the browser half uses to list
 * installed skins and switch between them. Switching writes the managed
 * section of `~/.dsh/cordis.patch.yml` (atomic rewrite); the DSH config
 * watcher hot-reloads the patch within seconds, so no server restart is
 * needed — the page refreshes to pick up the new client plugin roster.
 *
 * Skin discovery scans the web profile's node_modules for any installed
 * `dsh-client-ui-skin-*` package carrying a skin.json (works for skins
 * installed via `dsh plugin add`, including scoped packages such as
 * `@dsh-external/dsh-client-ui-skin-maid-atelier`). A skin whose package is
 * listed in the profile's `dsh.profile.bundles` is bundle-wired: activating
 * it needs no insert row, only the absence of a disabled row.
 *
 * Since v0.4.0 the skin-center v2 asset engine (>= 0.2.x) is also
 * understood: its builtin `skins/` dir and `~/.dsh/skins` (DSH_SKINS_HOME)
 * are discovered as v2 skins, the active selection is persisted to
 * `~/.dsh/skin-center-active.json` (which the center applies on every page
 * load), and the center itself is left enabled — it is the engine, not a
 * competitor. A v2 twin permanently disables the same id's legacy wiring
 * row so the two mechanisms never stack.
 *
 * The patch-management logic is a port of the `dsh-skin` CLI from
 * zhu1090093659/dsh-web-ui (BSD-3-Clause, https://github.com/zhu1090093659/dsh-web-ui).
 * @module dsh-skin-switcher
 */

import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
export const name = 'ui-skin-switcher'

/** Services required before the skin switcher can mount its routes. */
export const inject = ['webServer']

/** Browser-facing base path of the skin-switcher API. */
export const API_PREFIX = '/api/skin-switcher'

/** Managed patch-section delimiters (single authority boundaries). */
export const MANAGED_START = '# --- dsh-skin-switcher managed (auto-generated; do not edit) ---'
export const MANAGED_END = '# --- end dsh-skin-switcher managed ---'

/** The GUI profile this machine runs (dsh web). */
const DEFAULT_PROFILE = process.env.DSH_SKIN_PROFILE ?? 'web'

/** Skin packages this switcher must never treat as switchable skins. */
const SELF_PACKAGE = 'dsh-skin-switcher'
const MANAGER_SKIN_PREFIX = 'dsh-client-ui-skin-'
const SKIN_PACKAGE_RE = /^dsh-client-ui-skin-[a-z0-9-]+$/

// --- paths -----------------------------------------------------------------

/**
 * Resolve the DSH home + profile paths the switcher operates on.
 * @param home - home dir (defaults to process HOME).
 * @param profile - profile name.
 */
export function resolvePaths(home = homedir(), profile = DEFAULT_PROFILE) {
  return {
    /** ~/.dsh/cordis.patch.yml */
    patchPath: join(home, '.dsh', 'cordis.patch.yml'),
    /** ~/.dsh/profiles/<profile>/node_modules */
    profileModulesDir: join(home, '.dsh', 'profiles', profile, 'node_modules'),
    /** ~/.dsh/profiles/<profile>/package.json */
    profileManifestPath: join(home, '.dsh', 'profiles', profile, 'package.json'),
    /** ~/.dsh/skin-center-active.json — the v2 center's active-selection doc. */
    activeStatePath: join(home, '.dsh', 'skin-center-active.json'),
    /** ~/.dsh/skins — v2 user skin assets (DSH_SKINS_HOME overrides). */
    userSkinsDir: process.env.DSH_SKINS_HOME?.trim()
      ? resolve(process.env.DSH_SKINS_HOME)
      : join(home, '.dsh', 'skins'),
  }
}

// --- skin discovery ---------------------------------------------------------

/**
 * Parse the switch-relevant fields of one skin.json. Returns null for
 * anything that is not a valid skin so it is simply skipped.
 * @param absDir - absolute path of the candidate skin directory.
 */
function readSkinMeta(absDir) {
  try {
    const meta = JSON.parse(readFileSync(join(absDir, 'skin.json'), 'utf8'))
    if (typeof meta !== 'object' || meta === null) return null
    if (typeof meta.id !== 'string' || !/^[a-z0-9-]+$/.test(meta.id)) return null
    if (typeof meta.package !== 'string' || meta.package === '') return null
    const wiring = (typeof meta.wiring === 'object' && meta.wiring !== null) ? meta.wiring : null
    if (wiring === null || typeof wiring.id !== 'string' || !/^[a-z0-9-]+$/.test(wiring.id)) return null
    return {
      id: meta.id,
      package: meta.package,
      wiringId: wiring.id,
      bundleWired: wiring.bundleWired === true,
      name: typeof meta.name === 'string' ? meta.name : meta.id,
      nameEn: typeof meta.nameEn === 'string' ? meta.nameEn : undefined,
      author: typeof meta.author === 'string' ? meta.author : undefined,
      tagline: typeof meta.tagline === 'string' ? meta.tagline : undefined,
      description: typeof meta.description === 'string' ? meta.description : undefined,
    }
  } catch {
    return null
  }
}

/**
 * Parse one v2 asset skin manifest (skin-center engine). v2 skins are pure
 * asset directories (no cordis package, no wiring row): they require
 * `skinManifestVersion: 2`, a valid id, and — mirroring the center's own
 * catalog rule — the id must equal the directory name.
 * @param absDir - absolute path of the candidate skin directory.
 */
function readSkinMetaV2(absDir) {
  try {
    const meta = JSON.parse(readFileSync(join(absDir, 'skin.json'), 'utf8'))
    if (typeof meta !== 'object' || meta === null) return null
    if (meta.skinManifestVersion !== 2) return null
    if (typeof meta.id !== 'string' || !/^[a-z0-9-]+$/.test(meta.id)) return null
    if (meta.id !== basename(absDir)) return null
    return {
      id: meta.id,
      kind: 'v2',
      name: typeof meta.name === 'string' ? meta.name : meta.id,
      nameEn: typeof meta.nameEn === 'string' ? meta.nameEn : undefined,
      author: typeof meta.author === 'string' ? meta.author : undefined,
      tagline: typeof meta.tagline === 'string' ? meta.tagline : undefined,
      description: typeof meta.description === 'string' ? meta.description : undefined,
    }
  } catch {
    return null
  }
}

/**
 * Enumerate installed skin packages under the profile node_modules. Two
 * shapes are recognized:
 *  - direct skin packages: any scoped or unscoped directory whose name
 *    matches dsh-client-ui-skin-* and carries a skin.json (e.g.
 *    `@dsh-external/dsh-client-ui-skin-maid-atelier`);
 *  - bundled-skin carriers: `<scope>/dsh-skins/skins/<id>` and
 *    `dsh-skins/skins/<id>` (the dsh-web-ui aggregate ships its skins inside
 *    the dsh-skins carrier so npm needs no per-skin package names).
 * The switcher's own package and skin manager packages are excluded.
 * @param modulesDir - the profile node_modules dir.
 * @returns absolute candidate dirs (possibly empty).
 */
export function listSkinDirCandidates(modulesDir) {
  const out = []
  let entries
  try {
    entries = readdirSync(modulesDir)
  } catch {
    return out
  }
  const collectDirect = (dirPath, pkg) => {
    const pkgPath = join(dirPath, pkg)
    if (!statSync(pkgPath, { throwIfNoEntry: false })?.isDirectory()) return
    if (!SKIN_PACKAGE_RE.test(pkg)) return
    // Skin manager packages are not skins.
    if (pkg === 'dsh-client-ui-skin-center' || pkg === SELF_PACKAGE) return
    if (statSync(join(pkgPath, 'skin.json'), { throwIfNoEntry: false })) out.push(pkgPath)
  }
  const collectCarrier = (dirPath) => {
    const carrierDir = join(dirPath, 'dsh-skins', 'skins')
    let subs
    try {
      subs = readdirSync(carrierDir)
    } catch {
      return
    }
    for (const sub of subs) {
      const subDir = join(carrierDir, sub)
      if (!statSync(subDir, { throwIfNoEntry: false })?.isDirectory()) continue
      if (statSync(join(subDir, 'skin.json'), { throwIfNoEntry: false })) out.push(subDir)
    }
  }
  for (const entry of entries) {
    const entryPath = join(modulesDir, entry)
    if (!statSync(entryPath, { throwIfNoEntry: false })?.isDirectory()) continue
    if (entry.startsWith('@')) {
      let scopedEntries
      try {
        scopedEntries = readdirSync(entryPath)
      } catch {
        continue
      }
      for (const pkg of scopedEntries) collectDirect(entryPath, pkg)
      collectCarrier(entryPath)
    } else {
      collectDirect(modulesDir, entry)
      collectCarrier(modulesDir)
    }
  }
  return out
}

// --- v2 asset-skin discovery (skin-center engine) -----------------------------

/**
 * Locate the installed skin-center package directories (the v2 engine),
 * scoped or unscoped, up to 2 levels under the profile node_modules.
 * @param modulesDir - the profile node_modules dir.
 * @returns absolute package dirs (possibly empty).
 */
export function findCenterDirs(modulesDir) {
  const out = []
  const visit = (dirPath, depth) => {
    if (depth > 2) return
    let entries
    try {
      entries = readdirSync(dirPath)
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dirPath, entry)
      if (entry === 'dsh-client-ui-skin-center' && statSync(full, { throwIfNoEntry: false })?.isDirectory()) {
        out.push(full)
      } else if (entry.startsWith('@') && statSync(full, { throwIfNoEntry: false })?.isDirectory()) {
        visit(full, depth + 1)
      }
    }
  }
  visit(modulesDir, 0)
  return out
}

/**
 * Candidate v2 asset skin dirs: every subdirectory of the center's builtin
 * `skins/` (builtin origin first) and of the user skins dir (user origin
 * shadows a same-id builtin, matching the center's catalog rule).
 * @param modulesDir - the profile node_modules dir.
 * @param userDir - the v2 user skins dir (~/.dsh/skins).
 * @returns [{dir, origin: 'builtin'|'user'}] (possibly empty).
 */
export function listV2SkinDirs(modulesDir, userDir) {
  const out = []
  const collect = (root, origin) => {
    let subs
    try {
      subs = readdirSync(root)
    } catch {
      return
    }
    for (const sub of subs) {
      const dir = join(root, sub)
      if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue
      out.push({ dir, origin })
    }
  }
  for (const centerDir of findCenterDirs(modulesDir)) collect(join(centerDir, 'skins'), 'builtin')
  if (userDir) collect(userDir, 'user')
  return out
}

/**
 * Derive the skin registry from each installed skin dir's skin.json, merged
 * with live facts: a skin is bundle-wired when its package is listed in the
 * profile's dsh.profile.bundles (the `dsh plugin add` path — its bundle patch
 * already inserts the plugin row). The skin.json bundleWired flag is NOT
 * trusted: npm carrier layouts (dsh-skins) ship stale flags with no actual
 * bundle layer wiring them.
 * @param modulesDir - profile node_modules dir.
 * @param profileManifestPath - profile package.json path.
 * @param userSkinsDir - v2 user skins dir (defaults to resolvePaths()).
 * @returns skin id -> switch metadata.
 */
export function loadRegistry(modulesDir, profileManifestPath, userSkinsDir) {
  const bundles = new Set()
  try {
    const manifest = JSON.parse(readFileSync(profileManifestPath, 'utf8'))
    const list = manifest?.dsh?.profile?.bundles
    if (Array.isArray(list)) for (const b of list) if (typeof b === 'string') bundles.add(b)
  } catch {
    /* profile manifest unreadable: no bundle-wired detection */
  }
  const out = {}
  for (const dir of listSkinDirCandidates(modulesDir)) {
    const meta = readSkinMeta(dir)
    if (meta === null) continue
    if (out[meta.id] !== undefined) continue
    out[meta.id] = {
      id: meta.id,
      pkg: meta.package,
      wiringId: meta.wiringId,
      bundleWired: bundles.has(meta.package),
      dir,
      name: meta.name,
      nameEn: meta.nameEn,
      author: meta.author,
      tagline: meta.tagline,
      description: meta.description,
    }
  }
  // v2 asset skins (skin-center engine): a v2 twin REPLACES the legacy
  // switch path for the same id but keeps the legacy wiring facts, so the
  // old package-based row can be held disabled and the two mechanisms never
  // stack. User-origin entries land after builtin ones and win by overwrite.
  // The whole v2 merge is gated on the v2 engine being installed: without
  // it, v2 assets are inert and must not be offered as switchable skins.
  if (isV2World(modulesDir)) {
    const v2Root = userSkinsDir ?? resolvePaths().userSkinsDir
    for (const cand of listV2SkinDirs(modulesDir, v2Root)) {
      const meta = readSkinMetaV2(cand.dir)
      if (meta === null) continue
      const legacy = out[meta.id]
      const entry = {
        id: meta.id,
        kind: 'v2',
        dir: cand.dir,
        name: meta.name,
        nameEn: meta.nameEn,
        author: meta.author,
        tagline: meta.tagline,
        description: meta.description,
        source: cand.origin === 'builtin' ? '内置 · skin-center' : '用户目录 · ~/.dsh/skins',
      }
      if (legacy !== undefined) {
        entry.legacyPkg = legacy.pkg
        entry.legacyWiringId = legacy.wiringId
        entry.legacyBundleWired = legacy.bundleWired
      }
      out[meta.id] = entry
    }
  }
  return out
}

// --- patch file helpers ------------------------------------------------------

/**
 * All `- id / name` rows the profile's bundle packages insert through their
 * `dsh.bundle.patch` files. This is the composed-row inventory the switcher
 * uses both to find the skin-center row (whose id changes across aggregate
 * versions) and to decide which skin rows actually exist in the composition.
 * @param modulesDir - profile node_modules dir.
 * @param profileManifestPath - profile package.json path.
 * @returns deduped [{id, name}] rows in bundle order.
 */
export function findBundleRowIds(modulesDir, profileManifestPath) {
  const bundles = new Set()
  try {
    const manifest = JSON.parse(readFileSync(profileManifestPath, 'utf8'))
    const list = manifest?.dsh?.profile?.bundles
    if (Array.isArray(list)) for (const b of list) if (typeof b === 'string') bundles.add(b)
  } catch {
    /* profile manifest unreadable: no bundle scan */
  }
  const rows = []
  const seen = new Set()
  for (const bundle of bundles) {
    const pkgDir = join(modulesDir, bundle)
    let patchRel = './cordis.patch.yml'
    try {
      const pkgJson = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
      const patch = pkgJson?.dsh?.bundle?.patch
      if (typeof patch === 'string' && patch !== '') patchRel = patch
    } catch {
      continue
    }
    let text = ''
    try {
      text = readFileSync(join(pkgDir, patchRel), 'utf8')
    } catch {
      continue
    }
    for (const m of text.matchAll(/- id: ([a-z0-9-]+)\s*\r?\n\s*name:\s*['"]?([^'"\s]+)/g)) {
      const key = `${m[1]}\u0000${m[2]}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({ id: m[1], name: m[2] })
    }
  }
  return rows
}

/**
 * Which cordis row ids currently wire the skin-center manager (see
 * findBundleRowIds). Defensive fallback: when the center package is installed
 * but no bundle row naming it could be found, the legacy id `ui-skin-center`
 * is returned so the manager is still disabled under the old convention.
 * @param modulesDir - profile node_modules dir.
 * @param profileManifestPath - profile package.json path.
 * @returns composed row ids (possibly empty when the center is not installed).
 */
export function findSkinCenterRowIds(modulesDir, profileManifestPath) {
  const centerBare = 'dsh-client-ui-skin-center'
  let centerInstalled = false
  const markInstalled = (dirPath, depth) => {
    if (depth > 2) return
    let entries
    try {
      entries = readdirSync(dirPath)
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry === centerBare) centerInstalled = true
      else if (entry.startsWith('@') && statSync(join(dirPath, entry), { throwIfNoEntry: false })?.isDirectory()) {
        markInstalled(join(dirPath, entry), depth + 1)
      }
    }
  }
  markInstalled(modulesDir, 0)
  const ids = findBundleRowIds(modulesDir, profileManifestPath)
    .filter((row) => row.name.replace(/^@[^/]+\//, '') === centerBare)
    .map((row) => row.id)
  if (ids.length === 0 && centerInstalled) ids.push('ui-skin-center')
  return ids
}

/**
 * Whether the installed skin center is the v2 asset engine (>= 0.2.x): it
 * reads/writes ~/.dsh/skin-center-active.json and never touches the patch,
 * so it must NOT be disabled. The legacy center (< 0.2, patch-writing
 * competitor) keeps the old disable behavior. Fallback for unknown versions:
 * any valid v2 manifest under the center's builtin skins dir proves the
 * engine.
 * @param modulesDir - the profile node_modules dir.
 */
export function isV2World(modulesDir) {
  const centers = findCenterDirs(modulesDir)
  if (centers.length === 0) return false
  for (const centerDir of centers) {
    try {
      const pkgJson = JSON.parse(readFileSync(join(centerDir, 'package.json'), 'utf8'))
      const version = typeof pkgJson?.version === 'string' ? pkgJson.version : ''
      const m = version.match(/^(\d+)\.(\d+)/)
      if (m) {
        const major = Number(m[1])
        const minor = Number(m[2])
        if (major > 0 || (major === 0 && minor >= 2)) return true
      }
    } catch {
      /* unreadable manifest */
    }
  }
  for (const centerDir of centers) {
    let subs
    try {
      subs = readdirSync(join(centerDir, 'skins'))
    } catch {
      continue
    }
    for (const sub of subs) {
      if (readSkinMetaV2(join(centerDir, 'skins', sub)) !== null) return true
    }
  }
  return false
}

function readPatch(patchPath) {
  try {
    return readFileSync(patchPath, 'utf8')
  } catch {
    return ''
  }
}

/**
 * Atomic replace: write a sibling temp file then rename over the target, so a
 * crash mid-write can never leave a half-written boot patch and the config
 * watcher only ever sees complete content.
 * @param filePath - target file.
 * @param next - full next content.
 */
function writePatchAtomic(filePath, next) {
  mkdirSync(dirnameOf(filePath), { recursive: true })
  const tmp = `${filePath}.tmp-${process.pid}`
  writeFileSync(tmp, next)
  renameSync(tmp, filePath)
}

function dirnameOf(p) {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return idx === -1 ? '.' : p.slice(0, idx)
}

/** Remove the managed skin section. Returns the patch text without it. */
function stripManaged(patch) {
  const start = patch.indexOf(MANAGED_START)
  if (start === -1) return patch
  const end = patch.indexOf(MANAGED_END, start)
  if (end === -1) throw new Error('managed skin section is unterminated; fix ~/.dsh/cordis.patch.yml')
  return patch.slice(0, start) + patch.slice(end + MANAGED_END.length)
}

/**
 * Strip leftovers outside the managed section that would break YAML
 * top-level-array parsing: a bare `[]` (or several) that accumulated in
 * front of the managed section from an earlier write, and stray YAML
 * document markers. Everything that is not the managed section or a real
 * user-authored patch row is dropped, so the output is either user rows or
 * empty — both of which stay valid when the managed section is appended.
 */
function sanitizeOutside(patch) {
  return patch
    // Drop the managed-section-adjacent bare arrays (multi-document hazard).
    .replace(/^\s*\[\]\s*/g, '')
    .replace(/^---\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+/, '')
    .replace(/\s+$/, '')
}

/**
 * Render the managed section for a target skin (null = official stock look:
 * every skin disabled). A bundle-wired active skin needs no insert row — the
 * profile bundle layer already provides it.
 * @param active - skin id, or null for the official stock look.
 * @param registry - registry to render against.
 * @param centerRowIds - composed skin-center row ids (see findSkinCenterRowIds).
 * @param bundleRows - composed bundle rows (see findBundleRowIds); only skins
 *   whose rows actually exist in the composition are disabled, so dsh never
 *   logs "entry ... not found" noise for skins that are merely installed.
 * @param v2World - the skin center is the v2 asset engine (see isV2World):
 *   its rows stay ENABLED (it applies the active-selection file and never
 *   competes for the patch), and v2 twins keep their legacy row disabled so
 *   the old package-based wiring never stacks with the asset skin.
 */
export function renderManaged(active, registry, centerRowIds = [], bundleRows = [], v2World = false) {
  const body = []
  // Legacy world: this switcher is the single skin-management authority and
  // the legacy skin center (a patch-writing competitor) is always disabled.
  // Its row id changes across aggregate versions, so it is discovered from
  // the bundle patches instead of being hardcoded.
  if (!v2World) {
    for (const id of centerRowIds) {
      body.push(`- id: ${id}`, '  disabled: true')
    }
  }
  const composedIds = new Set()
  const composedNames = new Set()
  for (const row of bundleRows) {
    composedIds.add(row.id)
    composedNames.add(row.name.replace(/^@[^/]+\//, ''))
  }
  for (const entry of Object.values(registry)) {
    if (entry.kind === 'v2') {
      // A v2 twin permanently disables its legacy row: the asset skin is the
      // one true mechanism for that id under the v2 engine.
      if (entry.legacyWiringId !== undefined) {
        body.push(`- id: ${entry.legacyWiringId}`, '  disabled: true')
      }
      continue
    }
    if (entry.id === active) continue
    const composed = entry.bundleWired || composedIds.has(entry.wiringId) || composedNames.has(entry.pkg.replace(/^@[^/]+\//, ''))
    if (composed) {
      body.push(`- id: ${entry.wiringId}`, '  disabled: true')
    }
  }
  const activeEntry = active !== null ? registry[active] : undefined
  if (activeEntry !== undefined && activeEntry.kind !== 'v2' && !activeEntry.bundleWired) {
    body.push('- insert:', `    - id: ${activeEntry.wiringId}`, `      name: '${activeEntry.pkg}'`)
  }
  // The managed section must ALWAYS be a valid YAML array: when no rows are
  // needed (e.g. the only installed skin is bundle-wired and active), emit an
  // explicit empty array so the whole patch file still parses as a top-level
  // array. DSH rejects a non-array patch file, which broke hot-reload.
  const lines = [MANAGED_START, ...(body.length > 0 ? body : ['[]']), MANAGED_END]
  return lines.join('\n')
}

/**
 * Which skin is currently enabled, read from a patch file. A bundle-wired
 * skin that is not disabled is active; otherwise the answer is the last
 * non-disabled skin row (or null for the stock look).
 * @param patch - raw patch file text.
 * @param registry - registry to read against.
 */
export function currentActive(patch, registry) {
  const disabled = new Set()
  for (const m of patch.matchAll(/^- id: (ui-skin-[a-z0-9-]+)\n  disabled: true/gm)) {
    disabled.add(m[1])
  }
  for (const entry of Object.values(registry)) {
    if (entry.bundleWired && !disabled.has(entry.wiringId)) return entry.id
  }
  const rows = [...patch.matchAll(/(?:^|\n) *- id: (ui-skin-[a-z0-9-]+)(\n *disabled: (true))?/g)]
  const enabled = []
  for (const m of rows) if (!m[3]) enabled.push(m[1])
  // Slice the anchored prefix instead of String#replace: replace strips only
  // the FIRST occurrence, which would corrupt ids containing "ui-skin-"
  // twice (e.g. "ui-skin-ui-skin-x" is a legal wiring id).
  return enabled.length ? enabled[enabled.length - 1].slice('ui-skin-'.length) : null
}

/**
 * Registry view containing only entries with legacy (patch-based) wiring:
 * pure-legacy entries as-is, merged v2 twins projected onto their legacy
 * wiring facts. currentActive() runs against this view so the v2 engine's
 * active-selection file and the legacy patch mechanism never double-count.
 * @param registry - the merged registry.
 * @returns skin id -> {id, wiringId, bundleWired} (possibly empty).
 */
function legacyView(registry) {
  const view = {}
  for (const entry of Object.values(registry)) {
    if (entry.kind === 'v2') {
      if (entry.legacyWiringId === undefined) continue
      view[entry.id] = { id: entry.id, wiringId: entry.legacyWiringId, bundleWired: entry.legacyBundleWired === true }
    } else {
      view[entry.id] = entry
    }
  }
  return view
}

/**
 * Atomic replace of ~/.dsh/skin-center-active.json ({active: id|null}),
 * mirroring the center's own document shape.
 */
function writeActiveSelectionAtomic(path, id) {
  mkdirSync(dirnameOf(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, `${JSON.stringify({ active: id }, null, 2)}\n`)
  renameSync(tmp, path)
}

// --- commands ----------------------------------------------------------------

/**
 * Switch the active skin:
 *   1. verifies the target skin package is resolvable from the profile
 *      (legacy entries only — v2 asset skins need no cordis wiring),
 *   2. under the v2 engine writes the active selection to
 *      ~/.dsh/skin-center-active.json (the center applies it on every page
 *      load; switching to a legacy skin or the stock look clears it),
 *   3. rewrites the managed section of the boot patch atomically.
 * @param target - skin id, or 'official' for the stock look.
 * @param registry - the discovered registry.
 * @returns the confirmation string.
 */
export function useSkin(target, registry) {
  const official = target === 'official'
  const paths = resolvePaths()
  const v2World = isV2World(paths.profileModulesDir)
  let entry = null
  if (!official) {
    entry = registry[target]
    if (entry === undefined) {
      throw new Error(`unknown skin "${target}". Known: ${Object.keys(registry).join(', ')} (or "official" for the stock look)`)
    }
    if (entry.kind !== 'v2') {
      symlinkFriendly(`switching to "${target}"`, () => {
        ensureSymlink(entry, paths.profileModulesDir)
      })
      const problem = checkResolvable(entry, paths.profileModulesDir)
      if (problem !== null) throw new Error(problem)
    }
  }
  if (v2World) {
    const nextActive = (official || entry?.kind !== 'v2') ? null : target
    writeActiveSelectionAtomic(paths.activeStatePath, nextActive)
  }
  const patch = sanitizeOutside(stripManaged(readPatch(paths.patchPath)))
  const bundleRows = findBundleRowIds(paths.profileModulesDir, paths.profileManifestPath)
  const centerRowIds = findSkinCenterRowIds(paths.profileModulesDir, paths.profileManifestPath)
  const next = `${patch.length > 0 ? `${patch}\n\n` : ''}${renderManaged(official ? null : target, registry, centerRowIds, bundleRows, v2World)}\n`
  writePatchAtomic(paths.patchPath, next)
  return official
    ? '已恢复默认外观 — 配置监视器将在数秒内生效；页面自动刷新。'
    : `已切换到皮肤 "${target}" — 配置监视器将在数秒内生效；页面自动刷新。`
}

/**
 * Read the active skin id, or 'none' for the stock look. Under the v2 engine
 * the center's active-selection file is authoritative; when it is absent or
 * names an unknown skin, the legacy patch mechanism answers.
 * @param registry - registry to read against.
 */
export function currentSkin(registry) {
  const paths = resolvePaths()
  if (isV2World(paths.profileModulesDir)) {
    try {
      const parsed = JSON.parse(readFileSync(paths.activeStatePath, 'utf8'))
      if (typeof parsed?.active === 'string' && registry[parsed.active] !== undefined) return parsed.active
    } catch {
      /* absent/unreadable: fall through to the patch mechanism */
    }
  }
  return currentActive(readPatch(paths.patchPath), legacyView(registry)) ?? 'none'
}

/**
 * Whether the skin package is actually resolvable as a plugin from the web
 * profile — the same directory contract the boot graph relies on. Structural
 * and deterministic (pure fs): the profile-target package dir must carry a
 * package.json whose name is this skin's package and a host entry
 * (main, else index.js) that exists.
 * @param entry - the skin registry entry.
 * @param profileModulesDir - the profile's node_modules dir.
 * @returns an error message when the skin is not resolvable, else null.
 */
function checkResolvable(entry, profileModulesDir) {
  const target = join(profileModulesDir, entry.pkg)
  if (!statSync(target, { throwIfNoEntry: false })?.isDirectory()) {
    return `${entry.pkg} 未安装到 profile（profile 中无 ${target}）。请先用 dsh plugin --profile web add 安装。`
  }
  const pkgPath = join(target, 'package.json')
  if (!statSync(pkgPath, { throwIfNoEntry: false })) {
    return `${entry.pkg} 在 profile 中缺少 package.json（${pkgPath}）。`
  }
  let parsed = {}
  try {
    parsed = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch {
    /* unreadable manifest */
  }
  if (parsed.name !== entry.pkg) {
    return `${entry.pkg} 解析到的 package.json 名为 ${String(parsed.name)}，不是本皮肤（${pkgPath}）。`
  }
  const main = typeof parsed.main === 'string' ? parsed.main : 'index.js'
  if (!statSync(join(target, main), { throwIfNoEntry: false })) {
    return `${entry.pkg} 缺少 host 入口 ${join(target, main)}。`
  }
  return null
}

// --- profile symlink management ------------------------------------------------

/** Windows/privilege code points where symlinkSync fails. */
const SYMLINK_PRIVILEGE_CODES = ['EPERM', 'EACCES', 'ENOSYS']

/**
 * Canonical path a symlink resolves to, tolerant of a degraded link (a
 * self-referential link whose realpath would throw ELOOP); '' when absent.
 */
function resolveLinkReal(linkPath) {
  try {
    return realpathSync(linkPath)
  } catch {
    return ''
  }
}

/**
 * Make the profile node_modules link for a skin. Returns true when a new
 * link was created, false when the target was already resolvable.
 *
 * A target that already resolves (a REAL installed directory, or a
 * symlink/junction pointing at the skin dir) is left untouched. An existing
 * link pointing elsewhere is refreshed. A plain FILE target is refused.
 * On win32 the link falls back to a directory junction (absolute target)
 * when symlink creation fails with a privilege error, so no Developer Mode
 * or elevation is required.
 * @param entry - the skin registry entry.
 * @param profileModulesDir - the profile's node_modules dir.
 */
function ensureSymlink(entry, profileModulesDir) {
  const target = join(profileModulesDir, entry.pkg)
  let entryReal
  try {
    entryReal = realpathSync(entry.dir)
  } catch {
    entryReal = entry.dir
  }
  if (entry.dir === target || entryReal === target) return false
  let stat = null
  try {
    stat = lstatSync(target)
  } catch {
    /* absent */
  }
  if (stat) {
    if (stat.isSymbolicLink()) {
      if (resolveLinkReal(target) === entryReal) return false
      // Windows junctions report as symbolic links AND directories; unlink
      // cannot remove a directory reparse point (EPERM), so remove stale
      // junctions with rmdir instead.
      if (process.platform === 'win32' && stat.isDirectory()) rmdirSync(target)
      else unlinkSync(target)
    } else if (stat.isDirectory()) {
      if (isSkinPackageDir(target, entry)) return false
      throw new Error(`${target} 已存在目录但不是本皮肤包（${entry.pkg}），拒绝覆盖`)
    } else {
      throw new Error(`${target} 已存在且不是目录或链接，拒绝覆盖`)
    }
  }
  mkdirSync(dirnameOf(target), { recursive: true })
  try {
    symlinkSync(entry.dir, target)
  } catch (error) {
    const code = error?.code
    if (process.platform === 'win32' && typeof code === 'string' && SYMLINK_PRIVILEGE_CODES.includes(code)) {
      symlinkSync(entry.dir, target, 'junction')
    } else {
      throw error
    }
  }
  return true
}

/**
 * Whether an existing directory at a profile link path really is the target
 * skin's installed package (skin.json id + package match).
 */
function isSkinPackageDir(dir, entry) {
  try {
    const meta = JSON.parse(readFileSync(join(dir, 'skin.json'), 'utf8'))
    return meta?.id === entry.id && meta?.package === entry.pkg
  } catch {
    return false
  }
}

/**
 * Wrap a symlink-labelled failure (typ. Windows without developer mode or
 * elevated privileges) in a human-readable hint instead of a bare fs error.
 */
function symlinkFriendly(caller, fn) {
  try {
    return fn()
  } catch (error) {
    const code = error?.code
    if (typeof code === 'string' && SYMLINK_PRIVILEGE_CODES.includes(code)) {
      throw new Error(`${caller} 需要为皮肤创建符号链接，但权限不足（${code}）。Windows 请以管理员身份或开启开发者模式后重试；若已手动把皮肤装进 profile，可跳过本步。`)
    }
    throw error
  }
}

// --- HTTP routes --------------------------------------------------------------

function json(res, status, body) {
  // no-store: skin state changes under the browser's feet (the config
  // watcher hot-reloads the patch), so neither the browser nor a proxy may
  // serve a stale /state payload.
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function requireMethod(req, res, method) {
  if (req.method === method) return true
  json(res, 405, { ok: false, error: 'method-not-allowed' })
  return false
}

/**
 * Same-origin fence. Browsers send `Sec-Fetch-Site` on every fetch:
 * a `cross-site` fetch is always rejected, and an `Origin` that does not
 * match the request `Host` is rejected. Requests without either header
 * (curl, node http) pass — this is a local single-user tool, and the fence
 * only targets the cross-site browser vector.
 */
function isSameOriginRequest(req) {
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site === 'cross-site') return false
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
    const host = req.headers.host
    if (typeof host !== 'string' || host === '') return false
    try {
      if (new URL(origin).host !== host) return false
    } catch {
      return false
    }
  }
  return true
}

function requireSameOrigin(req, res) {
  if (isSameOriginRequest(req)) return true
  json(res, 403, { ok: false, error: 'cross-site-request-rejected' })
  return false
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 64 * 1024) {
        reject(new Error('body-too-large'))
        queueMicrotask(() => req.destroy())
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('invalid-json'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Registry snapshot for one request. Re-derived per request (cheap fs reads)
 * so a skin installed mid-session appears without restarting.
 */
function registrySnapshot() {
  const paths = resolvePaths()
  const registry = loadRegistry(paths.profileModulesDir, paths.profileManifestPath)
  return { paths, registry }
}

/**
 * Build the skin-switcher route family.
 */
export function makeSkinSwitcherRoutes() {
  const stateRoute = {
    kind: 'exact',
    path: `${API_PREFIX}/state`,
    handler: (req, res) => {
      if (!requireMethod(req, res, 'GET')) return
      if (!requireSameOrigin(req, res)) return
      try {
        const { registry } = registrySnapshot()
        const skins = Object.values(registry).map((entry) => ({
          id: entry.id,
          kind: entry.kind ?? 'legacy',
          package: entry.pkg,
          source: entry.source,
          name: entry.name,
          nameEn: entry.nameEn,
          author: entry.author,
          tagline: entry.tagline,
          description: entry.description,
          bundleWired: entry.bundleWired,
        }))
        json(res, 200, { ok: true, active: currentSkin(registry), skins })
      } catch (error) {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }
  const useRoute = {
    kind: 'exact',
    path: `${API_PREFIX}/use`,
    handler: (req, res) => {
      if (!requireMethod(req, res, 'POST')) return Promise.resolve()
      if (!requireSameOrigin(req, res)) return Promise.resolve()
      return readJsonBody(req).then(
        (body) => {
          try {
            const record = (typeof body === 'object' && body !== null) ? body : {}
            const official = record.official === true
            const skin = record.skin
            if (official) {
              if (skin !== undefined) throw new Error('invalid-skin: skin and official are mutually exclusive')
            } else if (typeof skin !== 'string' || skin === '') {
              throw new Error('invalid-skin: pass a skin name or official: true')
            }
            const { registry } = registrySnapshot()
            const target = official ? 'official' : skin
            const message = useSkin(target, registry)
            json(res, 200, { ok: true, active: currentSkin(registry), message })
          } catch (error) {
            json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
        },
        (error) => {
          json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        },
      )
    },
  }
  return [stateRoute, useRoute]
}

/**
 * One-time v2 reconciliation at boot (no-op outside the v2 engine world):
 *  - a legacy skin that is currently active and has a v2 twin is migrated to
 *    the v2 selection file, so the upgrade keeps the user's look;
 *  - when the switcher already owns a managed section, it is re-rendered
 *    under v2 semantics (center rows stay enabled, v2 twins stay disabled),
 *    so the previous version's `web-ui-skin-center disabled: true` row is
 *    lifted without a manual edit.
 * @param paths - resolved paths (see resolvePaths).
 */
export function reconcileV2AtBoot(paths = resolvePaths()) {
  if (!isV2World(paths.profileModulesDir)) return
  const registry = loadRegistry(paths.profileModulesDir, paths.profileManifestPath)
  let fileActive = null
  try {
    const parsed = JSON.parse(readFileSync(paths.activeStatePath, 'utf8'))
    if (typeof parsed?.active === 'string') fileActive = parsed.active
  } catch {
    /* absent */
  }
  const view = legacyView(registry)
  const legacyActive = currentActive(readPatch(paths.patchPath), view)
  if (fileActive === null && legacyActive !== null && registry[legacyActive]?.kind === 'v2') {
    writeActiveSelectionAtomic(paths.activeStatePath, legacyActive)
  }
  const patch = readPatch(paths.patchPath)
  if (patch.includes(MANAGED_START)) {
    const active = fileActive !== null && registry[fileActive] !== undefined ? fileActive : legacyActive
    const clean = sanitizeOutside(stripManaged(patch))
    const bundleRows = findBundleRowIds(paths.profileModulesDir, paths.profileManifestPath)
    const centerRowIds = findSkinCenterRowIds(paths.profileModulesDir, paths.profileManifestPath)
    const next = `${clean.length > 0 ? `${clean}\n\n` : ''}${renderManaged(active, registry, centerRowIds, bundleRows, true)}\n`
    if (next !== patch) writePatchAtomic(paths.patchPath, next)
  }
}

/**
 * Register the skin-switcher API routes.
 *
 * Failure policy: route mounting problems are logged, never thrown — the web
 * shell fails the whole boot when a plugin apply throws, and the skin
 * switcher must not take the GUI down.
 * @param ctx - cordis context.
 */
export function apply(ctx) {
  try {
    reconcileV2AtBoot()
  } catch (error) {
    console.error('[ui-skin-switcher] boot reconcile failed:', error)
  }
  const routes = makeSkinSwitcherRoutes()
  try {
    ctx.effect(() => {
      const disposers = []
      try {
        for (const route of routes) disposers.push(ctx.webServer.register(route))
      } catch (error) {
        for (const dispose of disposers) dispose()
        throw error
      }
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'ui-skin-switcher: routes')
  } catch (error) {
    console.error('[ui-skin-switcher] route registration failed:', error)
  }
}
