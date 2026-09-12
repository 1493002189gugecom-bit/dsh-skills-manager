// ---------------------------------------------------------------------------
// Vendored from @linxin666/dsh-client-ui-skill-explorer@0.3.20 (BSD-3-Clause),
// https://github.com/zhu1090093659/dsh-web — packages/dsh-skill-explorer.
// Local changes for this fork: API namespace /api/dsh-skills-manager/*, plugin id
// "dsh-skills-manager", telemetry removed. See README.md for the full change list.
// ---------------------------------------------------------------------------
/**
 * Browser-half entry for the skill-explorer plugin — runs inside the dsh web GUI.
 *
 * Registers the skill-explorer locale dictionaries and mounts the two DOM
 * surfaces: the sidebar entry row (toggles the panel) and the skill center
 * overlay panel. Failure policy: DOM mounting problems are logged, never
 * thrown — the web shell fails the whole boot when a plugin apply throws, and
 * an external plugin must not take the GUI down.
 *
 * Export discipline (packages/client rule): the /client surface carries what
 * cordis loading needs plus types only — all value exports stay internal.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.slots merge (the renderer owns the slot registry since 0.1.2).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the LocaleNamespaceMap merge table.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { SkillApi } from './api.ts'
import { setRuntimeTranslate } from './panel-helpers.ts'
import { en, zh, type SkillExplorerKey } from './locales.ts'
import { mountPanel } from './panel-mount.tsx'
import { mountSidebarEntry } from './sidebar-entry.ts'
import { injectSkillPanelStyles } from './styles.ts'

/** Locale namespace this plugin owns. */
const NS = 'dsh-skills-manager'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** skill-explorer surface copy. */
    'dsh-skills-manager': SkillExplorerKey
  }
}

/** Required services (fiber inject waiting — the runtime must be up first). */
export const inject = ['slots', 'locale']

/** Type-only surface (export discipline: no value exports beyond the plugin contract). */
export type { SkillPanelProps } from './SkillPanel.tsx'
export type { SkillExplorerKey } from './locales.ts'
export type { SkillApi } from './api.ts'

/**
 * Mount the skill center surfaces.
 * @param ctx - client root context (locale service).
 */
export function apply(ctx: ClientContext): void {
  // No install telemetry in this fork: the upstream heartbeat to
  // dsh-market.com was removed along with src/client/telemetry.ts, so this
  // plugin makes no outbound requests at all.

  // The stylesheet rides inside this bundle (scripts/build.mjs); inject it
  // before the first mount so the panel never paints unstyled.
  try { injectSkillPanelStyles() } catch { /* styling failure must not take the GUI down */ }

  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'dsh-skills-manager: dictionaries')

  // Wire the SDK translate seat into the module-level tt (sidebar row and
  // other plain-DOM callers): reads the active locale at call time, so they
  // follow the Language setting without a reload.
  try { setRuntimeTranslate(ctx.locale.bind(NS)) } catch { /* locale missing: document-language fallback stays */ }

  const api = new SkillApi()
  const panel = mountPanel(api, ctx.locale)
  const disposers: Array<() => void> = []
  try {
    disposers.push(mountSidebarEntry(() => panel.toggle(), ctx.locale))
    disposers.push(() => panel.dispose())
  } catch (error) {
    // DOM failures degrade the panel, never the GUI.
    console.warn('[skill-explorer] mount failed:', error)
  }
  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) dispose()
  }, 'dsh-skills-manager: ui mounts')
}
