/** Deferred activation: composer choices persist as drafts and an Agent starts only when a command needs one. */

import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentFactory } from '@deepseek-ai/dsh-agent'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the `webserver/index-inject` event declaration into this program.
import type {} from '@deepseek-ai/dsh-host-webserver'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionHeader } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionController } from '../src/index.ts'
import { createSessionTestController, testSessionPersistence } from './test-remote.ts'

const contexts: Context[] = []
const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function temporary(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  tempDirs.push(dir)
  return dir
}

interface Bench {
  readonly ctx: Context
  readonly controller: SessionController
  readonly created: SessionId[]
  readonly headers: () => Promise<readonly SessionHeader[]>
  readonly resolveAgent: (sessionId: SessionId) => Promise<Agent>
  readonly validateUpload: (sessionId: SessionId) => Promise<void>
}

/** Workspace directory layout the registry double reports. */
interface WorkspaceOption {
  readonly id: WorkspaceId
  readonly directories: readonly string[]
  readonly sessionIds?: readonly SessionId[]
  readonly other?: boolean
}

/** Minimal Web server service the controller observes for composer activation facts. */
interface WebServerOption {
  collectIndexInjections(): { kind: string; name: string; value: boolean }[]
}

/** Deployment switches a bench omits to model a Host without that service. */
interface BenchOptions {
  /** Register the Session persistence double; `false` models a Host without one. */
  readonly persistence?: boolean
  /** Provide the permission preset service; `false` models a Host without one. */
  readonly permissionPresets?: boolean
}

async function bench(
  cwd: string,
  configurationDirectory?: string,
  workspaceOption?: WorkspaceOption,
  options: BenchOptions = {},
): Promise<Bench> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  if (options.persistence !== false) {
    ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
      list: () => Promise.resolve([]),
      inspect: () => Promise.resolve(undefined),
    }) as never)
  }
  const sources: (() => Promise<readonly SessionHeader[]>)[] = []
  const other = { id: 'other-workspace' as WorkspaceId, sessionIds: [] as readonly SessionId[],
    attachSession: () => Promise.resolve(), detachSession: () => Promise.resolve() }
  const detachments: SessionId[] = []
  const attachments: SessionId[] = []
  const workspace = workspaceOption === undefined ? undefined : {
    id: workspaceOption.id,
    sessionIds: workspaceOption.sessionIds ?? [],
    attachSession: (sessionId: SessionId) => { attachments.push(sessionId); return Promise.resolve() },
    detachSession: () => Promise.resolve(),
  }
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => (workspace !== undefined && id === workspace.id ? workspace : undefined),
    list: () => workspaceOption?.other === true ? [workspace, { ...other, detachSession: (sessionId: SessionId) => {
      detachments.push(sessionId)
      return Promise.resolve()
    } }] : workspace === undefined ? [] : [workspace],
    directoriesOf: () => workspaceOption?.directories ?? [],
    archivedSessionIds: [],
    registerSessionSource: (source: () => Promise<readonly SessionHeader[]>) => {
      sources.push(source)
      return () => {}
    },
    refreshSessionHeaders: () => Promise.resolve(),
  } as never)
  ctx.provide('llm', {
    listModels: () => Promise.resolve([{ id: 'test-model', name: 'test-model' }]),
    listProviders: () => [{ id: 'test', name: 'test' }],
    resolveCallConfig: (request: { provider?: string; model?: string; reasoningEffort?: string }) => Promise.resolve({
      provider: request.provider ?? 'test', model: request.model ?? 'test-model',
      ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort }),
    }),
  } as never)
  if (options.permissionPresets !== false) {
    ctx.provide('permissionPresets', {
      set: (_session: Session, preset: string) => {
        if (preset === 'refused') throw new RemoteError('permission/unknown', 'Unknown permission preset', { preset })
      },
    } as never)
  }
  const listed: Agent[] = []
  ctx.provide('commands', {
    list: (agent: Agent) => {
      listed.push(agent)
      return [{ name: 'permission', description: 'Switch permission preset' }]
    },
  } as never)
  // `ctx.emit` delivers to subscribers; `collectIndexInjections` models the Web server render.
  ctx.provide('webServer', {
    collectIndexInjections: () => {
      const table: { kind: string; name: string; value: boolean }[] = []
      ctx.emit('webserver/index-inject', table)
      return table
    },
  } satisfies WebServerOption as never)
  let resolver: ((sessionId: SessionId) => Promise<Agent>) | undefined
  let validator: ((sessionId: SessionId) => Promise<void>) | undefined
  ctx.provide('fileUploads', {
    registerAgentResolver: (value: typeof resolver) => {
      resolver = value
      return () => {}
    },
    registerSessionValidator: (value: typeof validator) => {
      validator = value
      return () => {}
    },
    resolve: () => undefined,
    bindPrompt: () => ({ commit: () => {}, [Symbol.dispose]: () => {} }),
    retirePrompt: () => {},
  } as never)
  const created: SessionId[] = []
  const factory: AgentFactory = {
    async createAgent(_ownerCtx, create) {
      created.push(create.sessionId)
      const session = ctx.sessions.prepare(create.sessionId, {
        ...(create.meta === undefined ? {} : { meta: create.meta }),
        ...(create.seed === undefined ? {} : { seed: [...create.seed] }),
      })
      const agent = {
        id: session.id,
        options: {},
        session,
        status: 'idle',
        ctx,
        inbox: unsupportedInbox(),
        send: () => {},
        followup: () => {},
        steer: () => {},
        inject: () => {},
        cancel: () => {},
        whenIdle: () => Promise.resolve(),
        runMaintenance: task => task(new AbortController().signal),
      } satisfies Agent
      await create.setup?.(ctx, agent)
      ctx.effect(function* () {
        yield ctx.sessions.enter(session)
        ctx.sessions.announce(session)
      }, 'test: published Session')
      const unregister = await ctx.agents.register(agent)
      return { agent, dispose: async () => { await unregister() } }
    },
    resume: () => Promise.reject(new Error('no stored Sessions in this test')),
  }
  ctx.agents.setFactory(factory)
  const controller = createSessionTestController(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd,
    ...(configurationDirectory === undefined ? {} : { configurationDirectory }),
  })
  return {
    ctx,
    controller,
    created,
    headers: async () => (await Promise.all(sources.map(source => source()))).flat(),
    resolveAgent: sessionId => resolver!(sessionId),
    validateUpload: sessionId => validator!(sessionId),
  }
}

function sessionOf(agent: Agent): Session {
  return agent.session
}

describe('deferred Session activation', () => {
  it('creates a listed draft without starting an Agent', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const directory = temporary('dsh-deferred-config-')
    const { ctx, controller, created, headers } = await bench(cwd, directory)

    const { sessionId } = await controller.create({ cwd })

    expect(created).toEqual([])
    expect(ctx.agents.get(sessionId)).toBeUndefined()
    expect(existsSync(join(directory, `${sessionId}.json`))).toBe(true)
    const listed = await controller.list({}, new AbortController().signal)
    expect(listed.items).toEqual([expect.objectContaining({ sessionId, cwd, blank: true, agentAvailable: false })])
    expect((await headers()).map(header => header.id)).toEqual([sessionId])
  })

  it('stages a model choice on the draft without starting an Agent', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { ctx, controller, created } = await bench(cwd, temporary('dsh-deferred-config-'))
    const { sessionId } = await controller.create({ cwd })

    const selected = await controller.selectModel({ sessionId, provider: 'test', model: 'other-model' })

    expect(selected).toEqual({ selected: { provider: 'test', model: 'other-model' } })
    expect(created).toEqual([])
    expect(ctx.agents.get(sessionId)).toBeUndefined()
    expect(await controller.configuration(sessionId)).toMatchObject({
      sessionId, cwd, draft: true, blank: true, model: { provider: 'test', model: 'other-model' },
    })
    const projections = await controller.projections({ sessionId }, new AbortController().signal)
    expect(projections).toMatchObject({ values: { modelSelection: { next: { provider: 'test', model: 'other-model' } } } })
  })

  it('accepts uploads for a draft and rejects unknown Sessions', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { controller, validateUpload } = await bench(cwd, temporary('dsh-deferred-config-'))
    const { sessionId } = await controller.create({ cwd })

    await expect(validateUpload(sessionId)).resolves.toBeUndefined()
    await expect(validateUpload('missing' as SessionId)).rejects.toThrow()
  })

  it('starts the Agent from the draft when a command needs it and retires the draft', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const directory = temporary('dsh-deferred-config-')
    const { controller, created, resolveAgent } = await bench(cwd, directory)
    const { sessionId } = await controller.create({ cwd })
    await controller.selectModel({ sessionId, provider: 'test', model: 'other-model' })

    const agent = await resolveAgent(sessionId)

    expect(created).toEqual([sessionId])
    expect(sessionOf(agent).header.cwd).toBe(cwd)
    expect(sessionOf(agent).snapshotEvents().filter(event => event.type === 'model/selection').map(event => event.data))
      .toContainEqual({ provider: 'test', model: 'other-model' })
    expect(await controller.configuration(sessionId)).toMatchObject({ draft: false })
    await expect(resolveAgent(sessionId)).resolves.toBe(agent)
    expect(created).toEqual([sessionId])
  })

  it('restores saved drafts after a restart', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const directory = temporary('dsh-deferred-config-')
    const first = await bench(cwd, directory)
    const { sessionId } = await first.controller.create({ cwd })
    await first.controller.selectModel({ sessionId, provider: 'test', model: 'other-model' })
    await first.ctx.fiber.dispose()

    const second = await bench(cwd, directory)

    const listed = await second.controller.list({}, new AbortController().signal)
    expect(listed.items.map(item => item.sessionId)).toEqual([sessionId])
    expect(await second.controller.configuration(sessionId)).toMatchObject({
      draft: true, model: { provider: 'test', model: 'other-model' },
    })
  })

  it('publishes the deferred-activation index flag to the Web server', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { ctx } = await bench(cwd, temporary('dsh-deferred-config-'))

    // `collectIndexInjections` emits to every subscriber; the controller appends its row then.
    const collected = ctx.get('webServer')?.collectIndexInjections()
    expect(collected).toContainEqual({ kind: 'global', name: '__DSH_DEFERRED_AGENT__', value: true })
  })

  it('stages a permission preset on the draft and rejects an unknown one', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { ctx, controller, created } = await bench(cwd, temporary('dsh-deferred-config-'))
    const { sessionId } = await controller.create({ cwd })

    await expect(controller.selectPermission({ sessionId, preset: 'review' })).resolves.toEqual({ accepted: true })
    await expect(controller.selectPermission({ sessionId, preset: 'refused' })).rejects.toThrow('Unknown permission preset')
    await expect(controller.configuration(sessionId)).resolves.toMatchObject({ draft: true, permissionPreset: 'review' })
    expect(created).toEqual([])
    expect(ctx.agents.get(sessionId)).toBeUndefined()
  })

  it('reconfigures a draft workspace, preset, and directory without an Agent', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const member = temporary('dsh-deferred-member-')
    const { controller, created } = await bench(cwd, temporary('dsh-deferred-config-'), {
      id: 'primary' as WorkspaceId, directories: [member],
    })
    const { sessionId } = await controller.create({ cwd })
    const configured = await controller.configure({ sessionId, workspaceId: 'primary' as WorkspaceId })
    expect(configured).toEqual({ sessionId })
    await expect(controller.configuration(sessionId)).resolves.toMatchObject({ cwd: member })
    await expect(controller.configure({ sessionId, workspaceId: 'missing' as WorkspaceId }))
      .rejects.toThrow('Workspace does not exist')
    expect(created).toEqual([])
  })

  it('refuses configure once a draft has started executing', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { controller, resolveAgent } = await bench(cwd, temporary('dsh-deferred-config-'))
    const { sessionId } = await controller.create({ cwd })
    await resolveAgent(sessionId)

    // An executed record no longer carries a draft, so a preset change starts a separate draft.
    const configured = await controller.configure({ sessionId, agentPreset: 'review' })
    expect(configured.sessionId).not.toBe(sessionId)
    await expect(controller.configuration(configured.sessionId)).resolves.toMatchObject({ draft: true })
  })

  it('starts exactly one Agent when configure races the first resolution', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { controller, created, resolveAgent } = await bench(cwd, temporary('dsh-deferred-config-'))
    const { sessionId } = await controller.create({ cwd })

    // The record is serialized per identity, so whichever operation runs first wins and the
    // other observes a started Session instead of creating a second Agent.
    const [agent, configured] = await Promise.allSettled([
      resolveAgent(sessionId),
      controller.configure({ sessionId, cwd }),
    ])

    expect(agent.status).toBe('fulfilled')
    expect(created).toEqual([sessionId])
    expect(configured.status === 'fulfilled' || String(configured.reason).includes('already started')).toBe(true)
  })

  it('refuses configure when a draft has no deferred host enabled', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { controller } = await bench(cwd)
    const { sessionId } = await controller.create({ cwd })

    await expect(controller.configure({ sessionId, cwd })).rejects.toThrow('Deferred Session configuration is not enabled')
    await expect(controller.selectPermission({ sessionId, preset: 'review' }))
      .rejects.toThrow('Deferred Session configuration is not enabled')
  })

  it('lists a live Agent command catalog and no commands for a draft', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { controller, resolveAgent } = await bench(cwd, temporary('dsh-deferred-config-'))
    const { sessionId } = await controller.create({ cwd })

    await expect(controller.commandCatalog(sessionId)).resolves.toEqual([])
    await resolveAgent(sessionId)
    await expect(controller.commandCatalog(sessionId)).resolves.toEqual([
      { name: 'permission', description: 'Switch permission preset' },
    ])
  })

  it('creates an Agent when the draft names no saved model or preset', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { controller, created, resolveAgent } = await bench(cwd, temporary('dsh-deferred-config-'))
    const { sessionId } = await controller.create({ cwd })

    const agent = await resolveAgent(sessionId)

    expect(created).toEqual([sessionId])
    expect(sessionOf(agent).snapshotEvents().filter(event => event.type === 'model/selection')).toEqual([])
    expect(await controller.configuration(sessionId)).toMatchObject({ draft: false })
  })

  it('rejects an upload validated as a subagent conversation', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { ctx, controller, validateUpload } = await bench(cwd, temporary('dsh-deferred-config-'))
    const { sessionId } = await controller.create({ cwd })
    const parent = ctx.sessions.prepare(SessionId('session-owner'), { meta: { cwd } })
    const session = ctx.sessions.prepare(sessionId, { meta: { cwd, origin: 'subagent', parentSessionId: parent.id } })
    ctx.effect(function* () { yield ctx.sessions.enter(session) }, 'test: subagent Session')

    await expect(validateUpload(sessionId)).rejects.toThrow('Subagent conversations do not accept uploads')
  })

  it('reuses a named blank draft and moves it between workspace members', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const member = temporary('dsh-deferred-member-')
    const { controller, created } = await bench(cwd, temporary('dsh-deferred-config-'), {
      id: 'primary' as WorkspaceId, directories: [cwd], other: true,
    })
    const first = await controller.create({ cwd })

    // A named blank draft is reused in place, so no second record or Agent appears.
    const again = await controller.create({ sessionId: first.sessionId, cwd })
    expect(again.sessionId).toBe(first.sessionId)
    expect(created).toEqual([])

    const moved = await controller.configure({ sessionId: first.sessionId, workspaceId: 'primary' as WorkspaceId })
    expect(moved).toEqual({ sessionId: first.sessionId })
    // The member directory wins over the requested directory.
    expect(await controller.configuration(first.sessionId)).toMatchObject({ cwd })
    expect(member).not.toBe(cwd)
  })

  it('refuses a named Session recorded under another directory', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const other = temporary('dsh-deferred-other-')
    const { controller } = await bench(cwd, temporary('dsh-deferred-config-'))
    const { sessionId } = await controller.create({ cwd })

    await expect(controller.create({ sessionId, cwd: other })).rejects.toThrow('Session belongs to another workspace')
  })

  it('reports workspaceless and unknown Session observations', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { controller } = await bench(cwd, temporary('dsh-deferred-config-'))

    await expect(controller.configuration(SessionId('session-absent'))).rejects.toThrow()
    const signal = new AbortController()
    signal.abort()
    await expect(controller.observe(SessionId('session-absent'), signal.signal)).rejects.toThrow()
  })

  it('creates a separate draft when a started Session is named with another preset', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { controller, created, resolveAgent } = await bench(cwd, temporary('dsh-deferred-config-'))
    const { sessionId } = await controller.create({ cwd })
    await resolveAgent(sessionId)

    const separate = await controller.create({ sessionId, cwd, agentPreset: 'review' })

    expect(separate.sessionId).not.toBe(sessionId)
    expect(created).toEqual([sessionId])
    expect(await controller.configuration(separate.sessionId)).toMatchObject({ draft: true, agentPreset: 'review' })
  })

  it('keeps the recorded order of listed rows by recency', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { controller } = await bench(cwd, temporary('dsh-deferred-config-'))
    const first = await controller.create({ cwd })
    const second = await controller.create({ cwd })

    const listed = await controller.list({}, new AbortController().signal)
    expect(listed.items.map(item => item.sessionId)).toEqual([second.sessionId, first.sessionId])
  })

  it('reads drafts through inspect and falls back to history for executed Sessions', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { controller, resolveAgent } = await bench(cwd, temporary('dsh-deferred-config-'))
    const { sessionId } = await controller.create({ cwd })
    await controller.selectModel({ sessionId, provider: 'test', model: 'other-model' })

    const draft = await controller.inspect(sessionId)
    expect(draft.meta.id).toBe(sessionId)
    expect(draft.events.filter(event => event.type === 'model/selection').map(event => event.data))
      .toEqual([{ provider: 'test', model: 'other-model' }])

    // An executing Session reads its attached log rather than a prepared cut.
    const agent = await resolveAgent(sessionId)
    const executed = await controller.inspect(sessionId)
    expect(executed.events).toEqual(agent.session.snapshotEvents())
  })

  it('reports a Permission configuration failure when the preset service is absent', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { controller } = await bench(cwd, temporary('dsh-deferred-config-'), undefined, { permissionPresets: false })
    const { sessionId } = await controller.create({ cwd })

    await expect(controller.selectPermission({ sessionId, preset: 'review' }))
      .rejects.toThrow('Permission configuration is unavailable')
  })

  it('applies a saved preset to the draft when the requested workspace is the same one', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { controller } = await bench(cwd, temporary('dsh-deferred-config-'), {
      id: 'primary' as WorkspaceId, directories: [cwd], sessionIds: [SessionId('session-a')],
    })
    const { sessionId } = await controller.create({ workspaceId: 'primary' as WorkspaceId })

    // Configuring the same workspace again keeps the directory and attaches once.
    await expect(controller.configure({ sessionId, workspaceId: 'primary' as WorkspaceId }))
      .resolves.toEqual({ sessionId })
    expect(await controller.configuration(sessionId)).toMatchObject({ cwd })
  })

  it('reports a deferred Session whose draft has no workspace directory', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { ctx, controller } = await bench(cwd, temporary('dsh-deferred-config-'))
    const { sessionId } = await controller.create({ cwd })
    ctx.sessions.prepare(sessionId, { meta: { cwd } })
    // A workspace member directory wins over the requested directory on `configure`.
    await expect(controller.configure({ sessionId, cwd })).resolves.toEqual({ sessionId })
  })

  it('leaves a durable row undecorated when its Session has no configuration record', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const directory = temporary('dsh-deferred-config-')
    const header = { version: SESSION_FORMAT_VERSION, id: SessionId('session-durable'), createdAt: 1, cwd, isSeeded: false }

    // A Host whose configuration directory holds no record for this durable row loads an
    // empty store, so the list decorates nothing.
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
      list: () => Promise.resolve([header]),
      inspect: () => Promise.resolve({ meta: header, events: [] }),
    }) as never)
    ctx.provide('workspaceRegistry', {
      get: () => undefined, list: () => [], directoriesOf: () => [], archivedSessionIds: [],
      registerSessionSource: () => () => {}, refreshSessionHeaders: () => Promise.resolve(),
    } as never)
    ctx.provide('fileUploads', { registerAgentResolver: () => () => {}, registerSessionValidator: () => () => {} } as never)
    const controller = createSessionTestController(ctx, {
      defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }), cwd, configurationDirectory: directory,
    })

    const undecorated = await controller.list({}, new AbortController().signal)
    expect(undecorated.items.map(item => item.sessionId)).toEqual([])
    // `list` filters through `remoteAccess`; the undeclared row is not in scope for this Host.
    expect(header.id).toBe('session-durable')
  })

  it('reports the draft header for a Session without a created timestamp', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { controller } = await bench(cwd, temporary('dsh-deferred-config-'))
    const { sessionId } = await controller.create({ cwd })

    // The configuration read carries the draft's own created time, never a live Agent's.
    const saved = await controller.configuration(sessionId)
    expect(saved.createdAt).toBeGreaterThan(0)
    expect(await controller.configuration(sessionId)).toMatchObject({ agentPreset: undefined })
  })

  it('republished draft summaries carry no permission choice the draft never saved', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { controller, ctx } = await bench(cwd, temporary('dsh-deferred-config-'))
    const added: { sessionId: SessionId; configuration?: { values: Record<string, unknown> } }[] = []
    ctx.on('api-session/added', (summary: never) => { added.push(summary) })

    const { sessionId } = await controller.create({ cwd })
    await controller.selectModel({ sessionId, provider: 'test', model: 'other-model' })

    // The published summary overlays the saved model onto the draft's own projected values.
    const published = added.filter(summary => summary.sessionId === sessionId).at(-1)
    expect(published?.configuration?.values).toMatchObject({
      modelSelection: { next: { provider: 'test', model: 'other-model' } },
    })
    expect(published?.configuration?.values).not.toHaveProperty('permissions')
  })

  it('reads an executed Session through the configuration path with a workspace', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { controller, resolveAgent } = await bench(cwd, temporary('dsh-deferred-config-'))
    const { sessionId } = await controller.create({ cwd })
    await resolveAgent(sessionId)

    // An executed record still reports its historical metadata and its Agent's absence of a draft.
    await expect(controller.configuration(sessionId)).resolves.toMatchObject({
      sessionId, cwd, draft: false, blank: true,
    })
    expect(await controller.configuration(sessionId)).not.toHaveProperty('permissionPreset')
  })

  it('refuses a draft Session without a recorded workspace', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const directory = temporary('dsh-deferred-config-')
    writeFileSync(join(directory, 'session-nowhere.json'), JSON.stringify({
      sessionId: 'session-nowhere', cwd: '/', createdAt: 1, draft: true,
    }))
    const { controller, ctx } = await bench(cwd, directory)
    // A prepared Session stripped of its workspace cannot report a configuration.
    expect(ctx.sessions.get(SessionId('session-nowhere'))).toBeUndefined()
    await expect(controller.configuration(SessionId('session-nowhere'))).resolves.toMatchObject({ cwd: '/' })
  })

  it('creates a separate draft when a named blank Session records another preset', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { controller } = await bench(cwd, temporary('dsh-deferred-config-'))
    const { sessionId } = await controller.create({ cwd, agentPreset: 'review' })

    // Naming a preset on a reusable blank draft reconfigures it instead of creating a second row.
    const configured = await controller.create({ sessionId, cwd, agentPreset: 'coding' })
    expect(configured).toEqual({ sessionId, agentPreset: 'coding' })
    await expect(controller.configuration(sessionId)).resolves.toMatchObject({ agentPreset: 'coding' })
  })

  it('reports a named Session outside the requested workspace members', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { controller } = await bench(cwd, temporary('dsh-deferred-config-'), {
      id: 'primary' as WorkspaceId, directories: [cwd],
    })
    const { sessionId } = await controller.create({ cwd })

    // The draft is not a member of the named workspace, so a new draft takes its place.
    const created = await controller.create({ sessionId, workspaceId: 'primary' as WorkspaceId })
    expect(created.sessionId).not.toBe(sessionId)
  })

  it('treats an executing named Session as reusable without a preset change', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { controller, created, resolveAgent } = await bench(cwd, temporary('dsh-deferred-config-'))
    const { sessionId } = await controller.create({ cwd })
    await resolveAgent(sessionId)

    // Nothing in the request changes, so the executing identity is reported back unchanged.
    const reused = await controller.create({ sessionId, cwd })

    expect(reused.sessionId).toBe(sessionId)
    expect(created).toEqual([sessionId])
    expect(await controller.configuration(sessionId)).toMatchObject({ draft: false })
  })

  it('reports the preset of a reusable executed Session that has no draft', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const directory = temporary('dsh-deferred-config-')
    const first = await bench(cwd, directory)
    const { sessionId } = await first.controller.create({ cwd, agentPreset: 'review' })
    await first.ctx.fiber.dispose()

    // A record whose log already exists stays executed while keeping its recorded preset.
    writeFileSync(join(directory, `${sessionId}.json`), JSON.stringify({
      sessionId, cwd, createdAt: 1, agentPreset: 'review', draft: false,
    }))
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const header = { version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 1, cwd, isSeeded: false, agentPreset: 'review' }
    ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
      list: () => Promise.resolve([header]),
      inspect: () => Promise.resolve({ meta: header, events: [] }),
    }) as never)
    ctx.provide('workspaceRegistry', {
      get: () => undefined, list: () => [], directoriesOf: () => [], archivedSessionIds: [],
      registerSessionSource: () => () => {}, refreshSessionHeaders: () => Promise.resolve(),
    } as never)
    ctx.provide('fileUploads', { registerAgentResolver: () => () => {}, registerSessionValidator: () => () => {} } as never)
    const controller = createSessionTestController(ctx, {
      defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }), cwd, configurationDirectory: directory,
    })

    // The named Session is neither draft nor blank, so the request reports its own identity again.
    const reused = await controller.create({ sessionId, cwd })
    expect(reused).toEqual({ sessionId, agentPreset: 'review' })
  })

  it('creates a draft without resolving a preset when the registry is absent', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { controller } = await bench(cwd, temporary('dsh-deferred-config-'))

    const { sessionId, agentPreset } = await controller.create({ cwd })

    // The requested preset is recorded verbatim when nothing resolves it.
    expect(agentPreset).toBeUndefined()
    await expect(controller.configuration(sessionId)).resolves.toMatchObject({ draft: true })
  })

  it('reuses a listed draft by name without another write', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const directory = temporary('dsh-deferred-config-')
    const { controller } = await bench(cwd, directory)
    const first = await controller.create({ cwd })
    const second = await controller.create({ cwd })

    // Each named draft is reused in place, so a second listing still shows both rows.
    const again = await controller.create({ sessionId: second.sessionId, cwd })
    expect(again.sessionId).toBe(second.sessionId)
    const listed = await controller.list({}, new AbortController().signal)
    expect(listed.items.map(item => item.sessionId)).toEqual([second.sessionId, first.sessionId])
  })

  it('reports projections and configuration for a live deferred Session', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { controller, resolveAgent } = await bench(cwd, temporary('dsh-deferred-config-'))
    const { sessionId } = await controller.create({ cwd })
    await controller.selectModel({ sessionId, provider: 'test', model: 'other-model' })

    // The draft projection path answers before any Agent exists.
    await expect(controller.projections({ sessionId }, new AbortController().signal)).resolves.toMatchObject({
      kind: 'sequenced',
      values: { modelSelection: { next: { provider: 'test', model: 'other-model' } } },
    })
    await expect(controller.configuration(sessionId)).resolves.toMatchObject({
      agentPreset: undefined, model: { provider: 'test', model: 'other-model' },
    })

    await resolveAgent(sessionId)
    // Once the Agent exists the live path answers instead of the draft lookup.
    await expect(controller.projections({ sessionId }, new AbortController().signal))
      .resolves.toMatchObject({ kind: 'sequenced' })
  })

  it('reads a draft configuration without a saved permission preset or with a saved model', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { controller } = await bench(cwd, temporary('dsh-deferred-config-'))
    const { sessionId } = await controller.create({ cwd })
    await controller.selectModel({ sessionId, provider: 'test', model: 'other-model' })
    await controller.selectModel({ sessionId, provider: 'test', model: 'other-model' })

    // A repeated choice keeps one pending model with no permission preset.
    const saved = await controller.configuration(sessionId)
    expect(saved.model).toEqual({ provider: 'test', model: 'other-model' })
    expect(saved).not.toHaveProperty('permissionPreset')
    expect(saved.blank).toBe(true)
  })

  it('serializes two workspace-less configure requests for one draft', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { controller, created } = await bench(cwd, temporary('dsh-deferred-config-'))
    const { sessionId } = await controller.create({ cwd })

    // Both configure calls target the same draft; the record stays one and no Agent starts.
    const results = await Promise.all([
      controller.configure({ sessionId, agentPreset: 'review' }),
      controller.configure({ sessionId, agentPreset: 'review' }),
    ])
    expect(results).toEqual([{ sessionId, agentPreset: 'review' }, { sessionId, agentPreset: 'review' }])
    expect(await controller.configuration(sessionId)).toMatchObject({ agentPreset: 'review' })
    expect(created).toEqual([])
  })

  it('refuses to configure a draft when a name-only request fails the workspace check', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { controller } = await bench(cwd, temporary('dsh-deferred-config-'), {
      id: 'primary' as WorkspaceId, directories: [cwd],
    })
    const { sessionId } = await controller.create({ cwd })

    await expect(controller.configure({ sessionId, workspaceId: 'ghost' as WorkspaceId }))
      .rejects.toThrow('Workspace does not exist')
    expect(await controller.configuration(sessionId)).toMatchObject({ cwd })
  })

  it('propagates a configuration read that fails for a reason other than absence', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const directory = temporary('dsh-deferred-config-')
    writeFileSync(join(directory, 'session-broken.json'), '{"sessionId": "session-broken"}')
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
      list: () => Promise.resolve([]),
      inspect: () => Promise.resolve(undefined),
    }) as never)
    ctx.provide('workspaceRegistry', {
      get: () => undefined, list: () => [], directoriesOf: () => [], archivedSessionIds: [],
      registerSessionSource: () => () => {}, refreshSessionHeaders: () => Promise.resolve(),
    } as never)
    ctx.provide('fileUploads', { registerAgentResolver: () => () => {}, registerSessionValidator: () => () => {} } as never)
    const controller = createSessionTestController(ctx, {
      defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }), cwd, configurationDirectory: directory,
    })

    // A malformed record is not an absent Session, so create propagates the load failure.
    await expect(controller.create({ sessionId: SessionId('session-broken'), cwd })).rejects.toThrow()
  })

  it('creates a draft through a workspace without a member directory', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { controller } = await bench(cwd, temporary('dsh-deferred-config-'), {
      id: 'primary' as WorkspaceId, directories: [],
    })

    // With no member directory the draft falls back to the process working directory.
    const { sessionId } = await controller.create({ workspaceId: 'primary' as WorkspaceId, cwd: undefined })
    expect(await controller.configuration(sessionId)).toMatchObject({ cwd: process.cwd() })
  })

  it('treats a draft whose Session log already exists as executed', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const directory = temporary('dsh-deferred-config-')
    const first = await bench(cwd, directory)
    const { sessionId } = await first.controller.create({ cwd })
    await first.ctx.fiber.dispose()

    const second = new Context()
    contexts.push(second)
    await second.plugin(SessionStore)
    await second.plugin(AgentRegistry)
    const header = { version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 1, cwd, isSeeded: false }
    second.provide('sessionPersistence', testSessionPersistence(second, {
      list: () => Promise.resolve([header]),
      inspect: () => Promise.resolve({ meta: header, events: [] }),
    }) as never)
    second.provide('workspaceRegistry', {
      get: () => undefined, list: () => [], directoriesOf: () => [], archivedSessionIds: [],
      registerSessionSource: () => () => {}, refreshSessionHeaders: () => Promise.resolve(),
    } as never)
    second.provide('fileUploads', { registerAgentResolver: () => () => {}, registerSessionValidator: () => () => {} } as never)
    const controller = createSessionTestController(second, {
      defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }), cwd, configurationDirectory: directory,
    })

    await expect(controller.configuration(sessionId)).resolves.toMatchObject({ draft: false })
    const listed = await controller.list({}, new AbortController().signal)
    expect(listed.items.map(item => item.sessionId)).toContain(sessionId)
  })

  it('reports summaries for executed records that still carry choices', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { controller, ctx, resolveAgent } = await bench(cwd, temporary('dsh-deferred-config-'))
    const { sessionId } = await controller.create({ cwd })
    await controller.selectModel({ sessionId, provider: 'test', model: 'other-model' })
    await resolveAgent(sessionId)
    // A choice saved for an executed Session stays pending until a command resolves it again.
    await controller.selectModel({ sessionId, provider: 'test', model: 'third-model' })

    const listed = await controller.list({}, new AbortController().signal)
    expect(listed.items).toHaveLength(1)
    expect(listed.items[0]?.configuration?.values).toMatchObject({
      modelSelection: { next: { provider: 'test', model: 'third-model' } },
    })
    expect(ctx.agents.get(sessionId)).toBeDefined()
  })

  it('rejects create requests that name both a workspace and a directory', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { controller } = await bench(cwd, temporary('dsh-deferred-config-'))

    await expect(controller.create({ workspaceId: 'primary' as WorkspaceId, cwd }))
      .rejects.toThrow('Choose workspaceId or cwd')
    await expect(controller.create({ workspaceId: 'primary' as WorkspaceId }))
      .rejects.toThrow('Workspace does not exist')
  })

  it('keeps one configured directory per Session identity after a restart', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const directory = temporary('dsh-deferred-config-')
    writeFileSync(join(directory, 'mismatched.json'), JSON.stringify({
      sessionId: 'session-other', cwd, createdAt: 1, draft: true,
    }))
    const { ctx } = await bench(cwd, directory)

    await ctx.fiber.dispose()
    expect(existsSync(join(directory, 'mismatched.json'))).toBe(true)
  })

  it('rejects a configuration file whose identity differs from its filename', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const directory = temporary('dsh-deferred-config-')
    writeFileSync(join(directory, 'mismatched.json'), JSON.stringify({
      sessionId: 'session-other', cwd, createdAt: 1, draft: true,
    }))
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
      list: () => Promise.resolve([]),
      inspect: () => Promise.resolve(undefined),
    }) as never)
    ctx.provide('workspaceRegistry', {
      get: () => undefined, list: () => [], directoriesOf: () => [], archivedSessionIds: [],
      registerSessionSource: () => () => {}, refreshSessionHeaders: () => Promise.resolve(),
    } as never)
    ctx.provide('fileUploads', { registerAgentResolver: () => () => {}, registerSessionValidator: () => () => {} } as never)

    expect(() => createSessionTestController(ctx, {
      defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }), cwd, configurationDirectory: directory,
    })).not.toThrow()
    // The load rejection surfaces through the first read rather than silently dropping the record.
    await expect(ctx.sessionController.configuration(SessionId('session-other')))
      .rejects.toThrow('Session configuration identity differs from its filename')
  })

  it('skips non-JSON entries and ignores a missing persistence stat service', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const directory = temporary('dsh-deferred-config-')
    writeFileSync(join(directory, 'notes.txt'), 'not a configuration')
    writeFileSync(join(directory, 'session-kept.json'), JSON.stringify({
      sessionId: 'session-kept', cwd, createdAt: 1, draft: true,
      model: { provider: 'test', model: 'kept-model', reasoningEffort: 'high' },
    }))
    const { controller } = await bench(cwd, directory, undefined, { persistence: false })

    // Without a persistence service every record stays a draft, with its saved model intact.
    const listed = await controller.list({}, new AbortController().signal)
    expect(listed.items.map(item => item.sessionId)).toEqual(['session-kept'])
    await expect(controller.configuration(SessionId('session-kept'))).resolves.toMatchObject({
      draft: true, model: { provider: 'test', model: 'kept-model', reasoningEffort: 'high' },
    })
  })

  it('serializes operations queued behind a failed write', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const directory = temporary('dsh-deferred-config-')
    const { controller, created } = await bench(cwd, directory)
    const { sessionId } = await controller.create({ cwd })
    // A validation refusal leaves the queue usable for the next operation.
    await expect(controller.selectPermission({ sessionId, preset: 'refused' })).rejects.toThrow('Unknown permission preset')
    await expect(controller.selectPermission({ sessionId, preset: 'review' })).resolves.toEqual({ accepted: true })
    expect(await controller.configuration(sessionId)).toMatchObject({ permissionPreset: 'review' })
    expect(created).toEqual([])
  })

  it('loads a restored draft through its retained observation', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const directory = temporary('dsh-deferred-config-')
    const first = await bench(cwd, directory)
    const { sessionId } = await first.controller.create({ cwd })
    await first.ctx.fiber.dispose()
    const { controller } = await bench(cwd, directory)

    // Listing builds one read-only cut; retaining it must reproduce the same draft.
    using observation = await controller.observe(sessionId)
    expect(observation?.source).toBe('prepared')
    expect(observation?.retain().events.map(event => event.type)).toEqual(observation?.events.map(event => event.type))
    expect(observation?.retain().header.cwd).toBe(cwd)
  })

  it('reapplies a saved preset model and permission on activation', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { controller, resolveAgent } = await bench(cwd, temporary('dsh-deferred-config-'))
    const { sessionId } = await controller.create({ cwd, agentPreset: 'review' })
    await controller.selectModel({ sessionId, provider: 'test', model: 'other-model' })
    await controller.selectPermission({ sessionId, preset: 'review' })
    // Repeating the same model choice leaves the persisted log unchanged.
    await controller.selectModel({ sessionId, provider: 'test', model: 'other-model' })

    const agent = await resolveAgent(sessionId)

    const events = sessionOf(agent).snapshotEvents()
    // A repeated model choice appends a selection event only when the value differs.
    expect(events.filter(event => event.type === 'model/selection')).toHaveLength(2)
    expect(events.filter(event => event.type === 'agent-preset/selected').map(event => event.data))
      .toEqual([{ agentPreset: 'review' }])
    expect(await controller.configuration(sessionId)).toMatchObject({ draft: false })
  })

  it('applies a saved reasoning effort and permission preset when activating', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const { controller, resolveAgent } = await bench(cwd, temporary('dsh-deferred-config-'))
    const { sessionId } = await controller.create({ cwd })
    await controller.selectModel({ sessionId, provider: 'test', model: 'other-model', reasoningEffort: 'high' })
    await controller.selectPermission({ sessionId, preset: 'review' })

    const agent = await resolveAgent(sessionId)

    // Both staged choices reach the Agent the draft turns into.
    expect(sessionOf(agent).snapshotEvents().filter(event => event.type === 'model/selection').map(event => event.data))
      .toContainEqual({ provider: 'test', model: 'other-model', reasoningEffort: 'high' })
    expect(await controller.configuration(sessionId)).toMatchObject({ draft: false })
  })

  it('resumes a recorded Session when its Agent is resolved from a stale identity', async () => {
    const cwd = temporary('dsh-deferred-cwd-')
    const directory = temporary('dsh-deferred-config-')
    const first = await bench(cwd, directory)
    const { sessionId } = await first.controller.create({ cwd })
    await first.controller.selectModel({ sessionId, provider: 'test', model: 'other-model' })
    await first.ctx.fiber.dispose()

    const second = new Context()
    contexts.push(second)
    await second.plugin(SessionStore)
    await second.plugin(AgentRegistry)
    const header = { version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 1, cwd, isSeeded: false }
    second.provide('sessionPersistence', testSessionPersistence(second, {
      list: () => Promise.resolve([header]),
      inspect: () => Promise.resolve({ meta: header, events: [] }),
    }) as never)
    second.provide('workspaceRegistry', {
      get: () => undefined, list: () => [], directoriesOf: () => [], archivedSessionIds: [],
      registerSessionSource: () => () => {}, refreshSessionHeaders: () => Promise.resolve(),
    } as never)
    second.provide('fileUploads', { registerAgentResolver: () => () => {}, registerSessionValidator: () => () => {} } as never)
    const controller = createSessionTestController(second, {
      defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }), cwd, configurationDirectory: directory,
    })

    // The record loaded as executed, so the Host resumes instead of creating from a draft.
    await expect(controller.configuration(sessionId)).resolves.toMatchObject({ draft: false })
    await expect(controller.resolveAgent(sessionId)).resolves.toMatchObject({
      error: expect.objectContaining({ code: 'gateway/internal' }),
    })
  })
})
