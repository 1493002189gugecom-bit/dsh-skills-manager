// ---------------------------------------------------------------------------
// New in this fork — route tests for the directory-management endpoints
// (directories / add-directory / remove-directory).
// ---------------------------------------------------------------------------
/**
 * The three added routes are write-adjacent surface area, so they carry the same
 * expectations as the upstream write routes: the shared trust fence, the method
 * check, body validation, a code-to-status mapping, and the rule that a config
 * root can never be removed from the panel.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ROUTES, makeRoutes } from '../src/routes.ts'

const TMP = mkdtempSync(join(tmpdir(), 'dsh-skills-manager-dirroutes-'))
const HOME = join(TMP, 'home')
const CONFIG_DIR = join(TMP, 'configured-skills')
const EXTRA_DIR = join(TMP, 'extra-skills')
const CODEX_LIKE = join(TMP, 'codex-skills')
const A_FILE = join(TMP, 'not-a-dir.txt')

mkdirSync(CONFIG_DIR, { recursive: true })
mkdirSync(EXTRA_DIR, { recursive: true })
mkdirSync(join(CODEX_LIKE, 'demo-skill'), { recursive: true })
writeFileSync(join(CODEX_LIKE, 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\ndescription: demo\n---\n', 'utf8')
writeFileSync(A_FILE, 'x', 'utf8')

afterAll(() => { rmSync(TMP, { recursive: true, force: true }) })

const routes = makeRoutes({} as never, {
  dshHome: HOME,
  agentsHome: join(TMP, 'agents'),
  customSkillDirs: [CONFIG_DIR],
  registry: { snapshot: async () => ({ skills: [], complete: true }) },
  activeSessionCwds: () => [],
  logger: { warn: () => {} },
})
const find = (path: string) => routes.find((route) => route.path === path)

/** One fake IncomingMessage: loopback socket + loopback Host by default. */
function request(url: string, method = 'GET', options: { remoteAddress?: string; host?: string; body?: unknown } = {}): IncomingMessage {
  return {
    url,
    method,
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    headers: {
      host: options.host ?? 'localhost:3080',
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    async *[Symbol.asyncIterator]() {
      if (options.body !== undefined) yield Buffer.from(JSON.stringify(options.body))
    },
  } as unknown as IncomingMessage
}

/** One fake ServerResponse capturing status/body. */
function response(): { res: ServerResponse; status: () => number; body: () => string } {
  const state = { status: 0, body: '' }
  return {
    res: {
      writeHead(status: number) { state.status = status },
      end(body: string) { state.body = body },
    } as unknown as ServerResponse,
    status: () => state.status,
    body: () => state.body,
  }
}

/** Call one route and return the captured response. */
async function call(path: string, method: string, options: Parameters<typeof request>[2] = {}) {
  const res = response()
  await find(path)!.handler(request(path, method, options), res.res)
  return { status: res.status(), json: () => JSON.parse(res.body()) as Record<string, unknown> }
}

describe('directory routes: trust fence and method', () => {
  it('refuses a non-loopback socket on every added route', async () => {
    for (const path of [ROUTES.directories, ROUTES.addDirectory, ROUTES.removeDirectory]) {
      const method = path === ROUTES.directories ? 'GET' : 'POST'
      const result = await call(path, method, { remoteAddress: '192.168.1.20' })
      expect(result.status).toBe(403)
      expect(result.json().error).toContain('loopback-only')
    }
  })

  it('refuses a non-loopback Host header', async () => {
    const result = await call(ROUTES.directories, 'GET', { host: 'evil.example.com' })
    expect(result.status).toBe(403)
  })

  it('rejects the wrong method', async () => {
    expect((await call(ROUTES.directories, 'POST', { body: {} })).status).toBe(405)
    expect((await call(ROUTES.addDirectory, 'GET')).status).toBe(405)
  })
})

describe('directory routes: listing', () => {
  it('lists the config root with a scanned skill count', async () => {
    const result = await call(ROUTES.directories, 'GET')
    expect(result.status).toBe(200)
    const directories = result.json().directories as Array<Record<string, unknown>>
    // Only the config root exists so far; the panel has added nothing.
    expect(directories).toHaveLength(1)
    expect(directories[0]).toMatchObject({ path: CONFIG_DIR, source: 'config', exists: true })
    expect(String(result.json().store)).toContain('dsh-skills-manager')
  })
})

describe('directory routes: add', () => {
  it('adds an absolute existing directory and reports its skills', async () => {
    const result = await call(ROUTES.addDirectory, 'POST', { body: { path: CODEX_LIKE } })
    expect(result.status).toBe(200)
    expect(result.json().ok).toBe(true)
    const directories = result.json().directories as Array<Record<string, unknown>>
    const added = directories.find((entry) => entry.path === CODEX_LIKE)
    expect(added).toMatchObject({ source: 'runtime', exists: true, skillCount: 1 })
  })

  it('rejects a bad body, a relative path, a missing path and a file', async () => {
    expect((await call(ROUTES.addDirectory, 'POST', { body: {} })).status).toBe(400)
    expect((await call(ROUTES.addDirectory, 'POST', { body: { path: 42 } })).status).toBe(400)
    // no JSON body at all
    expect((await call(ROUTES.addDirectory, 'POST')).status).toBe(400)

    const relative = await call(ROUTES.addDirectory, 'POST', { body: { path: 'relative/dir' } })
    expect(relative.status).toBe(400)
    expect(relative.json().code).toBe('NOT_ABSOLUTE')

    const missing = await call(ROUTES.addDirectory, 'POST', { body: { path: join(TMP, 'does-not-exist') } })
    expect(missing.status).toBe(400)
    expect(missing.json().code).toBe('NOT_FOUND')

    const file = await call(ROUTES.addDirectory, 'POST', { body: { path: A_FILE } })
    expect(file.status).toBe(400)
    expect(file.json().code).toBe('NOT_A_DIRECTORY')
  })

  it('reports a duplicate with 409 and a distinct code', async () => {
    const again = await call(ROUTES.addDirectory, 'POST', { body: { path: CODEX_LIKE } })
    expect(again.status).toBe(409)
    expect(again.json().code).toBe('ALREADY_ADDED')

    const configured = await call(ROUTES.addDirectory, 'POST', { body: { path: CONFIG_DIR } })
    expect(configured.status).toBe(409)
    expect(configured.json().code).toBe('ALREADY_CONFIGURED')
  })

  it('accepts a second directory', async () => {
    const result = await call(ROUTES.addDirectory, 'POST', { body: { path: EXTRA_DIR } })
    expect(result.status).toBe(200)
    const paths = (result.json().directories as Array<{ path: string }>).map((entry) => entry.path)
    expect(paths).toContain(EXTRA_DIR)
  })
})

describe('directory routes: remove', () => {
  it('removes a panel-added directory', async () => {
    const listed = await call(ROUTES.directories, 'GET')
    const target = (listed.json().directories as Array<{ id: string; path: string }>).find((entry) => entry.path === EXTRA_DIR)!
    const result = await call(ROUTES.removeDirectory, 'POST', { body: { id: target.id } })
    expect(result.status).toBe(200)
    expect((result.json().removed as { path: string }).path).toBe(EXTRA_DIR)
    const after = (result.json().directories as Array<{ path: string }>).map((entry) => entry.path)
    expect(after).not.toContain(EXTRA_DIR)
  })

  it('refuses to remove the config-managed root (409 CONFIG_MANAGED)', async () => {
    const listed = await call(ROUTES.directories, 'GET')
    const target = (listed.json().directories as Array<{ id: string; path: string }>).find((entry) => entry.path === CONFIG_DIR)!
    const result = await call(ROUTES.removeDirectory, 'POST', { body: { id: target.id } })
    expect(result.status).toBe(409)
    expect(result.json().code).toBe('CONFIG_MANAGED')
  })

  it('reports an unknown id as 404 and a bad body as 400', async () => {
    expect((await call(ROUTES.removeDirectory, 'POST', { body: { id: 'nope' } })).status).toBe(404)
    expect((await call(ROUTES.removeDirectory, 'POST', { body: {} })).status).toBe(400)
    expect((await call(ROUTES.removeDirectory, 'POST')).status).toBe(400)
  })
})
