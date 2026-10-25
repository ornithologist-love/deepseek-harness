/** Deployment command policy: every chainable Session Remote delegates through one optional service. */

import { realpathSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentFactory } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { LlmAdapter, LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk, UserMessage } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import SessionController from '../src/index.ts'
import type { SessionCommandPolicy } from '../src/index.ts'
import type { SessionPromptRequest, SessionRequestId } from '../src/types.ts'
import { installSessionReadTestServices, testSessionPersistence } from './test-remote.ts'

const WORKSPACE = brandString<WorkspaceId>('workspace-primary')

const ABSENT = brandString<SessionId>('session-none')

const contexts: Context[] = []
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** One unique temporary directory removed after the test. */
function temporary(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  tempDirs.push(dir)
  return dir
}

let nextRequestId = 1

/** One prompt request with a fresh correlation identity. */
function promptRequest(
  payload: Omit<SessionPromptRequest, 'requestId'>,
): SessionPromptRequest {
  return { ...payload, requestId: `policy-${String(nextRequestId++)}` as SessionRequestId }
}

/** Provider double reporting one selectable model under the requested route. */
class PolicyAdapter extends LlmAdapter {
  constructor(private readonly models: readonly string[]) {
    super()
  }

  override listModels() {
    return Promise.resolve(this.models.map(id => ({ provider: 'test', id, name: id })))
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {}
}

interface BenchOptions {
  /** Deferred activation directory; omitted keeps eager Agent creation. */
  readonly configurationDirectory?: string
  /** Reject commands until a policy is mounted. */
  readonly policyRequired?: boolean
  /** Deployment policy mounted as `ctx.sessionCommandPolicy`. */
  readonly policy?: SessionCommandPolicy
}

interface Bench {
  readonly ctx: Context
  /** Deployment default writer the controller resolves through `ctx.agentDefaultModel`. */
  readonly saveSelection: Mock
  /** Global permission preset writer, which a policy-mounted deployment must not need. */
  readonly setPermission: Mock
}

/** Compose the Session services a policy bench needs, including optional deferred activation. */
async function bench(options: BenchOptions = {}): Promise<Bench> {
  const cwd = temporary('dsh-policy-cwd-')
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['test'], new PolicyAdapter(['test-model', 'other-model']))
  ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
    list: () => Promise.resolve([]),
    inspect: () => Promise.resolve(undefined),
  }) as never)
  installSessionReadTestServices(ctx)
  const saves = vi.fn(() => Promise.resolve())
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'test', model: 'test-model' }),
    saveSelection: saves,
  } as never)
  const sets = vi.fn()
  ctx.provide('permissionPresets', { set: sets } as never)
  ctx.provide('agentPresets', {
    resolve: (agentPreset: string | undefined) => Promise.resolve({ id: agentPreset ?? 'default' }),
    mount: () => Promise.resolve(),
  } as never)
  ctx.provide('typert', {
    lookups: { configure: () => () => {} },
    contexts: { configureHost: () => () => {} },
    resources: { register: () => () => {} },
  } as never)
  ctx.provide('attachments', {
    imageLimits: {
      maxImageBytes: 5 * 1024 * 1024, maxImagesPerMessage: 20, maxMessageImageBytes: 100 * 1024 * 1024,
      maxImagePixels: 40_000_000, maxImageDimension: 2000, mediaTypes: ['image/png'],
    },
    admitPromptContent: (content: never[]) => Promise.resolve(content),
  } as never)
  ctx.provide('fileUploads', {
    registerAgentResolver: () => () => {},
    registerSessionValidator: () => () => {},
    resolve: () => undefined,
    bindPrompt: () => ({ commit: () => {}, [Symbol.dispose]: () => {} }),
    retirePrompt: () => {},
  } as never)
  const workspace = {
    id: WORKSPACE, sessionIds: [] as readonly SessionId[],
    attachSession: () => Promise.resolve(), detachSession: () => Promise.resolve(),
  }
  ctx.provide('workspaceRegistry', {
    get: () => workspace,
    list: () => [workspace],
    directoriesOf: () => [cwd],
    archivedSessionIds: [],
    registerSessionSource: () => () => {},
    refreshSessionHeaders: () => Promise.resolve(),
  } as never)
  ctx.agents.setFactory(policyFactory(ctx))
  new SessionController(ctx, {
    ...options.configurationDirectory === undefined ? {} : { configurationDirectory: options.configurationDirectory },
    ...options.policyRequired === undefined ? {} : { policyRequired: options.policyRequired },
  })
  if (options.policy !== undefined) ctx.provide('sessionCommandPolicy', options.policy)
  return { ctx, saveSelection: saves, setPermission: sets }
}

/** Publish a stand-in Agent for every creation so Remote calls can reach Agent-owned commands. */
function policyFactory(ctx: Context): AgentFactory {
  return {
    async createAgent(_ownerCtx, create) {
      const session = ctx.sessions.prepare(create.sessionId, {
        ...(create.meta === undefined ? {} : { meta: create.meta }),
        ...(create.seed === undefined ? {} : { seed: [...create.seed] }),
      })
      const agent = agentOf(ctx, session)
      ctx.effect(function* () {
        yield ctx.sessions.enter(session)
        ctx.sessions.announce(session)
      }, 'test: published Session')
      const unregister = await ctx.agents.register(agent)
      return { agent, dispose: async () => { await unregister() } }
    },
    resume: () => Promise.reject(new Error('no stored Sessions in this test')),
  }
}

/** One stand-in Agent whose inbox records admitted messages. */
function agentOf(ctx: Context, session: Session): Agent {
  const admitted: UserMessage[] = []
  return {
    id: session.id,
    session,
    status: 'idle',
    ctx,
    inbox: { nextTurn: admitted, nextStep: [] },
    followup: (message: UserMessage) => { admitted.push(message) },
  } as unknown as Agent
}

describe('Session command policy', () => {
  it('keeps every command unchanged without a mounted policy', async () => {
    const { ctx } = await bench()
    const controller = ctx.sessionController

    const created = await controller.create({ workspaceId: WORKSPACE })
    await expect(controller.selectModel({ sessionId: created.sessionId, provider: 'test', model: 'other-model' }))
      .resolves.toEqual({ selected: { provider: 'test', model: 'other-model' } })
    await expect(controller.prompt(promptRequest({
      sessionId: created.sessionId, mode: 'queue', content: [{ type: 'text', text: 'hello' }],
    }), new AbortController().signal)).resolves.toEqual({ accepted: true })
    const catalog = await controller.modelCatalog()
    expect(catalog.groups.map(group => group.id)).toEqual(['test'])
  })

  it.each([
    ['create', true],
    ['selectModel', true],
    ['prompt', false],
    ['modelCatalog', false],
  ] as const)('refuses %s until a required policy is mounted', async (command, synchronous) => {
    const { ctx } = await bench({ policyRequired: true })
    const controller = ctx.sessionController
    const signal = new AbortController().signal
    const call = (): Promise<unknown> => {
      switch (command) {
        case 'create': return controller.create({ workspaceId: WORKSPACE })
        case 'selectModel':
          return controller.selectModel({ sessionId: ABSENT, provider: 'test', model: 'test-model' })
        case 'prompt':
          return controller.prompt(promptRequest({
            sessionId: ABSENT, mode: 'queue', content: [{ type: 'text', text: 'hello' }],
          }), signal)
        case 'modelCatalog': return controller.modelCatalog()
      }
    }

    // create and selectModel are synchronous Remotes; prompt and modelCatalog refuse through their promise.
    if (synchronous) expect(call).toThrow('Session command policy is not ready')
    else await expect(call()).rejects.toThrow('Session command policy is not ready')
  })

  it('applies creation defaults and keeps the initial model out of the global default', async () => {
    const { ctx, saveSelection } = await bench({
      configurationDirectory: temporary('dsh-policy-config-'),
      policy: {
        async create(request, next) {
          return await next({ ...request, agentPreset: 'policy-preset' })
        },
      },
    })

    const created = await ctx.sessionController.create({ workspaceId: WORKSPACE })

    expect(created).toEqual({ sessionId: expect.any(String), agentPreset: 'policy-preset' })
    await expect(ctx.sessionController.configuration(created.sessionId))
      .resolves.toMatchObject({ agentPreset: 'policy-preset' })
    expect(saveSelection).not.toHaveBeenCalled()
  })

  it('saves the default only when the continuation keeps it enabled', async () => {
    const { ctx, saveSelection } = await bench({
      policy: {
        selectModel: (request, next) => {
          if (request.model === 'other-model') return next(request)
          return next(request, false)
        },
      },
    })
    const { sessionId } = await ctx.sessionController.create({ workspaceId: WORKSPACE })

    await expect(ctx.sessionController.selectModel({ sessionId, provider: 'test', model: 'other-model' }))
      .resolves.toEqual({ selected: { provider: 'test', model: 'other-model' } })
    await expect.poll(() => saveSelection.mock.calls.length).toBe(1)
    await ctx.sessionController.selectModel({ sessionId, provider: 'test', model: 'test-model' })

    expect(saveSelection).toHaveBeenCalledExactlyOnceWith({ provider: 'test', model: 'other-model' })
  })

  it('delivers rewritten prompt content and refuses a prompt the policy rejects', async () => {
    const { ctx } = await bench({
      policy: {
        async prompt(request, _signal, next) {
          const text = request.content.map(part => part.type === 'text' ? part.text : '').join('')
          if (text === 'refuse') throw new Error('policy refused this prompt')
          return await next({ ...request, content: [{ type: 'text', text: `routed ${text}` }] })
        },
      },
    })
    const { sessionId } = await ctx.sessionController.create({ workspaceId: WORKSPACE })
    const signal = new AbortController().signal

    await expect(ctx.sessionController.prompt(
      promptRequest({ sessionId, mode: 'queue', content: [{ type: 'text', text: 'hello' }] }), signal,
    )).resolves.toEqual({ accepted: true })
    const agent = ctx.agents.get(sessionId)
    expect(agent?.inbox.nextTurn.map(message => message.content)).toEqual([
      [{ type: 'text', text: 'routed hello' }],
    ])
    // The Agent-owned command rejects the refusal before admission.
    const refused = new Error('policy refused this prompt')
    await expect(ctx.sessionController.prompt(
      promptRequest({ sessionId, mode: 'queue', content: [{ type: 'text', text: 'refuse' }] }), signal,
    )).rejects.toThrow(refused.message)
  })

  it('rechecks cancellation when the policy continues after an abort', async () => {
    const aborter = new AbortController()
    const { ctx } = await bench({
      policy: {
        prompt: (request, _signal, next) => {
          aborter.abort()
          return next(request)
        },
      },
    })
    const { sessionId } = await ctx.sessionController.create({ workspaceId: WORKSPACE })

    await expect(ctx.sessionController.prompt(
      promptRequest({ sessionId, mode: 'queue', content: [{ type: 'text', text: 'hello' }] }), aborter.signal,
    )).rejects.toThrow()
    expect(ctx.agents.get(sessionId)?.inbox.nextTurn).toEqual([])
  })

  it('returns the catalog the policy decorates', async () => {
    const { ctx } = await bench({
      policy: {
        modelCatalog: catalog => ({
          ...catalog,
          groups: catalog.groups.map(group => ({
            ...group,
            models: group.models.map(model => ({ ...model, description: `decorated ${model.id}` })),
          })),
        }),
      },
    })

    const catalog = await ctx.sessionController.modelCatalog()

    expect(catalog.groups.flatMap(group => group.models.map(model => model.description)))
      .toEqual(['decorated test-model', 'decorated other-model'])
  })

  it('routes draft permission validation through the policy', async () => {
    const configurePermission = vi.fn()
    const { ctx, setPermission } = await bench({
      configurationDirectory: temporary('dsh-policy-config-'),
      policy: { configurePermission },
    })
    const { sessionId } = await ctx.sessionController.create({ workspaceId: WORKSPACE })

    await expect(ctx.sessionController.selectPermission({ sessionId, preset: 'review' })).resolves.toEqual({ accepted: true })

    expect(configurePermission.mock.calls.at(-1)?.[0]).toMatchObject({ id: sessionId })
    expect(configurePermission.mock.calls.at(-1)?.[1]).toBe('review')
    expect(setPermission).not.toHaveBeenCalled()
  })

  it('writes a policy-chosen initial model to the draft without starting an Agent', async () => {
    const { ctx } = await bench({
      configurationDirectory: temporary('dsh-policy-config-'),
      policy: {
        async create(request, next, selectInitialModel) {
          const created = await next(request)
          await selectInitialModel({ sessionId: created.sessionId, provider: 'test', model: 'other-model' })
          return created
        },
      },
    })

    const { sessionId } = await ctx.sessionController.create({ workspaceId: WORKSPACE })

    await expect(ctx.sessionController.configuration(sessionId))
      .resolves.toMatchObject({ draft: true, model: { provider: 'test', model: 'other-model' } })
    expect(ctx.agents.get(sessionId)).toBeUndefined()
  })
})
