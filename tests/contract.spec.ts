// ---------------------------------------------------------------------------
// Vendored from @linxin666/dsh-client-ui-skill-explorer@0.3.20 (BSD-3-Clause),
// https://github.com/zhu1090093659/dsh-web — packages/dsh-skill-explorer.
// Local changes for this fork: API namespace /api/dsh-skills-manager/*, plugin id
// "dsh-skills-manager", telemetry removed. See README.md for the full change list.
// ---------------------------------------------------------------------------
/**
 * Contract tests: client route literals mirror the host ROUTES, and the host
 * entry exposes the cordis contract (name / inject) — the drift guard the
 * original local plugin smoke asserted.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROUTES, name, inject } from '../src/index.ts'

describe('host plugin contract', () => {
  it('exposes the stable cordis name and inject list', () => {
    expect(name).toBe('dsh-skills-manager')
    expect(inject).toEqual(['webServer', 'skills', 'sessions'])
  })

  it('client bundle /api/ literals are a subset of host ROUTES (no drift)', () => {
    const clientSrc = readFileSync(join(process.cwd(), 'src/client/api.ts'), 'utf8')
    const clientPaths = [...clientSrc.matchAll(/'(\/api\/[^']+)'/g)].map((m) => m[1]).sort()
    const hostPaths = [...new Set(Object.values(ROUTES))].sort()
    // The client mirrors the business routes, including the three
    // directory-management routes added in this fork; health is host-only.
    expect(clientPaths).toEqual([
      '/api/dsh-skills-manager/add-directory',
      '/api/dsh-skills-manager/create',
      '/api/dsh-skills-manager/delete',
      '/api/dsh-skills-manager/directories',
      '/api/dsh-skills-manager/list',
      '/api/dsh-skills-manager/remove-directory',
      '/api/dsh-skills-manager/set-enabled',
    ])
    for (const path of clientPaths) expect(hostPaths).toContain(path)
    expect(hostPaths).toContain('/api/dsh-skills-manager/health')
  })
})
