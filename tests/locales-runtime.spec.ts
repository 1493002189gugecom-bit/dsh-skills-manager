// ---------------------------------------------------------------------------
// Vendored from @linxin666/dsh-client-ui-skill-explorer@0.3.20 (BSD-3-Clause),
// https://github.com/zhu1090093659/dsh-web — packages/dsh-skill-explorer.
// Local changes for this fork: API namespace /api/dsh-skills-manager/*, plugin id
// "dsh-skills-manager", telemetry removed. See README.md for the full change list.
// ---------------------------------------------------------------------------
import { afterEach, describe, expect, it } from 'vitest'
import { setRuntimeTranslate, tt } from '../src/client/panel-helpers.ts'

describe('skill-explorer localized tt runtime wiring', () => {
  afterEach(() => { setRuntimeTranslate(undefined) })

  it('prefers the wired SDK translate seat (reads the active locale at call time)', () => {
    setRuntimeTranslate((key) => `RU(${key})`)
    expect(tt('entry.label')).toBe('RU(entry.label)')
  })

  it('falls back to the document-language dictionary when unwired', () => {
    const label = tt('entry.label')
    expect(label.startsWith('RU(')).toBe(false)
    expect(label.length).toBeGreaterThan(0)
  })

  it('passes template params through to the wired seat', () => {
    setRuntimeTranslate((key, values) => `${key}:${String(values?.count)}`)
    expect(tt('list.count', { count: 3 })).toBe('list.count:3')
  })
})
