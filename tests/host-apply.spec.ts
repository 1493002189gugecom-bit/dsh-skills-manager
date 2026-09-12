// ---------------------------------------------------------------------------
// Vendored from @linxin666/dsh-client-ui-skill-explorer@0.3.20 (BSD-3-Clause),
// https://github.com/zhu1090093659/dsh-web — packages/dsh-skill-explorer.
// Local changes for this fork: API namespace /api/dsh-skills-manager/*, plugin id
// "dsh-skills-manager", telemetry removed. See README.md for the full change list.
// ---------------------------------------------------------------------------
/**
 * Host apply tests: enabled=false registers nothing; enabled registers the
 * route family and disposes cleanly.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

/** The mountOnce registry key (mirrors shared/host/mount-once.ts) — reset between applies so each case starts fresh. */
const MOUNTED = Symbol.for('dsh-web.mounted-plugins')

function resetMountOnce(): void {
  ;(globalThis as Record<symbol, unknown>)[MOUNTED] = undefined
}

beforeEach(resetMountOnce)

/** Fake cordis ctx capturing route registrations. */
function fakeCtx() {
  const state = { routes: [] as Array<{ path?: string }>, effects: [] as string[] }
  return {
    ...state,
    webServer: {
      register: (route: { path?: string }) => { state.routes.push(route); return () => {} },
    },
    skills: {
      snapshot: async () => ({ skills: [], complete: true }),
    },
    sessions: {
      list: () => [],
    },
    logger: { warn: () => {} },
    effect: (fn: () => unknown, label: string) => {
      state.effects.push(label)
      const disposer = fn()
      return () => { if (typeof disposer === 'function') (disposer as () => void)() }
    },
  }
}

describe('dsh-skills-manager host apply', () => {
  it('is a no-op for a second mount of the same package (aggregate + standalone coexist)', () => {
    const first = fakeCtx()
    apply(first as never, {})
    // Five upstream routes plus the three directory-management routes added in
    // this fork (directories / add-directory / remove-directory).
    expect(first.routes.length).toBe(8)
    const second = fakeCtx()
    apply(second as never, {})
    expect(second.routes.length).toBe(0)
  })

  it('registers nothing when enabled is false', () => {
    const ctx = fakeCtx()
    apply(ctx as never, { enabled: false })
    expect(ctx.routes.length).toBe(0)
  })

  it('registers every route when enabled (default)', () => {
    const ctx = fakeCtx()
    apply(ctx as never, {})
    const paths = ctx.routes.map((route) => route.path)
    expect(paths).toEqual([
      '/api/dsh-skills-manager/list',
      '/api/dsh-skills-manager/set-enabled',
      '/api/dsh-skills-manager/create',
      '/api/dsh-skills-manager/delete',
      '/api/dsh-skills-manager/directories',
      '/api/dsh-skills-manager/add-directory',
      '/api/dsh-skills-manager/remove-directory',
      '/api/dsh-skills-manager/health',
    ])
  })
})
