// ---------------------------------------------------------------------------
// Vendored from @linxin666/dsh-client-ui-skill-explorer@0.3.20 (BSD-3-Clause),
// https://github.com/zhu1090093659/dsh-web — packages/dsh-skill-explorer.
// Local changes for this fork: API namespace /api/dsh-skills-manager/*, plugin id
// "dsh-skills-manager", telemetry removed. See README.md for the full change list.
// ---------------------------------------------------------------------------
/**
 * Skill center API client (browser half). Talks to the host route family over
 * same-origin fetch; the host enforces the trust fence on its side.
 */

/** Route paths mirrored from the host (src/routes.ts ROUTES). */
const API = {
  list: '/api/dsh-skills-manager/list',
  setEnabled: '/api/dsh-skills-manager/set-enabled',
  create: '/api/dsh-skills-manager/create',
  delete: '/api/dsh-skills-manager/delete',
  directories: '/api/dsh-skills-manager/directories',
  addDirectory: '/api/dsh-skills-manager/add-directory',
  removeDirectory: '/api/dsh-skills-manager/remove-directory',
} as const

/** One skill entry as served by the host. */
export interface SkillEntry {
  name: string
  description: string
  whenToUse?: string
  provider?: string
  level: string
  path?: string
  /** True for skills discovered through a symlink entry (deletion not allowed). */
  linked?: boolean
  modelInvocable: boolean
  userInvocable: boolean
  /** Project workspace root path this skill belongs to. */
  workspaceRoot?: string
  /** Display name of the workspace directory. */
  workspaceName?: string
  /** True when the skill belongs to the primary active session workspace. */
  isActiveWorkspace?: boolean
}

/** Group payload served by the host. */
export interface GroupPayload {
  key: string
  title: string
  hint: string
  skills: SkillEntry[]
}

/** Workspace item descriptor. */
export interface WorkspaceItem {
  root: string
  name: string
  active: boolean
}

/** List payload served by the host. */
export interface ListPayload {
  cwd: string
  projectRoots: string[]
  complete: boolean
  groups: GroupPayload[]
  workspaces?: WorkspaceItem[]
}

/** One managed scan directory as served by the host (added in this fork). */
export interface SkillDirectoryEntry {
  /** Stable identity (the normalized path); the remove route keys on it. */
  id: string
  /** Absolute path as it was supplied. */
  path: string
  /** config = customSkillDirs in the plugin config; runtime = added in this panel. */
  source: 'config' | 'runtime'
  /** Skills the last scan listed from this root. */
  skillCount: number
  /** False when the path is currently missing. */
  exists: boolean
}

/** Directory payload served by the host. */
export interface DirectoriesPayload {
  directories: SkillDirectoryEntry[]
  /** Absolute path of the JSON file the panel-added entries persist in. */
  store: string
}

/** One thrown API error with the host-provided message and code. */
export class ApiError extends Error {
  /** Machine-readable host code when one was sent (e.g. ALREADY_ADDED). */
  readonly code: string | undefined

  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

/** Skill center API client. */
export class SkillApi {
  /** Fetch the grouped skill list. */
  async list(cwd?: string): Promise<ListPayload> {
    const url = typeof cwd === 'string' && cwd.trim() !== ''
      ? `${API.list}?cwd=${encodeURIComponent(cwd)}`
      : API.list
    return this.request<ListPayload>(url)
  }

  /** Enable or disable a skill (rewrites disable-model-invocation). */
  async setEnabled(name: string, path: string, enabled: boolean): Promise<{ name: string; enabled: boolean; modelInvocable: boolean; path?: string }> {
    return this.request(API.setEnabled, { method: 'POST', body: { name, path, enabled } })
  }

  /** Create a skill file under the user or project root. */
  async create(payload: { root: 'user' | 'project'; name: string; description: string; whenToUse?: string; content: string; cwd: string }): Promise<{ ok: true; name: string; path: string }> {
    return this.request(API.create, { method: 'POST', body: payload })
  }

  /** Delete a skill (moves it into .trash). */
  async remove(name: string, path: string): Promise<{ ok: true; name: string; moved: string }> {
    return this.request(API.delete, { method: 'POST', body: { name, path } })
  }

  /** List the managed scan directories (config + panel-added). */
  async directories(): Promise<DirectoriesPayload> {
    return this.request<DirectoriesPayload>(API.directories)
  }

  /** Add one scan directory; the host validates and persists it. */
  async addDirectory(path: string): Promise<{ ok: true; added: SkillDirectoryEntry } & DirectoriesPayload> {
    return this.request(API.addDirectory, { method: 'POST', body: { path } })
  }

  /** Remove one panel-added directory (config entries are refused by the host). */
  async removeDirectory(id: string): Promise<{ ok: true; removed: SkillDirectoryEntry } & DirectoriesPayload> {
    return this.request(API.removeDirectory, { method: 'POST', body: { id } })
  }

  private async request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const response = await fetch(path, {
      method: options.method ?? 'GET',
      headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
    let body: unknown
    try {
      body = await response.json()
    } catch {
      body = undefined
    }
    if (!response.ok) {
      const record = typeof body === 'object' && body !== null ? body as { error?: unknown; code?: unknown } : undefined
      const message = typeof record?.error === 'string' ? record.error : `HTTP ${response.status}`
      throw new ApiError(message, typeof record?.code === 'string' ? record.code : undefined)
    }
    return body as T
  }
}
