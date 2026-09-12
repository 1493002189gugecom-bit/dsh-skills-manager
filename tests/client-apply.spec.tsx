// ---------------------------------------------------------------------------
// Vendored from @linxin666/dsh-client-ui-skill-explorer@0.3.20 (BSD-3-Clause),
// https://github.com/zhu1090093659/dsh-web — packages/dsh-skill-explorer.
// Local changes for this fork: API namespace /api/dsh-skills-manager/*, plugin id
// "dsh-skills-manager", telemetry removed. See README.md for the full change list.
// ---------------------------------------------------------------------------
/**
 * Browser-half apply smoke: registers the locale dictionary and mounts the
 * sidebar entry without throwing (jsdom). The panel itself mounts lazily on
 * entry toggle; the entry row waits for the real sidebar root, so in jsdom
 * (no sidebar) apply must still complete cleanly and dispose without residue.
 */
import { describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'

describe('skill-explorer client apply', () => {
  it('registers the locale namespace and disposes cleanly', () => {
    const registered: string[] = []
    const disposers: Array<() => void> = []
    const ctx = {
      effect: (fn: () => unknown) => {
        const disposer = fn()
        disposers.push(() => {
          if (typeof disposer === 'function') (disposer as () => void)()
        })
      },
      locale: {
        register: (ns: string) => { registered.push(ns); return () => {} },
      },
    }
    // Must not throw even though jsdom has no sidebar root and no locale
    // service beyond the stub above.
    expect(() => apply(ctx as never)).not.toThrow()
    expect(registered).toEqual(['dsh-skills-manager'])
    for (const dispose of disposers) dispose()
  })
})
