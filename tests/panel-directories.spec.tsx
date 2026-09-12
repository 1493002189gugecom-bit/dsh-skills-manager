// ---------------------------------------------------------------------------
// New in this fork — panel tests for the directory manager.
// ---------------------------------------------------------------------------
/**
 * The directories tab is the feature this fork exists for, so its interaction
 * path is covered end to end in jsdom: open the tab, list the effective roots,
 * add a directory through the form, and remove a panel-added one — including
 * the rule that a config-managed root offers no remove button.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkillPanel } from '../src/client/SkillPanel.tsx'
import type { DirectoriesPayload, ListPayload, SkillDirectoryEntry } from '../src/client/api.ts'

const listPayload = (): ListPayload => ({
  cwd: '/work',
  projectRoots: [],
  complete: true,
  groups: [{
    key: 'user-dsh', title: 'User skills', hint: '', skills: [{
      name: 'demo-skill', description: 'desc', provider: 'filesystem', level: 'user-dsh',
      path: '/work/demo-skill/SKILL.md', modelInvocable: true, userInvocable: true,
    }],
  }],
})

const entry = (over: Partial<SkillDirectoryEntry> & { id: string; path: string }): SkillDirectoryEntry => ({
  source: 'runtime', skillCount: 0, exists: true, ...over,
})

/**
 * Fake api whose directory state is mutable, so a test can assert that what the
 * panel renders comes from the host payload rather than from local state.
 */
function fakeApi(initial: SkillDirectoryEntry[]) {
  let directories = [...initial]
  const added: string[] = []
  const removed: string[] = []
  return {
    added,
    removed,
    current: () => directories,
    list: async (): Promise<ListPayload> => listPayload(),
    setEnabled: async () => ({ name: '', enabled: true }),
    remove: async () => ({ ok: true as const, name: '', moved: '' }),
    create: async () => { throw new Error('unused') },
    directories: async (): Promise<DirectoriesPayload> => ({ directories, store: '/home/.dsh/dsh-skills-manager/custom-dirs.json' }),
    addDirectory: async (path: string) => {
      added.push(path)
      const next = entry({ id: path.toLowerCase(), path, skillCount: 3 })
      directories = [...directories, next]
      return { ok: true as const, added: next, directories, store: '/store.json' }
    },
    removeDirectory: async (id: string) => {
      removed.push(id)
      directories = directories.filter((d) => d.id !== id)
      return { ok: true as const, removed: entry({ id, path: id }), directories, store: '/store.json' }
    },
  }
}

function mount(api: ReturnType<typeof fakeApi>) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(<SkillPanel api={api as never} onClose={() => {}} />) })
  return {
    container,
    dispose: () => { root.unmount(); container.remove() },
  }
}

/**
 * Drain pending work inside act(): a tab's first render kicks off an async
 * load, so a single microtask is not enough — a few turns let the promise
 * chain settle before the assertions run.
 */
async function flush(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 3; turn += 1) {
      await new Promise((resolve) => { setTimeout(resolve, 0) })
    }
  })
}

/**
 * Click the tab whose label matches and let its initial load settle.
 * The load is driven by the child's useEffect, so it resolves after the click
 * scope closes; flush() then drains it before the assertions read the DOM.
 */
async function openTab(container: HTMLElement, label: string): Promise<void> {
  await act(async () => {
    const tab = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
    expect(tab, `tab "${label}" not found`).toBeTruthy()
    tab?.click()
  })
  await flush()
}

const text = (node: Element | null): string => node?.textContent ?? ''

describe('directories tab', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('is reachable from the tab bar', async () => {
    const api = fakeApi([])
    const mount_ = mount(api)
    await flush()
    expect(Array.from(mount_.container.querySelectorAll('button')).some((b) => b.textContent?.trim() === '目录管理')).toBe(true)
    mount_.dispose()
  })

  it('lists config-managed and panel-added roots differently', async () => {
    const api = fakeApi([
      entry({ id: 'c:\\configured', path: 'C:\\configured', source: 'config', skillCount: 2 }),
      entry({ id: 'd:\\codex\\.codex\\skills', path: 'D:\\Codex\\.codex\\skills', skillCount: 18 }),
    ])
    const mount_ = mount(api)
    await flush()
    await openTab(mount_.container, '目录管理')

    const rows = mount_.container.querySelectorAll('[data-dsh-part="directory-row"]')
    expect(rows).toHaveLength(2)
    expect(rows[0].getAttribute('data-source')).toBe('config')
    expect(rows[1].getAttribute('data-source')).toBe('runtime')
    expect(text(rows[1])).toContain('D:\\Codex\\.codex\\skills')
    expect(text(rows[1])).toContain('18 个技能')

    // A config root has no remove button; a panel-added one does.
    const rowButtons = (row: Element) => Array.from(row.querySelectorAll('button')).map((b) => b.textContent?.trim())
    expect(rowButtons(rows[0])).toHaveLength(0)
    expect(rowButtons(rows[1])).toContain('移除')

    mount_.dispose()
  })

  it('adds a directory through the form and renders the host response', async () => {
    const api = fakeApi([])
    const mount_ = mount(api)
    await flush()
    await openTab(mount_.container, '目录管理')

    const input = mount_.container.querySelector('[data-dsh-part="directories-tab"] input') as HTMLInputElement
    expect(input).toBeTruthy()
    await act(async () => {
      // React's onChange needs the native setter to observe the value.
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'D:\\Codex\\.codex\\skills')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      const submit = Array.from(mount_.container.querySelectorAll('button')).find((b) => b.textContent?.trim() === '添加目录')
      submit?.click()
    })
    await flush()

    expect(api.added).toEqual(['D:\\Codex\\.codex\\skills'])
    const rows = mount_.container.querySelectorAll('[data-dsh-part="directory-row"]')
    expect(rows).toHaveLength(1)
    expect(text(rows[0])).toContain('D:\\Codex\\.codex\\skills')
    // The input is cleared after a successful add.
    expect((mount_.container.querySelector('[data-dsh-part="directories-tab"] input') as HTMLInputElement).value).toBe('')
    mount_.dispose()
  })

  it('refuses to submit an empty path without calling the host', async () => {
    const api = fakeApi([])
    const mount_ = mount(api)
    await flush()
    await openTab(mount_.container, '目录管理')

    await act(async () => {
      const submit = Array.from(mount_.container.querySelectorAll('button')).find((b) => b.textContent?.trim() === '添加目录')
      submit?.click()
    })
    await flush()

    expect(api.added).toEqual([])
    expect(text(mount_.container.querySelector('[data-dsh-part="directories-tab"]'))).toContain('请填写目录的绝对路径')
    mount_.dispose()
  })

  it('removes a panel-added directory after confirmation', async () => {
    const api = fakeApi([entry({ id: 'd:\\extra', path: 'D:\\extra', skillCount: 1 })])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const mount_ = mount(api)
    await flush()
    await openTab(mount_.container, '目录管理')

    await act(async () => {
      const remove = Array.from(mount_.container.querySelectorAll<HTMLButtonElement>('[data-dsh-part="directory-row"] button'))
        .find((b) => b.textContent?.trim() === '移除')
      remove?.click()
    })
    await flush()

    expect(confirm).toHaveBeenCalledOnce()
    expect(api.removed).toEqual(['d:\\extra'])
    expect(mount_.container.querySelectorAll('[data-dsh-part="directory-row"]')).toHaveLength(0)
    confirm.mockRestore()
    mount_.dispose()
  })

  it('does not remove anything when the confirmation is dismissed', async () => {
    const api = fakeApi([entry({ id: 'd:\\extra', path: 'D:\\extra' })])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const mount_ = mount(api)
    await flush()
    await openTab(mount_.container, '目录管理')

    await act(async () => {
      const remove = Array.from(mount_.container.querySelectorAll<HTMLButtonElement>('[data-dsh-part="directory-row"] button'))
        .find((b) => b.textContent?.trim() === '移除')
      remove?.click()
    })
    await flush()

    expect(api.removed).toEqual([])
    expect(mount_.container.querySelectorAll('[data-dsh-part="directory-row"]')).toHaveLength(1)
    confirm.mockRestore()
    mount_.dispose()
  })

  it('surfaces a host rejection inline', async () => {
    const api = fakeApi([])
    api.addDirectory = async () => { throw new Error('directory does not exist: D:\\nope') }
    const mount_ = mount(api)
    await flush()
    await openTab(mount_.container, '目录管理')

    const input = mount_.container.querySelector('[data-dsh-part="directories-tab"] input') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'D:\\nope')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      const submit = Array.from(mount_.container.querySelectorAll('button')).find((b) => b.textContent?.trim() === '添加目录')
      submit?.click()
    })
    await flush()

    expect(text(mount_.container.querySelector('[data-dsh-part="directories-tab"]'))).toContain('directory does not exist')
    mount_.dispose()
  })
})
