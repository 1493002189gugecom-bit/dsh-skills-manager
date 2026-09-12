// ---------------------------------------------------------------------------
// New in this fork — no upstream counterpart.
// ---------------------------------------------------------------------------
/**
 * Directories tab: manage the custom skill scan roots from the panel.
 *
 * This is the surface the upstream plugin lacks. There, adding a directory
 * such as `D:\Codex\.codex\skills` meant hand-editing `customSkillDirs` in the
 * profile's `cordis.patch.yml` and restarting DSH. Entries added here are
 * validated by the host, persisted under the DSH home, and visible to the very
 * next scan.
 *
 * Two kinds of row are shown and they behave differently on purpose:
 *   - `runtime` rows were added here and can be removed.
 *   - `config`  rows come from the plugin config. Removing them would mean
 *     rewriting your profile, so the host refuses (CONFIG_MANAGED) and the row
 *     instead says where to edit them.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, type DirectoriesPayload, type SkillApi, type SkillDirectoryEntry } from './api.ts'
import { tt } from './panel-helpers.ts'
import css from './skill-panel.module.css'

/** Props: the API client plus the hook the panel uses to refresh its list. */
export interface DirectoriesTabProps {
  api: SkillApi
  /** Called after a successful add/remove so the skill list re-scans. */
  onChanged: () => void
}

/** One directory row: path, origin badge, scan count, remove button. */
function DirectoryRow({ entry, onRemove, busy }: { entry: SkillDirectoryEntry; onRemove: (entry: SkillDirectoryEntry) => void; busy: boolean }): React.JSX.Element {
  const isConfig = entry.source === 'config'
  return (
    <li className={css.dirRow} data-dsh-part="directory-row" data-source={entry.source}>
      <div className={css.dirRowMain}>
        <code className={css.dirPath}>{entry.path}</code>
        <span className={`${css.badge} ${isConfig ? css.badgeWorkspace : css.badgeInvokable}`}>
          {isConfig ? tt('dirs.source.config') : tt('dirs.source.runtime')}
        </span>
        {entry.exists
          ? <span className={css.badge}>{tt('dirs.count', { count: String(entry.skillCount) })}</span>
          : <span className={`${css.badge} ${css.badgeIsolated}`}>{tt('dirs.missing')}</span>}
      </div>
      <div className={css.dirRowActions}>
        {isConfig
          ? <span className={css.dirNote} title={tt('dirs.configHint')}>{tt('dirs.configHintShort')}</span>
          : (
              <button
                type="button"
                className={css.deleteButton}
                disabled={busy}
                onClick={() => { onRemove(entry) }}
              >
                {tt('dirs.remove')}
              </button>
            )}
      </div>
    </li>
  )
}

/** The directories tab body. */
export function DirectoriesTab({ api, onChanged }: DirectoriesTabProps): React.JSX.Element {
  const [payload, setPayload] = useState<DirectoriesPayload | undefined>(undefined)
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  // Sync ref guard (same reason as the skill cards): React state lands after
  // the render, so a double submit would otherwise fire twice with a stale value.
  const busyRef = useRef(false)

  const load = useCallback(async (): Promise<void> => {
    try {
      setPayload(await api.directories())
      setError(undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [api])

  useEffect(() => { void load() }, [load])

  /** Run one mutation behind the shared busy guard, surfacing failures inline. */
  const run = async (action: () => Promise<DirectoriesPayload>, done: string): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    try {
      setPayload(await action())
      setNotice(done)
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const target = path.trim()
    if (target === '') {
      setError(tt('dirs.empty'))
      return
    }
    void run(async () => {
      const result = await api.addDirectory(target)
      setPath('')
      return result
    }, tt('dirs.added', { path: target }))
  }

  const remove = (entry: SkillDirectoryEntry): void => {
    if (!window.confirm(tt('dirs.removeConfirm', { path: entry.path }))) return
    void run(() => api.removeDirectory(entry.id), tt('dirs.removed', { path: entry.path }))
  }

  const directories = payload?.directories ?? []

  return (
    <div data-dsh-part="directories-tab">
      <p className={css.groupHint}>{tt('dirs.intro')}</p>

      <form className={css.form} onSubmit={submit}>
        <label className={css.formLabel}>
          {tt('dirs.path')}
          <input
            className={css.formInput}
            value={path}
            spellCheck={false}
            placeholder={tt('dirs.pathPlaceholder')}
            onChange={(event) => { setPath(event.target.value) }}
          />
        </label>
        <button type="submit" className={css.formButton} disabled={busy}>{tt('dirs.add')}</button>
        {error !== undefined && <p className={css.feedback}>{tt('dirs.failed', { error })}</p>}
        {notice !== undefined && error === undefined && <p className={`${css.feedback} ${css.feedbackOk}`}>{notice}</p>}
        <p className={css.note}>{tt('dirs.note')}</p>
      </form>

      <h3 className={css.groupTitle}>
        {tt('dirs.title')}
        <span className={css.count}>{tt('dirs.total', { count: String(directories.length) })}</span>
      </h3>

      {payload === undefined && error === undefined && <div className={css.status}>{tt('list.loading')}</div>}
      {payload !== undefined && directories.length === 0 && <p className={css.filterEmpty}>{tt('dirs.emptyList')}</p>}
      {directories.length > 0 && (
        <ul className={css.dirList}>
          {directories.map((entry) => (
            <DirectoryRow key={entry.id} entry={entry} busy={busy} onRemove={remove} />
          ))}
        </ul>
      )}

      {payload !== undefined && <p className={css.note}>{tt('dirs.store', { path: payload.store })}</p>}
    </div>
  )
}
