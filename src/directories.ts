// ---------------------------------------------------------------------------
// New in this fork — no upstream counterpart.
// ---------------------------------------------------------------------------
/**
 * Custom scan directories, managed at runtime from the skill center panel.
 *
 * This is the capability the upstream plugin lacks. There, `customSkillDirs`
 * only ever came from plugin config, so adding a directory such as
 * `D:\Codex\.codex\skills` meant hand-editing the profile's
 * `cordis.patch.yml` and restarting DSH. Here the same list is user-editable
 * from the GUI.
 *
 * Two sources feed one effective list:
 *
 * - `config`  — `customSkillDirs` from the resolved plugin config (the
 *               profile's patch layer). Read-only here: this module never
 *               rewrites the profile config, so a hand-written entry can never
 *               be lost by a GUI action.
 * - `runtime` — entries added through the panel, persisted as JSON under the
 *               DSH home so they survive a restart.
 *
 * Order is significant: config entries first, then runtime entries. Every root
 * is scanned, but on a name collision the earlier entry wins (see collect.ts).
 *
 * Security posture (mirrors the upstream write routes): a path is accepted only
 * when it is absolute and currently resolves to a directory. Nothing is ever
 * executed, and removing an entry only forgets the path — no file on disk is
 * touched.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path'

/** Store file schema version. */
export const STORE_VERSION = 1

/** Directory under the DSH home that holds this plugin's state. */
export const STORE_DIR_NAME = 'dsh-skills-manager'

/** Store file name inside STORE_DIR_NAME. */
export const STORE_FILE_NAME = 'custom-dirs.json'

/** Where a directory entry came from. */
export type DirectorySource = 'config' | 'runtime'

/** One effective scan directory. */
export interface SkillDirectory {
  /** Stable identity: the normalized path, case-folded on Windows. */
  id: string
  /** Absolute path as the user supplied it. */
  path: string
  /** Source of the entry: the plugin config or this panel. */
  source: DirectorySource
  /** How many skills the last collection pass listed from this root. */
  skillCount: number
  /** False when the path is currently missing or not a directory. */
  exists: boolean
}

/** One persisted runtime entry. */
interface StoredDirectory {
  path: string
  addedAt: string
}

/** On-disk store shape. */
interface StoreFile {
  version: number
  directories: StoredDirectory[]
}

/** Failure with a machine-readable code; the routes map it to an HTTP status. */
export class DirectoryError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'DirectoryError'
    this.code = code
  }
}

/** Path identity: resolved, normalized, and case-folded on Windows. */
export function normalizeKey(path: string): string {
  const resolved = resolve(path)
  const normalized = normalize(resolved).replace(/[\\/]+$/u, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/** Absolute path of the store file for one DSH home. */
export function storeFilePath(dshHome: string): string {
  return join(dshHome, STORE_DIR_NAME, STORE_FILE_NAME)
}

/** Whether a path currently names a directory. */
export function directoryExists(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Read the persisted runtime entries. A missing file is an empty list; a
 * corrupt one throws, so the panel reports it instead of silently discarding
 * the user's configuration.
 */
export function readStore(dshHome: string): StoredDirectory[] {
  const file = storeFilePath(dshHome)
  if (!existsSync(file)) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new DirectoryError('STORE_CORRUPT', `cannot parse ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new DirectoryError('STORE_CORRUPT', `${file} must contain a JSON object`)
  }
  const record = parsed as Partial<StoreFile>
  if (record.version !== STORE_VERSION) {
    throw new DirectoryError('STORE_CORRUPT', `${file} has unsupported version ${String(record.version)}`)
  }
  if (!Array.isArray(record.directories)) {
    throw new DirectoryError('STORE_CORRUPT', `${file} is missing the directories array`)
  }
  const out: StoredDirectory[] = []
  for (const entry of record.directories) {
    if (typeof entry !== 'object' || entry === null) continue
    const { path, addedAt } = entry as Partial<StoredDirectory>
    if (typeof path !== 'string' || path.trim() === '') continue
    out.push({ path, addedAt: typeof addedAt === 'string' ? addedAt : new Date(0).toISOString() })
  }
  return out
}

/** Write the runtime entries atomically (no partial file is ever observable). */
export function writeStore(dshHome: string, directories: StoredDirectory[]): void {
  const file = storeFilePath(dshHome)
  mkdirSync(dirname(file), { recursive: true })
  const payload: StoreFile = { version: STORE_VERSION, directories }
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
  try {
    writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    renameSync(tmp, file)
  } catch (error) {
    try {
      unlinkSync(tmp)
    } catch {
      /* the temp file may never have been created; the original error matters */
    }
    throw error
  }
}

/**
 * Validate a user-supplied directory path.
 * @throws DirectoryError INVALID_PATH | NOT_ABSOLUTE | NOT_FOUND | NOT_A_DIRECTORY
 */
export function validateDirectory(path: unknown): string {
  if (typeof path !== 'string' || path.trim() === '') {
    throw new DirectoryError('INVALID_PATH', 'path must be a non-empty string')
  }
  const trimmed = path.trim()
  if (!isAbsolute(trimmed)) {
    throw new DirectoryError('NOT_ABSOLUTE', `path must be absolute: ${trimmed}`)
  }
  if (!existsSync(trimmed)) {
    throw new DirectoryError('NOT_FOUND', `directory does not exist: ${trimmed}`)
  }
  if (!directoryExists(trimmed)) {
    throw new DirectoryError('NOT_A_DIRECTORY', `not a directory: ${trimmed}`)
  }
  return trimmed
}

/**
 * The effective scan list: config entries first, then runtime entries.
 * Duplicates collapse onto the first occurrence (config wins).
 */
export function listDirectories(dshHome: string, configSkillDirs: readonly string[]): SkillDirectory[] {
  const out: SkillDirectory[] = []
  const seen = new Set<string>()
  const push = (path: string, source: DirectorySource): void => {
    const key = normalizeKey(path)
    if (seen.has(key)) return
    seen.add(key)
    out.push({ id: key, path, source, skillCount: 0, exists: directoryExists(path) })
  }
  for (const dir of configSkillDirs) {
    if (typeof dir === 'string' && dir.trim() !== '') push(dir.trim(), 'config')
  }
  for (const entry of readStore(dshHome)) push(entry.path.trim(), 'runtime')
  return out
}

/**
 * Add one runtime directory.
 * @throws DirectoryError INVALID_PATH | NOT_ABSOLUTE | NOT_FOUND | NOT_A_DIRECTORY | ALREADY_CONFIGURED | ALREADY_ADDED
 */
export function addDirectory(dshHome: string, configSkillDirs: readonly string[], path: unknown): SkillDirectory {
  const valid = validateDirectory(path)
  const key = normalizeKey(valid)
  for (const entry of listDirectories(dshHome, configSkillDirs)) {
    if (entry.id !== key) continue
    if (entry.source === 'config') {
      throw new DirectoryError('ALREADY_CONFIGURED', `already configured in customSkillDirs: ${entry.path}`)
    }
    throw new DirectoryError('ALREADY_ADDED', `already added: ${entry.path}`)
  }
  const directories = readStore(dshHome)
  directories.push({ path: valid, addedAt: new Date().toISOString() })
  writeStore(dshHome, directories)
  return { id: key, path: valid, source: 'runtime', skillCount: 0, exists: true }
}

/**
 * Remove one runtime directory. Config entries are not removable here — they
 * live in the profile patch layer — so they report CONFIG_MANAGED.
 * @throws DirectoryError INVALID_PATH | NOT_FOUND | CONFIG_MANAGED
 */
export function removeDirectory(dshHome: string, configSkillDirs: readonly string[], id: unknown): SkillDirectory {
  if (typeof id !== 'string' || id.trim() === '') {
    throw new DirectoryError('INVALID_PATH', 'id must be a non-empty string')
  }
  const entries = listDirectories(dshHome, configSkillDirs)
  // The id is the normalized path, but accept the raw path too so a caller can
  // remove by what it displayed.
  const match = entries.find((entry) => entry.id === id)
    ?? entries.find((entry) => normalizeKey(entry.path) === normalizeKey(id))
  if (match === undefined) {
    throw new DirectoryError('NOT_FOUND', `no such directory: ${id}`)
  }
  if (match.source === 'config') {
    throw new DirectoryError('CONFIG_MANAGED', `${match.path} comes from customSkillDirs in the plugin config; remove it there instead`)
  }
  const remaining = readStore(dshHome).filter((entry) => normalizeKey(entry.path) !== match.id)
  writeStore(dshHome, remaining)
  return match
}
