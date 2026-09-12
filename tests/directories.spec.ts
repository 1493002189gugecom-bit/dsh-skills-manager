// ---------------------------------------------------------------------------
// New in this fork — tests for src/directories.ts.
// ---------------------------------------------------------------------------
/**
 * Directory-store tests: path validation, dedup and precedence against config
 * roots, persistence, atomic writes, and the corrupt-store refusal.
 *
 * The security-relevant behaviour is asserted here rather than only through the
 * routes: a path is stored only when it is absolute and currently a directory,
 * and removal never touches the filesystem.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DirectoryError,
  addDirectory,
  directoryExists,
  listDirectories,
  normalizeKey,
  readStore,
  removeDirectory,
  storeFilePath,
  validateDirectory,
  writeStore,
} from '../src/directories.ts'

let home: string
let dirA: string
let dirB: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dsh-skills-manager-store-'))
  dirA = join(home, 'skills-a')
  dirB = join(home, 'skills-b')
  mkdirSync(dirA, { recursive: true })
  mkdirSync(dirB, { recursive: true })
})

afterEach(() => { rmSync(home, { recursive: true, force: true }) })

/** Capture the DirectoryError code of a throwing call. */
function codeOf(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    return error instanceof DirectoryError ? error.code : `unexpected:${String(error)}`
  }
  return 'no-throw'
}

describe('directory store: reading', () => {
  it('treats a missing store as an empty list', () => {
    expect(readStore(home)).toEqual([])
    expect(existsSync(storeFilePath(home))).toBe(false)
  })

  it('refuses a corrupt store instead of silently discarding it', () => {
    mkdirSync(join(home, 'dsh-skills-manager'), { recursive: true })
    writeFileSync(storeFilePath(home), '{ not json', 'utf8')
    expect(codeOf(() => readStore(home))).toBe('STORE_CORRUPT')

    writeFileSync(storeFilePath(home), JSON.stringify({ version: 99, directories: [] }), 'utf8')
    expect(codeOf(() => readStore(home))).toBe('STORE_CORRUPT')

    writeFileSync(storeFilePath(home), JSON.stringify({ version: 1 }), 'utf8')
    expect(codeOf(() => readStore(home))).toBe('STORE_CORRUPT')
  })

  it('drops malformed entries rather than failing the whole read', () => {
    writeStore(home, [{ path: dirA, addedAt: new Date(0).toISOString() }])
    const raw = JSON.parse(readFileSync(storeFilePath(home), 'utf8')) as { directories: unknown[] }
    raw.directories.push(null, { path: '' }, { path: 42 }, { path: dirB })
    writeFileSync(storeFilePath(home), JSON.stringify(raw), 'utf8')
    expect(readStore(home).map((entry) => entry.path)).toEqual([dirA, dirB])
  })

  it('leaves no temp file behind after a write', () => {
    writeStore(home, [{ path: dirA, addedAt: new Date(0).toISOString() }])
    const stateDir = join(home, 'dsh-skills-manager')
    expect(readdirSync(stateDir)).toEqual(['custom-dirs.json'])
  })
})

describe('directory store: validation', () => {
  it('accepts an existing absolute directory', () => {
    expect(validateDirectory(dirA)).toBe(dirA)
    expect(directoryExists(dirA)).toBe(true)
  })

  it('rejects empty, relative, missing and file paths with distinct codes', () => {
    expect(codeOf(() => validateDirectory(''))).toBe('INVALID_PATH')
    expect(codeOf(() => validateDirectory('   '))).toBe('INVALID_PATH')
    expect(codeOf(() => validateDirectory(42))).toBe('INVALID_PATH')
    expect(codeOf(() => validateDirectory('relative/path'))).toBe('NOT_ABSOLUTE')
    expect(codeOf(() => validateDirectory(join(home, 'nope')))).toBe('NOT_FOUND')
    const file = join(home, 'a-file.txt')
    writeFileSync(file, 'x', 'utf8')
    expect(codeOf(() => validateDirectory(file))).toBe('NOT_A_DIRECTORY')
    expect(directoryExists(file)).toBe(false)
  })
})

describe('directory store: effective list', () => {
  it('lists config roots first, then panel-added roots', () => {
    addDirectory(home, [], dirA)
    const listed = listDirectories(home, [dirB])
    expect(listed.map((entry) => [entry.source, entry.path])).toEqual([
      ['config', dirB],
      ['runtime', dirA],
    ])
    // Every root is reported as present; the counts are filled by a scan.
    expect(listed.every((entry) => entry.exists && entry.skillCount === 0)).toBe(true)
  })

  it('collapses a panel entry that duplicates a config root (config wins)', () => {
    expect(codeOf(() => addDirectory(home, [dirA], dirA))).toBe('ALREADY_CONFIGURED')
    const listed = listDirectories(home, [dirA])
    expect(listed).toHaveLength(1)
    expect(listed[0].source).toBe('config')
  })

  it('refuses adding the same directory twice', () => {
    addDirectory(home, [], dirA)
    expect(codeOf(() => addDirectory(home, [], dirA))).toBe('ALREADY_ADDED')
  })

  it('is insensitive to trailing separators and (on Windows) letter case', () => {
    const key = normalizeKey(dirA)
    expect(normalizeKey(`${dirA}\\`)).toBe(key)
    if (process.platform === 'win32') expect(normalizeKey(dirA.toUpperCase())).toBe(key)
  })

  it('reports a vanished directory as missing without dropping the entry', () => {
    addDirectory(home, [], dirB)
    rmSync(dirB, { recursive: true, force: true })
    const listed = listDirectories(home, [])
    expect(listed).toHaveLength(1)
    expect(listed[0].exists).toBe(false)
  })
})

describe('directory store: removal', () => {
  it('forgets a panel-added directory and never touches the filesystem', () => {
    mkdirSync(join(dirA, 'demo-skill'), { recursive: true })
    writeFileSync(join(dirA, 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\n---\n', 'utf8')
    const added = addDirectory(home, [], dirA)
    const removed = removeDirectory(home, [], added.id)
    expect(removed.path).toBe(dirA)
    expect(listDirectories(home, [])).toEqual([])
    // The skill file is untouched: removal is configuration-only.
    expect(existsSync(join(dirA, 'demo-skill', 'SKILL.md'))).toBe(true)
  })

  it('accepts either the normalized id or the raw path', () => {
    addDirectory(home, [], dirA)
    expect(removeDirectory(home, [], dirA).path).toBe(dirA)
  })

  it('refuses to remove a config-managed directory', () => {
    expect(codeOf(() => removeDirectory(home, [dirA], normalizeKey(dirA)))).toBe('CONFIG_MANAGED')
    // ...and the config root is still listed afterwards.
    expect(listDirectories(home, [dirA])).toHaveLength(1)
  })

  it('reports unknown ids and empty ids', () => {
    expect(codeOf(() => removeDirectory(home, [], normalizeKey(dirA)))).toBe('NOT_FOUND')
    expect(codeOf(() => removeDirectory(home, [], ''))).toBe('INVALID_PATH')
  })

  it('persists additions across a fresh read (restart survival)', () => {
    addDirectory(home, [], dirA)
    addDirectory(home, [], dirB)
    // A new process would re-read the same file.
    expect(readStore(home).map((entry) => entry.path)).toEqual([dirA, dirB])
    removeDirectory(home, [], normalizeKey(dirA))
    expect(readStore(home).map((entry) => entry.path)).toEqual([dirB])
  })
})
