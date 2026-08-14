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
 * The patch-management logic is a port of the `dsh-skin` CLI from
 * zhu1090093659/dsh-web-ui (BSD-3-Clause, https://github.com/zhu1090093659/dsh-web-ui).
 * @module dsh-skin-switcher
 */

import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

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

/**
 * Derive the skin registry from each installed skin dir's skin.json, merged
 * with live facts: a skin is bundle-wired when its package is listed in the
 * profile's dsh.profile.bundles (the `dsh plugin add` path — its bundle patch
 * already inserts the plugin row). The skin.json bundleWired flag is NOT
 * trusted: npm carrier layouts (dsh-skins) ship stale flags with no actual
 * bundle layer wiring them.
 * @param modulesDir - profile node_modules dir.
 * @param profileManifestPath - profile package.json path.
 * @returns skin id -> switch metadata.
 */
export function loadRegistry(modulesDir, profileManifestPath) {
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
  return out
}

// --- patch file helpers ------------------------------------------------------

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
 */
export function renderManaged(active, registry) {
  const body = []
  // This switcher is the single skin-management authority for the profile:
  // the dsh-web-ui skin center (installed by the aggregate) is always
  // disabled so it can never write a competing managed section.
  body.push('- id: ui-skin-center', '  disabled: true')
  for (const entry of Object.values(registry)) {
    if (entry.id === active) continue
    body.push(`- id: ${entry.wiringId}`, '  disabled: true')
  }
  if (active !== null && !registry[active].bundleWired) {
    body.push('- insert:', `    - id: ${registry[active].wiringId}`, `      name: '${registry[active].pkg}'`)
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
  return enabled.length ? enabled[enabled.length - 1].replace('ui-skin-', '') : null
}

// --- commands ----------------------------------------------------------------

/**
 * Switch the active skin:
 *   1. verifies the target skin package is resolvable from the profile,
 *   2. rewrites the managed section of the boot patch atomically.
 * @param target - skin id, or 'official' for the stock look.
 * @param registry - the discovered registry.
 * @returns the confirmation string.
 */
export function useSkin(target, registry) {
  const official = target === 'official'
  const paths = resolvePaths()
  if (!official) {
    const entry = registry[target]
    if (entry === undefined) {
      throw new Error(`unknown skin "${target}". Known: ${Object.keys(registry).join(', ')} (or "official" for the stock look)`)
    }
    symlinkFriendly(`switching to "${target}"`, () => {
      ensureSymlink(entry, paths.profileModulesDir)
    })
    const problem = checkResolvable(entry, paths.profileModulesDir)
    if (problem !== null) throw new Error(problem)
  }
  const patch = sanitizeOutside(stripManaged(readPatch(paths.patchPath)))
  const next = `${patch.length > 0 ? `${patch}\n\n` : ''}${renderManaged(official ? null : target, registry)}\n`
  writePatchAtomic(paths.patchPath, next)
  return official
    ? '已恢复默认外观 — 配置监视器将在数秒内生效；页面自动刷新。'
    : `已切换到皮肤 "${target}" — 配置监视器将在数秒内生效；页面自动刷新。`
}

/**
 * Read the active skin id, or 'none' for the stock look.
 * @param registry - registry to read against.
 */
export function currentSkin(registry) {
  return currentActive(readPatch(resolvePaths().patchPath), registry) ?? 'none'
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
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
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
          package: entry.pkg,
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
 * Register the skin-switcher API routes.
 *
 * Failure policy: route mounting problems are logged, never thrown — the web
 * shell fails the whole boot when a plugin apply throws, and the skin
 * switcher must not take the GUI down.
 * @param ctx - cordis context.
 */
export function apply(ctx) {
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
