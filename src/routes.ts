// ---------------------------------------------------------------------------
// Vendored from @linxin666/dsh-client-ui-skill-explorer@0.3.20 (BSD-3-Clause),
// https://github.com/zhu1090093659/dsh-web — packages/dsh-skill-explorer.
// Local changes for this fork: API namespace /api/dsh-skills-manager/*, plugin id
// "dsh-skills-manager", telemetry removed. See README.md for the full change list.
// ---------------------------------------------------------------------------
/**
 * The /api/dsh-skills-manager route family: list (grouped by source), set
 * enabled (rewrites SKILL.md frontmatter), create, delete (move to .trash)
 * and health. Every route carries the shared trust fence (loopback by
 * default; a live paired-device cookie is an extra allow path when
 * remote-web-ui is loaded) plus browser same-origin markers — the write
 * routes touch real skill files, so unpaired LAN clients must not reach them.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isSkillExplorerAllowed } from './access.ts'
import { buildPayload, collectSkills, findProjectRoot, projectSkillRoot, trashSkillFile, userSkillRoot, writeSkillFile, type CollectOptions, type SkillEntry } from './collect.ts'
import { addDirectory, DirectoryError, listDirectories, removeDirectory, storeFilePath, type SkillDirectory } from './directories.ts'
import { setFrontmatterField } from './frontmatter.ts'
import { readJsonBody, writeJson } from './http.ts'

/** Route paths (client bundle mirrors these literals; tests assert both sides). */
export const ROUTES = {
  list: '/api/dsh-skills-manager/list',
  setEnabled: '/api/dsh-skills-manager/set-enabled',
  create: '/api/dsh-skills-manager/create',
  delete: '/api/dsh-skills-manager/delete',
  // Added in this fork: manage the scan directories from the panel.
  directories: '/api/dsh-skills-manager/directories',
  addDirectory: '/api/dsh-skills-manager/add-directory',
  removeDirectory: '/api/dsh-skills-manager/remove-directory',
  health: '/api/dsh-skills-manager/health',
} as const

/** URL query helper (first value, decoded). */
function queryParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)
  return value === null ? undefined : value
}

/** Skill name pattern shared by the routes (kebab-case). */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/** HTTP status for one DirectoryError code (unknown faults stay 500). */
function directoryErrorStatus(error: unknown): number {
  switch (directoryErrorCode(error)) {
    case 'ALREADY_ADDED':
    case 'ALREADY_CONFIGURED':
    case 'CONFIG_MANAGED':
      return 409
    case 'NOT_FOUND':
      return 404
    case 'INVALID_PATH':
    case 'NOT_ABSOLUTE':
    case 'NOT_A_DIRECTORY':
      return 400
    default:
      // STORE_CORRUPT and anything unexpected is a server-side fault.
      return 500
  }
}

/** Machine-readable code for a thrown error. */
function directoryErrorCode(error: unknown): string {
  return error instanceof DirectoryError ? error.code : 'INTERNAL'
}

/** Route family dependencies (tests inject fakes). */
export interface SkillRoutesDeps {
  /** User dsh config root (~/.dsh). */
  dshHome: string
  /** User agents config root (~/.agents). */
  agentsHome: string
  /**
   * Extra custom skill roots from plugin config. Plain strings are accepted so
   * existing callers keep working; SkillDirectory entries carry provenance.
   */
  customSkillDirs: Array<string | SkillDirectory>
  /** ctx.skills registry (snapshot). */
  registry: CollectOptions['registry']
  /** Active session cwd list (project root base). */
  activeSessionCwds(): string[]
  /** Logger. */
  logger: { warn(error: unknown): void }
}

/** Default process cwd fallback (overridable in tests). */
export const DEFAULT_CWD = (): string => process.cwd()

/**
 * Build every /api/dsh-skills-manager route (exact paths).
 * @param ctx - host context; may expose remoteWebUiPairing.
 * @param deps - dshHome/agentsHome/registry/sessions.
 * @returns the route list for ctx.webServer.register.
 */
export function makeRoutes(ctx: Context, deps: SkillRoutesDeps): WebRoute[] {
  const { dshHome, agentsHome, customSkillDirs, registry, activeSessionCwds, logger } = deps

  /** The config-supplied roots, normalised to strings (the store layer only needs paths). */
  const configPaths = customSkillDirs.map((entry) => (typeof entry === 'string' ? entry : entry.path))

  /**
   * Effective scan roots for THIS request: the configured customSkillDirs plus
   * the panel-added entries in the store. Re-read per request so a directory
   * added in the panel appears on the very next refresh, with no plugin
   * restart (the store is a single small JSON file).
   */
  const currentDirectories = (): SkillDirectory[] => {
    try {
      return listDirectories(dshHome, configPaths)
    } catch (error) {
      // A corrupt store must not blind the panel to the configured roots.
      logger.warn(error)
      return customSkillDirs.map((entry) => (typeof entry === 'string'
        ? { id: entry, path: entry, source: 'config' as const, skillCount: 0, exists: true }
        : entry))
    }
  }

  /** Guard helper: fence + method check. */
  const guard = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (!isSkillExplorerAllowed(ctx, req)) {
      writeJson(res, 403, { error: 'forbidden: loopback-only' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { error: `method not allowed: ${req.method}` })
      return false
    }
    return true
  }

  /** Active session cwd list (degraded to [] when sessions throw). */
  const safeSessionCwds = (): string[] => {
    try {
      return activeSessionCwds()
    } catch {
      return []
    }
  }

  /** Active session project roots (degraded to [] when sessions throw). */
  const sessionProjectRoots = (): string[] => {
    try {
      return safeSessionCwds().map((sessionCwd) => findProjectRoot(sessionCwd))
    } catch {
      return []
    }
  }

  /** Collect options shared by list/set-enabled/delete/health handlers. */
  const collectOptions = (cwd: string): CollectOptions => ({
    cwd,
    projectRoots: sessionProjectRoots(),
    customSkillDirs: currentDirectories(),
    dshHome,
    agentsHome,
    registry,
  })

  /** Directory payload: effective entries, each with its scanned skill count. */
  const directoryPayload = async (): Promise<{ directories: SkillDirectory[]; store: string }> => {
    const entries = currentDirectories()
    const { rootCounts } = await collectSkills(collectOptions(DEFAULT_CWD()))
    return {
      directories: entries.map((entry) => ({ ...entry, skillCount: rootCounts.get(entry.id) ?? 0 })),
      store: storeFilePath(dshHome),
    }
  }

  /** Find a skill by name from a fresh collection pass (trusts scanned paths only). */
  const findSkill = async (name: string, cwd: string): Promise<SkillEntry | undefined> => {
    const { skills } = await collectSkills(collectOptions(cwd))
    return skills.find((candidate) => candidate.name === name)
  }

  /** Resolve the exact editable file shown by the client, rejecting stale same-name fallbacks. */
  const resolveMutationSkill = async (
    name: string,
    expectedPath: string,
    cwd: string,
    res: ServerResponse,
  ): Promise<(SkillEntry & { path: string }) | undefined> => {
    const skill = await findSkill(name, cwd)
    if (skill?.path === undefined) {
      writeJson(res, 404, { error: `skill ${name} has no editable file` })
      return undefined
    }
    if (skill.path !== expectedPath) {
      writeJson(res, 409, { error: `skill ${name} changed since the panel loaded; refresh and retry` })
      return undefined
    }
    return skill as SkillEntry & { path: string }
  }

  const routes: WebRoute[] = [
    {
      kind: 'exact',
      path: ROUTES.list,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'GET')) return
        try {
          const url = new URL(req.url ?? '/', 'http://x')
          // Project root base: explicit ?cwd= first, then active session
          // workspaces, process.cwd() last.
          const sessionCwds = safeSessionCwds()
          const cwd = queryParam(url, 'cwd') ?? sessionCwds[0] ?? DEFAULT_CWD()
          const projectRoots = sessionProjectRoots()
          const { skills, complete } = await collectSkills(collectOptions(cwd))
          writeJson(res, 200, buildPayload(skills, complete, cwd, [...new Set(projectRoots)]))
        } catch (error) {
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.setEnabled,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req, { maxBytes: 128 * 1024, objectOnly: true })
          if (body === null) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          const payload = body as Record<string, unknown>
          const { name, path, enabled } = payload
          if (typeof name !== 'string' || !NAME_PATTERN.test(name) || typeof path !== 'string' || path.trim() === '' || typeof enabled !== 'boolean') {
            writeJson(res, 400, { error: 'expected { name, path, enabled }' })
            return
          }
          // The client path is only an identity claim: a fresh scan must
          // resolve the same effective skill before any file is touched.
          const skill = await resolveMutationSkill(name, path, DEFAULT_CWD(), res)
          if (skill === undefined) return
          // Disabled = disable-model-invocation: true; enabled = false.
          const frontmatter = setFrontmatterField(skill.path, 'disable-model-invocation', enabled ? false : true)
          writeJson(res, 200, {
            name,
            enabled: frontmatter.disableModelInvocation !== true,
            modelInvocable: frontmatter.disableModelInvocation !== true,
            path: skill.path,
          })
        } catch (error) {
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.create,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req, { maxBytes: 128 * 1024, objectOnly: true })
          if (body === null) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          const payload = body as Record<string, unknown>
          const { root, name, description, whenToUse, content, cwd } = payload
          if (root !== 'user' && root !== 'project') {
            writeJson(res, 400, { error: 'root must be user (~/.dsh/skills) or project (project .dsh/skills)' })
            return
          }
          if (typeof cwd !== 'string' || cwd.trim() === '') {
            writeJson(res, 400, { error: 'cwd is required (the workspace shown by the panel)' })
            return
          }
          if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
            writeJson(res, 400, { error: 'name must be kebab-case (lowercase letters/digits first)' })
            return
          }
          if (typeof description !== 'string' || description.trim() === '') {
            writeJson(res, 400, { error: 'description is required' })
            return
          }
          if (typeof content !== 'string' || content.trim() === '') {
            writeJson(res, 400, { error: 'content is required' })
            return
          }
          if (Buffer.byteLength(content, 'utf8') > 64 * 1024) {
            writeJson(res, 400, { error: 'content exceeds 64KB limit' })
            return
          }
          const baseDir = root === 'user'
            ? userSkillRoot(dshHome)
            : projectSkillRoot(findProjectRoot(cwd))
          const target = await writeSkillFile(baseDir, name, description, typeof whenToUse === 'string' ? whenToUse : undefined, content)
          writeJson(res, 200, { ok: true, name, path: target })
        } catch (error) {
          if (error instanceof Error && /already exists/.test(error.message)) {
            writeJson(res, 409, { error: error.message })
            return
          }
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.delete,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req, { maxBytes: 128 * 1024, objectOnly: true })
          if (body === null) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          const payload = body as Record<string, unknown>
          const { name, path } = payload
          if (typeof name !== 'string' || !NAME_PATTERN.test(name) || typeof path !== 'string' || path.trim() === '') {
            writeJson(res, 400, { error: 'expected { name, path }' })
            return
          }
          const skill = await resolveMutationSkill(name, path, DEFAULT_CWD(), res)
          if (skill === undefined) return
          // A linked skill lives behind a symlink (mount-of-intent content, not
          // created under this root). Deleting it would move the target's real
          // SKILL.md out of place, escaping this skill root — refuse deletion.
          if (skill.linked === true) {
            writeJson(res, 400, { error: `skill ${name} is a linked skill and cannot be deleted` })
            return
          }
          const moved = await trashSkillFile(skill.path)
          writeJson(res, 200, { ok: true, name, moved })
        } catch (error) {
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.directories,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'GET')) return
        try {
          writeJson(res, 200, { ok: true, ...(await directoryPayload()) })
        } catch (error) {
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.addDirectory,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req, { maxBytes: 32 * 1024, objectOnly: true })
          if (body === null) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          const { path } = body as Record<string, unknown>
          // The path is validated (absolute + an existing directory) before it
          // is stored; nothing on disk is created or executed.
          const added = addDirectory(dshHome, configPaths, path)
          writeJson(res, 200, { ok: true, added, ...(await directoryPayload()) })
        } catch (error) {
          // On this route NOT_FOUND means "the path you gave does not exist",
          // which is a bad request from the caller — not a missing resource.
          const code = directoryErrorCode(error)
          const status = code === 'NOT_FOUND' ? 400 : directoryErrorStatus(error)
          if (status === 500) logger.warn(error)
          writeJson(res, status, { error: error instanceof Error ? error.message : String(error), code })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.removeDirectory,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req, { maxBytes: 32 * 1024, objectOnly: true })
          if (body === null) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          const { id } = body as Record<string, unknown>
          // Removing an entry only forgets the path; no skill file is deleted.
          const removed = removeDirectory(dshHome, configPaths, id)
          writeJson(res, 200, { ok: true, removed, ...(await directoryPayload()) })
        } catch (error) {
          const status = directoryErrorStatus(error)
          if (status === 500) logger.warn(error)
          writeJson(res, status, { error: error instanceof Error ? error.message : String(error), code: directoryErrorCode(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.health,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'GET')) return
        try {
          const { skills } = await collectSkills(collectOptions(DEFAULT_CWD()))
          writeJson(res, 200, { ok: true, plugin: 'dsh-skills-manager', skills: skills.length })
        } catch (error) {
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
  ]
  return routes
}
