// ---------------------------------------------------------------------------
// New in this fork — guards the packaged artifact, which no other spec touches.
// ---------------------------------------------------------------------------
/**
 * Contract tests for the built client bundle.
 *
 * Every other spec imports src/ directly, so a broken ModuleLoader wrapper
 * builds green and then fails to mount in the GUI — where a client plugin that
 * does not apply cleanly takes the whole shell down. That is not hypothetical:
 * the first version of scripts/build.mjs omitted `module`/`exports` and
 * `return module.exports`, and the packaged bundle threw
 * `ReferenceError: module is not defined` on load.
 *
 * The build must run first (`npm run build`); without lib/ the packaging checks
 * are skipped so a source-only checkout still tests clean.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROUTES } from '../src/routes.ts'

const CLIENT_BUNDLE = join(process.cwd(), 'lib', 'client.js')
const HOST_BUNDLE = join(process.cwd(), 'lib', 'index.js')
const built = existsSync(CLIENT_BUNDLE) && existsSync(HOST_BUNDLE)

describe.skipIf(!built)('packaged client bundle', () => {
  it('satisfies the ModuleLoader contract and exports a usable plugin', () => {
    // The checker runs the bundle with stubbed browser globals and calls the
    // factory the way the loader does; it exits non-zero on any violation.
    const output = execFileSync(process.execPath, [join('scripts', 'check-client-contract.mjs')], { encoding: 'utf8' })
    expect(output).toContain('registration id:         "dsh-skills-manager"')
    expect(output).toContain('apply:                   function')
    expect(output).toContain('OK: the client bundle satisfies the ModuleLoader plugin contract')
  }, 30_000)

  it('declares the module scope esbuild assumes but does not emit', () => {
    const source = execFileSync(process.execPath, ['-e', `process.stdout.write(require('node:fs').readFileSync(${JSON.stringify(CLIENT_BUNDLE)}, 'utf8').slice(0, 400))`], { encoding: 'utf8' })
    expect(source).toContain('var module = { exports: {} };')
    expect(source).toContain('var exports = module.exports;')
  })

  it('exposes the host routes this client talks to', () => {
    // The host bundle must carry the same literals the client fetches.
    const host = execFileSync(process.execPath, ['-e', `process.stdout.write(require('node:fs').readFileSync(${JSON.stringify(HOST_BUNDLE)}, 'utf8'))`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    for (const path of Object.values(ROUTES)) {
      expect(host).toContain(path)
    }
  })
})

describe.skipIf(built)('packaged client bundle (not built)', () => {
  it('reports that lib/ is absent so the packaging checks were skipped', () => {
    expect(built).toBe(false)
  })
})
