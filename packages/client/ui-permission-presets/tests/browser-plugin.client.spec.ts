/**
 * ui-permission browser half on a real cordis Context with fake command/
 * sessions faces: the plugin hangs the /permission popup decoration on the
 * host command; options join the process catalog with the Session's current
 * value; availability requires both sources; a pick submits the /permission line through
 * Session.command and surfaces rejection/unmatched as thrown errors; fiber
 * disposal removes the contribution (HMR safety). The same plugin registers
 * its Settings row and invalidates that row on host settings changes.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { remoteDefaultResponses } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/remote-default-responses.ts'
import { ok, RemoteMock } from '@deepseek-ai/dsh-remote-mock'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { CommandDecoration, PopupSelectSpec } from '@deepseek-ai/dsh-client-ui-commands/client'
import { PopupSelectController } from '@deepseek-ai/dsh-client-ui-commands/client'
import type {
  PermissionCatalog, PermissionSelection,
} from '@deepseek-ai/dsh-permission-presets/client'
import {
  PermissionRow, type PermissionRowInjected,
} from '../src/client/PermissionRow.tsx'
import { PermissionSelect } from '../src/client/PermissionSelect.tsx'
import type { PermissionSelectInjected } from '../src/client/PermissionSelect.tsx'
import { apply, inject } from '../src/client/index.ts'
import { PERMISSION_CLIENT_SETTINGS_NAMESPACE } from '../src/client/acknowledgement.ts'
import { accessEn, accessZh } from '../src/client/locales.ts'
import { PERMISSION_OPTIONS_GLOBAL } from '../src/permission-options.ts'

const sid = (k: string): SessionId => k as SessionId

const CATALOG: PermissionCatalog = {
  defaultPreset: 'read-only', defaultOptions: [{ value: 'read-only', name: 'read-only' }, { value: 'workspace-write', name: 'workspace-write' }, { value: 'danger-full-access', name: 'danger-full-access' }],
  options: [
    { value: 'read-only', name: 'read-only', description: 'Reads only.' },
    { value: 'workspace-write', name: 'workspace-write' },
    { value: 'danger-full-access', name: 'danger-full-access' },
    {
      value: 'auto',
      name: 'Auto review',
      description: 'Run without a sandbox after an experimental same-model review of every native tool call and PTC inner call.',
    },
  ],
}

async function bench(options: { options?: Record<string, unknown> } = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry)
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('en')
  ctx.provide('locale', locale)
  const mock = RemoteMock.create().load(remoteDefaultResponses)
  // An accepted acknowledgement write answers with a document naming this
  // package's namespace; the answer reaches the shared settings mirror, so a
  // later surface reads the stored value here.
  const acknowledgedWrites: unknown[][] = []
  mock.remote.settings.mutate.mockImplementation((ns: string, ops: unknown) => {
    acknowledgedWrites.push([ns, ops])
    return Promise.resolve(ok({
      ns: PERMISSION_CLIENT_SETTINGS_NAMESPACE,
      schema: { uid: 1, refs: {} },
      value: { fullAccessAcknowledged: true },
      autoGenerate: true,
      applies: 'live' as const,
      secrets: [],
      revision: 1,
    }))
  })
  onTestFinished(() => { mock.assertNoUnmatched() })
  let catalog = CATALOG
  let catalogCalls = 0
  let catalogFailure: string | undefined
  const permissionPresets = {
    catalog: () => {
      catalogCalls += 1
      if (catalogFailure !== undefined) {
        return Promise.resolve({
          ok: false as const,
          error: { code: 'gateway/internal', message: catalogFailure },
        })
      }
      return Promise.resolve({ ok: true as const, value: catalog })
    },
  }
  const remote = new TestRemote(ctx, { settings: mock.remote.settings, permissionPresets })
  ctx.provide('connection', {
    generation: {
      getSnapshot: () => ({ id: 1, host: { home: '/host', isLoopback: true } }),
      subscribe: () => () => {},
    },
  } as never)
  ctx.slots.register({
    name: 'root',
    children: {
      'settings.general.item': { kind: 'list', scope: 'root' },
      'conversation.input.permission': { kind: 'single', scope: 'session' },
    },
  } as never, () => null)
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  let decoration: CommandDecoration | undefined
  const dismissed: string[] = []
  // The production dismissal path drives this controller; the plugin's own
  // contract only reaches it through `commandUi.dismiss`.
  const shell = new PopupSelectController<{ sessionId: SessionId }>({
    consume: () => true,
    focusComposer: () => {},
  })
  ctx.provide('commandUi', {
    decorate(c: CommandDecoration) {
      decoration = c
      return () => { decoration = undefined }
    },
    dismiss(name: string) {
      dismissed.push(name)
      if (shell.state.getSnapshot().command === name) shell.dismiss()
    },
  })
  const values = new Map<SessionId, PermissionSelection>()
  const commands: string[] = []
  const staged: { sessionId: SessionId; preset: string }[] = []
  let stagedResult: { ok: boolean } = { ok: true }
  let commandResult: { ok: boolean; matched?: boolean } = { ok: true, matched: true }
  const session = (id: SessionId) => ({
    projections: {
      faceOf: (key: string) => ({
        getSnapshot: () => (key === 'permissions' ? values.get(id) : undefined),
        subscribe: () => () => {},
      }),
    },
    command: (line: string) => {
      commands.push(line)
      return Promise.resolve(commandResult.ok
        ? { ok: true as const, value: { matched: commandResult.matched ?? true } }
        : { ok: false as const, error: { code: 'gateway/internal', message: 'boom' } })
    },
  })
  let deferredActivation = false
  // The agent preset each Session reports; a configured one may own the
  // permission mechanism itself.
  const agentPresets = new Map<SessionId, string>()
  ctx.provide('sessions', {
    get deferredActivation() { return deferredActivation },
    binding: (id: SessionId) => (values.has(id) ? { sessionId: id, session: session(id) } : undefined),
    list: {
      getSnapshot: () => ({
        byId: Object.fromEntries([...values.keys()].map(id => [
          id,
          { id, projectionValues: agentPresets.has(id) ? { agentPreset: agentPresets.get(id) } : {} },
        ])),
      }),
      subscribe: () => () => {},
    },
  })
  Object.assign(remote, {
    session: {
      selectPermission: (request: { sessionId: SessionId; preset: string }) => {
        staged.push(request)
        return Promise.resolve(stagedResult.ok
          ? { ok: true as const, value: { accepted: true as const } }
          : { ok: false as const, error: { code: 'gateway/internal', message: 'deferred refusal' } })
      },
    },
  })
  // The Host publishes its configuration as one page-global before activation.
  if (options.options === undefined) vi.unstubAllGlobals()
  else vi.stubGlobal(PERMISSION_OPTIONS_GLOBAL, options.options)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  await vi.waitFor(() => { expect(catalogCalls).toBe(1) })
  return {
    ctx, fiber, acknowledgedWrites, locale, values, commands, remote, dismissed, staged,
    setDeferredActivation: (value: boolean) => { deferredActivation = value },
    setStagedResult: (value: { ok: boolean }) => { stagedResult = value },
    setAgentPreset: (preset: string | undefined) => {
      if (preset === undefined) agentPresets.delete(sid('s1'))
      else agentPresets.set(sid('s1'), preset)
    },
    catalogCalls: () => catalogCalls,
    setCatalog: (value: PermissionCatalog) => {
      catalog = value
      remote.emit('permission-presets/catalog-changed', [])
    },
    setCatalogFailure: (message: string | undefined) => { catalogFailure = message },
    setResult: (r: { ok: boolean; matched?: boolean }) => { commandResult = r },
    decoration: () => decoration,
    shell: () => shell,
    openShell: (): PopupSelectController<{ sessionId: SessionId }> => {
      const ui = decoration!.ui
      if (ui.kind !== 'popupSelect') throw new Error('expected the popupSelect kind')
      shell.open('permission', ui, { sessionId: sid('s1') }, { via: 'enter', token: '/permission' })
      return shell
    },
    popup: (): PopupSelectSpec => {
      const ui = decoration!.ui
      if (ui.kind !== 'popupSelect') throw new Error('expected the popupSelect kind')
      return ui
    },
    permissionRow: () => ctx.slots.entries('settings.general.item')
      .find(entry => entry.component === PermissionRow),
    permissionSelect: () => ctx.slots.entries('conversation.input.permission')
      .find(entry => entry.component === PermissionSelect),
  }
}

/** Read one registered entry's inject factory under the face the registration declares. */
type InjectFactory<T> = (sessionId: SessionId) => T

function slotInjected<T>(entry: StoredEntry | undefined): InjectFactory<T> {
  if (entry === undefined) throw new Error('expected the component entry to be registered')
  return entry.inject as InjectFactory<T>
}

describe('ui-permission browser plugin', () => {
  it('dismisses stale slash choices on a catalog invalidation and removes that subscription on disposal', async () => {
    const b = await bench()
    const initial = b.dismissed.length
    b.setCatalog({ ...CATALOG, options: CATALOG.options.filter(option => option.value !== 'auto') })
    await vi.waitFor(() => { expect(b.dismissed.slice(initial)).toEqual(['permission']) })
    await b.fiber.dispose()
    b.setCatalog(CATALOG)
    await Promise.resolve()
    expect(b.dismissed.slice(initial)).toEqual(['permission'])
  })

  it('hangs the /permission popup decoration on the host command', async () => {
    const b = await bench()
    const c = b.decoration()!
    expect(c.name).toBe('permission')
    expect(c.ui.kind).toBe('popupSelect')
    const row = b.permissionRow()!
    expect(row.options).toEqual({ id: 'permission', order: -20 })
    const injected = row.inject?.() as PermissionRowInjected | undefined
    expect(injected?.hooks.permission).toBeDefined()
    expect(typeof injected?.load).toBe('function')
    expect(typeof injected?.select).toBe('function')
    await injected!.load()
    await injected!.select('read-only')
    const select = b.permissionSelect()!
    const injectSelect = select.inject as unknown as (sessionId: SessionId) => PermissionSelectInjected
    b.values.set(sid('s1'), { currentValue: 'workspace-write' })
    const selectInjected = injectSelect(sid('s1'))
    expect(selectInjected?.hooks.permissionCatalog.getSnapshot().value).toEqual(CATALOG)
    await expect(selectInjected.select('auto')).resolves.toBe(true)
    expect(b.commands).toEqual(['/permission auto'])
    expect(b.catalogCalls()).toBe(1)
  })

  it('hands the surfaces the page configuration and one shared confirmation mirror', async () => {
    const b = await bench({
      options: { colors: { 'read-only': 'var(--brand-accent)' }, rememberFullAccess: true },
    })
    const row = slotInjected<PermissionRowInjected>(b.permissionRow())(sid('s1'))
    const seat = slotInjected<PermissionSelectInjected>(b.permissionSelect())(sid('s1'))
    expect(seat.colors).toEqual({ 'read-only': 'var(--brand-accent)' })
    expect(row.fullAccessRemembered).toBe(true)
    expect(seat.fullAccessRemembered).toBe(true)
    // One mirror feeds every surface: a confirmation recorded on either one
    // is what the other reads next.
    expect(row.hooks.fullAccessAcknowledged).toBe(seat.hooks.fullAccessAcknowledged)

    seat.acknowledgeFullAccess()
    expect(seat.hooks.fullAccessAcknowledged.getSnapshot()).toBe(true)
    const proj = { sessionId: sid('s1') }
    b.values.set(sid('s1'), { currentValue: 'workspace-write' })
    const options = await b.popup().options(proj, new AbortController().signal)
    expect(options.find(option => option.id === 'danger-full-access')?.confirmation).toBeUndefined()
  })

  it('keeps the colours empty and the confirmation mandatory under the declared defaults', async () => {
    const b = await bench()
    const seat = slotInjected<PermissionSelectInjected>(b.permissionSelect())(sid('s1'))
    expect(seat.colors).toEqual({})
    expect(seat.fullAccessRemembered).toBe(false)
    const proj = { sessionId: sid('s1') }
    b.values.set(sid('s1'), { currentValue: 'workspace-write' })
    const options = await b.popup().options(proj, new AbortController().signal)
    expect(options.find(option => option.id === 'danger-full-access')?.confirmation).toBeDefined()
  })

  it('stops asking for Full access once the answer is recorded and remembered', async () => {
    const b = await bench({ options: { rememberFullAccess: true } })
    const proj = { sessionId: sid('s1') }
    b.values.set(sid('s1'), { currentValue: 'workspace-write' })
    const seat = slotInjected<PermissionSelectInjected>(b.permissionSelect())(sid('s1'))

    seat.acknowledgeFullAccess()
    const options = await b.popup().options(proj, new AbortController().signal)
    expect(options.find(option => option.id === 'danger-full-access')?.confirmation).toBeUndefined()
    // Auto review keeps asking every time.
    expect(options.find(option => option.id === 'auto')?.confirmation).toBeDefined()

    // Picking Full access through the slash picker records the answer too.
    const fresh = await bench({ options: { rememberFullAccess: true } })
    fresh.values.set(sid('s1'), { currentValue: 'workspace-write' })
    await fresh.popup().onSelect({ id: 'danger-full-access', label: 'Full access' }, proj)
    const after = await fresh.popup().options(proj, new AbortController().signal)
    expect(after.find(option => option.id === 'danger-full-access')?.confirmation).toBeUndefined()
    // An ordinary pick records nothing.
    const ordinary = await bench({ options: { rememberFullAccess: true } })
    ordinary.values.set(sid('s1'), { currentValue: 'workspace-write' })
    await ordinary.popup().onSelect({ id: 'read-only', label: 'Read only' }, proj)
    expect(ordinary.acknowledgedWrites).toEqual([])
  })

  it('hides the local controls of a Session whose agent preset manages its own permissions', async () => {
    const b = await bench({ options: { hiddenAgentPresets: ['remote-review'] } })
    const c = b.decoration()!
    b.setAgentPreset('remote-review')
    expect(c.available({ sessionId: sid('s1') })).toBe(false)

    b.values.set(sid('s1'), { currentValue: 'workspace-write' })
    expect(c.available({ sessionId: sid('s1') })).toBe(false)

    // Exact matches only, and a Session without the projection keeps its controls.
    b.setAgentPreset('remote-review-extra')
    expect(c.available({ sessionId: sid('s1') })).toBe(true)
    b.setAgentPreset(undefined)
    expect(c.available({ sessionId: sid('s1') })).toBe(true)
  })

  it('availability follows the session projection; options mark the current value active', async () => {
    const b = await bench()
    const c = b.decoration()!
    const proj = { sessionId: sid('s1') }
    expect(c.available(proj)).toBe(false)
    b.values.set(sid('s1'), { currentValue: 'custom' })
    expect(c.available(proj)).toBe(true)
    const options = await b.popup().options(proj, new AbortController().signal)
    expect(options.map(option => option.id)).toEqual(['read-only', 'workspace-write', 'danger-full-access', 'auto'])
    expect(options.every(option => option.active !== true)).toBe(true)
    b.values.set(sid('s1'), { currentValue: 'workspace-write' })
    const again = await b.popup().options(proj, new AbortController().signal)
    expect(again.find(option => option.id === 'workspace-write')?.active).toBe(true)
    expect(again.find(option => option.id === 'read-only')?.detail).toBe('Reads only.')
    expect(again.find(option => option.id === 'auto')?.detail)
      .toBe('Run without a sandbox after an experimental same-model review of every native tool call and PTC inner call.')
    // English built-ins use product labels; other kebab-case names title-case.
    expect(again.map(option => option.label)).toEqual(['Read Only', 'Workspace Write', 'Full access', 'Auto review'])
    expect(again.find(option => option.id === 'danger-full-access')?.confirmation).toEqual({
      title: 'Enable Full access?',
      description: accessEn['confirm.description'],
      acknowledgeLabel: 'I understand the risks and want to continue',
      cancelLabel: 'Cancel',
      confirmLabel: 'Enable Full access',
    })
    expect(again.find(option => option.id === 'auto')).toMatchObject({
      badge: 'EXP',
      confirmation: {
        title: 'Enable Auto review (experimental)?',
        description: accessEn['auto.confirm.description'],
        acknowledgeLabel: 'I understand these risks and want to continue',
        cancelLabel: 'Cancel',
        confirmLabel: 'Enable Auto review',
      },
    })
    b.locale.setLocale('zh')
    const localized = await b.popup().options(proj, new AbortController().signal)
    expect(localized.map(option => option.label)).toEqual(['仅可查看', '工作区内修改', '完全权限', '自动审查'])
    expect(localized.find(option => option.id === 'danger-full-access')?.confirmation).toEqual({
      title: '确认启用完全权限？',
      description: accessZh['confirm.description'],
      acknowledgeLabel: '我已了解风险，并愿意继续',
      cancelLabel: '取消',
      confirmLabel: '启用完全权限',
    })
    b.setCatalog({ ...CATALOG, options: [
      { value: 'workspace-write', name: 'Project Files' },
      { value: 'danger-full-access', name: 'Operator Mode' },
      { value: 'custom-mode', name: 'custom-mode' },
      { value: '__proto__', name: '__proto__' },
      { value: 'plain', name: 'Ask Every Time' },
    ] })
    let passthrough = await b.popup().options(proj, new AbortController().signal)
    await vi.waitFor(async () => {
      passthrough = await b.popup().options(proj, new AbortController().signal)
      expect(passthrough.map(option => option.label)).toHaveLength(5)
    })
    expect(passthrough.map(option => option.label)).toEqual([
      'Project Files', 'Operator Mode', 'Custom Mode', '__proto__', 'Ask Every Time',
    ])
    // A projection that vanished between availability and open throws.
    await expect(b.popup().options({ sessionId: sid('ghost') }, new AbortController().signal))
      .rejects.toThrow(/not available on this host/)
  })

  it('keeps the picker available after a failed catalog read and recovers on the next open', async () => {
    const b = await bench()
    const c = b.decoration()!
    const proj = { sessionId: sid('s1') }
    b.values.set(sid('s1'), { currentValue: 'workspace-write' })
    b.setCatalogFailure('catalog read failed')
    b.setCatalog(CATALOG)

    await expect(b.popup().options(proj, new AbortController().signal))
      .rejects.toThrow('catalog read failed')
    // The failed read clears the catalog. The command stays available so the
    // picker keeps its own retry entry, and a later open re-reads the catalog.
    expect(c.available(proj)).toBe(true)

    b.setCatalogFailure(undefined)
    const recovered = await b.popup().options(proj, new AbortController().signal)
    expect(recovered.map(option => option.id))
      .toEqual(['read-only', 'workspace-write', 'danger-full-access', 'auto'])
  })

  it('keeps the open picker and its retry through the real popup shell after a failed read', async () => {
    const b = await bench()
    b.values.set(sid('s1'), { currentValue: 'workspace-write' })
    b.setCatalogFailure('catalog read failed')
    b.setCatalog(CATALOG)

    const shell = b.openShell()
    await vi.waitFor(() => { expect(shell.state.getSnapshot().status).toBe('failed') })
    const failed = shell.state.getSnapshot()
    expect(failed.open).toBe(true)
    expect(failed.error).toBe('gateway/internal: catalog read failed')

    b.setCatalogFailure(undefined)
    shell.retry()
    await vi.waitFor(() => { expect(shell.state.getSnapshot().status).toBe('ready') })
    expect(shell.state.getSnapshot().options.map(option => option.id))
      .toEqual(['read-only', 'workspace-write', 'danger-full-access', 'auto'])
  })

  it('closes an open picker only when the catalog is invalidated', async () => {
    const b = await bench()
    b.values.set(sid('s1'), { currentValue: 'workspace-write' })
    const shell = b.openShell()
    await vi.waitFor(() => { expect(shell.state.getSnapshot().status).toBe('ready') })

    b.setCatalog({ ...CATALOG, options: CATALOG.options.filter(option => option.value !== 'auto') })
    await vi.waitFor(() => { expect(shell.state.getSnapshot().open).toBe(false) })
  })

  it('localizes the Auto description instead of displaying host English copy', async () => {
    const b = await bench()
    b.ctx.locale.setLocale('zh')
    const proj = { sessionId: sid('s1') }
    b.values.set(sid('s1'), { currentValue: 'workspace-write' })
    const options = await b.popup().options(proj, new AbortController().signal)
    expect(options.find(option => option.id === 'auto')?.detail)
      .toBe('无沙箱运行；每次原生工具调用和 PTC 内层调用前由同一模型进行实验性审查。')
  })

  it('a pick submits the /permission line; rejection and unmatched throw', async () => {
    const b = await bench()
    const proj = { sessionId: sid('s1') }
    b.values.set(sid('s1'), { currentValue: 'workspace-write' })
    await b.popup().onSelect({ id: 'danger-full-access', label: 'danger-full-access' }, proj)
    expect(b.commands).toEqual(['/permission danger-full-access'])
    b.setResult({ ok: false })
    await expect(b.popup().onSelect({ id: 'read-only', label: 'read-only' }, proj)).rejects.toThrow(/permission switch failed/)
    b.setResult({ ok: true, matched: false })
    await expect(b.popup().onSelect({ id: 'read-only', label: 'read-only' }, proj)).rejects.toThrow(/no \/permission command/)
    // An unmaterialized session throws before any submit.
    await expect(b.popup().onSelect({ id: 'read-only', label: 'read-only' }, { sessionId: sid('ghost') }))
      .rejects.toThrow(/not materialized/)
  })

  it('a deferred Host saves the pick through selectPermission instead of running /permission', async () => {
    const b = await bench()
    b.values.set(sid('s1'), { currentValue: 'workspace-write' })
    const select = (b.permissionSelect()!.inject as (...args: never[]) => PermissionSelectInjected)(sid('s1'))

    // Eager Hosts run the Agent command; the deferred branch must not start one.
    await expect(select.select('read-only')).resolves.toBe(true)
    expect(b.commands).toEqual(['/permission read-only'])
    expect(b.staged).toEqual([])

    b.setDeferredActivation(true)
    await expect(select.select('auto')).resolves.toBe(true)
    expect(b.staged).toEqual([{ sessionId: sid('s1'), preset: 'auto' }])
    expect(b.commands).toEqual(['/permission read-only'])

    b.setStagedResult({ ok: false })
    await expect(select.select('auto')).rejects.toThrow('permission switch failed: gateway/internal: deferred refusal')
  })

  it('disposal removes the decoration (HMR safety)', async () => {
    const b = await bench()
    expect(b.decoration()).toBeDefined()
    b.remote.emit('settings/document-updated', ['another', 1])
    b.remote.emit('settings/document-updated', ['permission', 1])
    await b.fiber.dispose()
    expect(b.decoration()).toBeUndefined()
    expect(b.permissionRow()).toBeUndefined()
    expect(b.permissionSelect()).toBeUndefined()
  })
})
