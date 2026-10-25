/** Session Remote owner: cold reads, explicit Agent commands, and live control state. */

import { hostname } from 'node:os'
import { resolve } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandDescriptor } from '@deepseek-ai/dsh-commands/types'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-workspace'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { errorChain, ReasoningEffortId, type MessageSource } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-client-file-upload'
import { canOpenNativePath, nativeFileManager, nativeFileApplications, openNativeFileApplication, openNativeAssociatedPath, revealNativePath } from '@deepseek-ai/dsh-native-command'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionInspection } from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import { SessionQueryError, type SessionObservation } from '@deepseek-ai/dsh-session-query'
import { Remote, RemoteError, TypertRemoteService, principalOf } from '@deepseek-ai/dsh-typert-protocol'
import { canonicalClientTimeZone } from '@deepseek-ai/dsh-util-time'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type {} from '@deepseek-ai/dsh-api-remote-access'
import {
  ApiSessionAgentController,
  inspectApiSession,
  type ApiSessionAgentResult,
} from './agent.ts'
import { SessionCommandController, hasPromptContent } from './commands.ts'
import { SessionControlController } from './control.ts'
import { SessionHistoryController } from './history.ts'
import { SessionFileReferences } from './file-references.ts'
import { ApiSessionList } from './list.ts'
import { SessionConfigurations, type SessionConfiguration } from './configuration.ts'
import { buildModelCatalog, hasProviderApiKey } from './catalog.ts'
import { installModelSelectionProjection } from './model-selection-projection.ts'
import { SessionSkillCatalog } from './skill-catalog.ts'
import { SessionMediaReferences } from './media-references.ts'
import { ArchivedSessionGate } from './archived-session-gate.ts'
import type {
  ModelCatalog,
  SessionWorkspacePathApplication,
  SessionAddress,
  SessionAttachmentRequest,
  SessionAttachmentValue,
  SessionCancelRequest,
  SessionCancelValue,
  SessionControlFrame,
  SessionCreateRequest,
  SessionCreateValue,
  SessionFollowFrame,
  SessionFollowRequest,
  SessionForkRequest,
  SessionForkValue,
  SessionListRequest,
  SessionListValue,
  SessionOpenWorkspacePathRequest,
  SessionOpenWorkspacePathValue,
  SessionPage,
  SessionPageRequest,
  SessionPromptRequest,
  SessionPromptValue,
  SessionRenameRequest,
  SessionRenameValue,
  SessionSearchRequest,
  SessionSearchValue,
  SessionSelectModelRequest,
  SessionSelectModelValue,
  SessionProjectionsRequest,
  SessionProjectionsValue,
  SessionProjectionValues,
  SessionUpdateQueueRequest,
  SessionUpdateQueueValue,
} from './types.ts'

export type * from './types.ts'
export { ApiSessionNotFound } from './agent.ts'
export { SessionFileReferences } from './file-references.ts'
export { SessionSkillCatalog } from './skill-catalog.ts'

/** Index global telling clients that composer choices are saved without activating an Agent. */
const DEFERRED_ACTIVATION_KEY = '__DSH_DEFERRED_AGENT__'

/** Host policy around commands; continuation retains canonical validation and admission. */
export interface SessionCommandPolicy {
  /** Validate and record permission choices without constructing an Agent. */
  configurePermission?(session: Session, preset: string): void
  /** Apply creation defaults; initial selection validates without saving a global default. */
  create?(
    request: SessionCreateRequest,
    next: (request: SessionCreateRequest) => Promise<SessionCreateValue>,
    selectInitialModel: (request: SessionSelectModelRequest) => Promise<SessionSelectModelValue>,
  ): Promise<SessionCreateValue>
  /** The continuation serializes selection with image admission; defaults save unless explicitly disabled. */
  selectModel?(
    request: SessionSelectModelRequest,
    next: (request: SessionSelectModelRequest, persistDefault?: boolean) => Promise<SessionSelectModelValue>,
  ): Promise<SessionSelectModelValue>
  /** Transform or refuse one prompt; the continuation rechecks cancellation before admission. */
  prompt?(
    request: SessionPromptRequest,
    signal: AbortSignal,
    next: (request: SessionPromptRequest) => Promise<SessionPromptValue>,
  ): Promise<SessionPromptValue>
  /** Decorate the catalog without replacing model resolution or validation. */
  modelCatalog?(catalog: ModelCatalog): ModelCatalog | Promise<ModelCatalog>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Session business API and Remote namespace owner. */
    sessionController: SessionController
    sessionCommandPolicy: SessionCommandPolicy
  }
}

/**
 * Read the Session resource a history address names: the Session itself, or
 * the child Session whose transcript a subagent address reads.
 * @param request - history request carrying the durable address.
 * @returns the Session whose access the read requires.
 */
function addressedSession(request: { readonly address: SessionAddress }): SessionId {
  return request.address.kind === 'session' ? request.address.sessionId : request.address.childSessionId
}

/** Session Controller deployment policy. */
export interface Config {
  /** Save composer drafts separately and activate Agents only for execution. */
  readonly configurationDirectory?: string
  /** Override platform desktop-opener detection. */
  readonly nativeOpen?: boolean
  /** Positive integral milliseconds of list work before yielding between complete rows. */
  readonly listWorkSliceMs?: number
  /** Reject commands until the deployment policy is mounted. */
  readonly policyRequired?: boolean
}

/** Deployment policy after schema defaults have been applied. */
type ResolvedConfig = Config & { readonly listWorkSliceMs: number }

/** Host integrations replaceable by direct unit tests. */
export interface SessionControllerInternals {
  /** Native default-application handoff. */
  readonly openPath?: (path: string, signal: AbortSignal) => Promise<void>
  /** Native file-association query. */
  readonly fileApplications?: typeof nativeFileApplications
  /** Explicit registered-application handoff. */
  readonly openFileApplication?: typeof openNativeFileApplication
  /** Native file-manager handoff. */
  readonly revealPath?: (path: string, signal: AbortSignal) => Promise<void>
  /** Native handoff availability probe. */
  readonly canOpenPath?: () => boolean
}

/** Host service backing the generated `ctx.remote.session` namespace. */
export class SessionController extends TypertRemoteService {
  static inject = [
    'agentDefaultModel',
    'agents',
    'attachments',
    'fileUploads',
    'fs',
    'llm',
    'remoteAccess',
    'sessions',
    'sessionProjections',
    'sessionQuery',
    'typert',
    'workspaceRegistry',
  ]

  static Config: z<Config, ResolvedConfig> = z.object({
    nativeOpen: z.boolean(),
    listWorkSliceMs: z.natural().min(1).default(16),
    configurationDirectory: z.string(),
    policyRequired: z.boolean().default(false),
  })

  private readonly agents: ApiSessionAgentController
  private readonly configurations: SessionConfigurations | undefined
  private readonly commands: SessionCommandController
  private readonly controlState: SessionControlController
  private readonly history: SessionHistoryController
  private readonly listState: ApiSessionList
  private readonly openPath: (path: string, signal: AbortSignal) => Promise<void>
  private readonly fileApplications: typeof nativeFileApplications
  private readonly openFileApplication: typeof openNativeFileApplication
  private readonly revealPath: (path: string, signal: AbortSignal) => Promise<void>
  private readonly canOpenPath: () => boolean
  private readonly promotions = new Set<Promise<void>>()
  private readonly policyRequired: boolean

  private policy(): SessionCommandPolicy | undefined {
    const policy = this.ctx.get('sessionCommandPolicy')
    if (this.policyRequired && policy === undefined) throw new Error('Session command policy is not ready')
    return policy
  }

  /**
   * @param ctx - Host context containing the Session capability assembly.
   * @param config - native-opener and list-scheduling deployment policy.
   * @param internals - host integrations replaceable by direct unit tests.
   */
  constructor(ctx: Context, config: Config, internals: SessionControllerInternals = {}) {
    super(ctx, 'sessionController', { namespace: 'session' })
    ctx.typert.resources.register('session', { field: 'sessionId' })
    const resolved = SessionController.Config(config)
    this.policyRequired = resolved.policyRequired ?? false
    installModelSelectionProjection(ctx)
    this.configurations = config.configurationDirectory === undefined ? undefined
      : new SessionConfigurations(ctx, config.configurationDirectory, (session, preset) => {
        const policy = this.policy()
        if (policy?.configurePermission) policy.configurePermission(session, preset)
        else {
          const permissions = ctx.get('permissionPresets')
          if (permissions === undefined) throw new Error('Permission configuration is unavailable')
          permissions.set(session, preset)
        }
      })
    if (this.configurations) ctx.inject(['webServer'], (webCtx) => {
      webCtx.on('webserver/index-inject', (table) => {
        table.push({ kind: 'global', name: DEFERRED_ACTIVATION_KEY, value: true })
      })
    })
    this.agents = new ApiSessionAgentController(ctx, this.configurations)
    this.commands = new SessionCommandController(ctx, this.agents, process.cwd())
    if (this.configurations) ctx.effect(() => ctx.fileUploads.registerSessionValidator(async (sessionId) => {
      using observation = await this.observe(sessionId)
      if (observation.header.origin === 'subagent') throw new Error('Subagent conversations do not accept uploads')
    }), 'session-controller: composer upload validation')
    ctx.effect(() => ctx.fileUploads.registerAgentResolver(async (sessionId) => {
      const result = await this.agents.resolveAgent(sessionId)
      if ('error' in result) throw result.error
      return result.agent
    }), 'session-controller: file-upload Agent resolver')
    this.controlState = new SessionControlController(ctx)
    // Registered before history so reverse-order teardown closes every
    // follower before waiting for already-admitted promotions.
    ctx.effect(() => async () => {
      await Promise.allSettled([...this.promotions])
    }, 'session-controller.promotions')
    this.history = new SessionHistoryController(ctx,
      this.configurations ? undefined : (observation) => { this.promote(observation) },
      this.configurations ? sessionId => this.observe(sessionId) : undefined)
    this.listState = new ApiSessionList(ctx, resolved.listWorkSliceMs)
    this.fileApplications = internals.fileApplications ?? nativeFileApplications
    this.openFileApplication = internals.openFileApplication ?? openNativeFileApplication
    this.openPath = internals.openPath ?? openNativeAssociatedPath
    this.revealPath = internals.revealPath ?? revealNativePath
    this.canOpenPath = internals.canOpenPath
      ?? (() => config.nativeOpen ?? (internals.openPath !== undefined || canOpenNativePath()))
    ctx.plugin(SessionFileReferences)
    ctx.plugin(SessionMediaReferences)
    ctx.plugin(SessionSkillCatalog)
    // An archived Session, or a subagent descendant of one, runs no model step
    // until it is restored; what it still runs is stopped by the owners that
    // answer the Workspace registry's archive-admission events.
    ctx.plugin(ArchivedSessionGate)

    ctx.on('session/created', (session) => {
      ctx.emit('api-session/added', this.listState.summaryFor(session))
    })
    ctx.on('session/disposed', (session) => {
      ctx.emit('api-session/removed', session.id)
    })
    const publishAgentAvailability = ({ agent }: { agent: Agent }): undefined => {
      if (ctx.sessions.get(agent.id) === agent.session) {
        ctx.emit('api-session/added', this.listState.summaryFor(agent.session))
      }
    }
    ctx.on('agent/created', publishAgentAvailability)
    ctx.on('agent/disposed', publishAgentAvailability)
    ctx.on('agent/status', ({ agent, status }) => {
      ctx.emit('api-session/status', agent.id, status === 'running')
    })
    ctx.on('agent/error', ({ agent, error }) => {
      ctx.emit('api-session/error', agent.id, errorChain(error))
    })
    ctx.on('session/event', (session, event) => {
      if (event.type === 'request/header') {
        const agent = ctx.agents.get(session.id)
        if (agent?.session === session) this.agents.consumeSelection(
          agent,
          event.data.header.config.provider,
          event.data.header.config.model,
          event.data.header.config.reasoningEffort,
        )
      }
      if (event.type !== 'user/message' || event.data.source.kind !== 'user') return
      ctx.emit('api-session/activity', session.id, event.time)
    })
  }

  private promote(observation: SessionObservation): void {
    const sessionId = observation.header.id
    const task = (async () => {
      using ownedObservation = observation
      const result = await this.agents.resolveObservedAgent(ownedObservation)
      if ('error' in result) this.ctx.emit('api-session/error', sessionId, result.error.message)
    })().catch((error: unknown) => {
      this.ctx.logger.error(`session-controller: background activation for "${sessionId}" failed: ${errorChain(error)}`)
    })
    this.promotions.add(task)
    void task.finally(() => { this.promotions.delete(task) })
  }

  /**
   * Resolve or resume one ordinary Session for another Host API domain.
   * @param sessionId - Session identity whose Agent owns the operation.
   * @returns the live Agent or the stable Session-domain failure.
   */
  resolveAgent(sessionId: SessionId): Promise<ApiSessionAgentResult> {
    return this.agents.resolveAgent(sessionId)
  }

  /**
   * Inspect one attached or persisted Session without activating its Agent.
   * @param sessionId - durable Session identity.
   * @param signal - optional caller cancellation for persistence reads.
   * @returns the current attached state or persisted header and event prefix.
   */
  async inspect(
    sessionId: SessionId,
    signal?: AbortSignal,
  ): Promise<SessionInspection> {
    const attached = this.ctx.sessions.get(sessionId)
    if (attached !== undefined) {
      return Promise.resolve({
        meta: attached.header,
        inheritedEventCount: attached.inheritedEventCount,
        // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
        events: attached.snapshotEvents(),
      })
    }
    const draft = this.configurations === undefined ? undefined : await this.configurations.observe(sessionId)
    if (draft) {
      using owned = draft
      return { meta: owned.header, inheritedEventCount: owned.inheritedEventCount, events: owned.events }
    }
    return inspectApiSession(this.ctx, sessionId, signal)
  }

  /** @param sessionId - Session identity. @param signal - read cancellation. @returns a read-only draft or history cut. */
  async observe(sessionId: SessionId, signal?: AbortSignal): Promise<SessionObservation> {
    signal?.throwIfAborted()
    const draft = this.configurations === undefined ? undefined : await this.configurations.observe(sessionId)
    if (draft !== undefined) return draft
    const options = signal === undefined ? {} : { signal }
    return await this.ctx.sessionQuery.observeSession(sessionId, options)
  }

  /** @param sessionId - Session identity. @returns saved composer choices and historical metadata, without an Agent. */
  async configuration(sessionId: SessionId): Promise<SessionConfiguration & { blank: boolean }> {
    using observation = await this.observe(sessionId)
    const saved = await this.configurations?.read(sessionId)
    if (observation.header.cwd === undefined) throw new Error('Session has no workspace')
    const model = saved?.model ?? observation.projections?.values.modelSelection?.next ?? undefined
    return { sessionId, cwd: observation.header.cwd, createdAt: observation.header.createdAt,
      agentPreset: observation.projections?.values.agentPreset ?? observation.header.agentPreset,
      draft: saved?.draft ?? false, blank: !observation.events.some(event => event.type === 'turn/start'),
      ...(saved?.permissionPreset ? { permissionPreset: saved.permissionPreset } : {}),
      ...(model ? { model } : {}) }
  }

  /**
   * Discover live-only commands without activating a draft or historical Agent.
   * @param sessionId - retained Session identity, validated through the cold reader.
   * @returns scoped descriptors for a live Agent; otherwise only client contributions apply.
   */
  @Remote('commandCatalog')
  async commandCatalog(sessionId: SessionId): Promise<readonly CommandDescriptor[]> {
    using _observation = await this.observe(sessionId)
    const agent = this.ctx.agents.get(sessionId)
    const commands = this.ctx.get('commands')
    return agent === undefined || commands === undefined ? [] : commands.list(agent)
  }

  /** @param request - draft identity and next choices; an executed Session starts a separate draft. @returns its identity. */
  @Remote('configure')
  async configure(request: SessionCreateRequest): Promise<SessionCreateValue> {
    const configurations = this.configurations
    if (configurations === undefined) throw new Error('Deferred Session configuration is not enabled')
    const id = request.sessionId
    if (id !== undefined) {
      const current = await configurations.read(id)
      if (current?.draft) return configurations.run(id, async () => {
        const latest = await configurations.read(id)
        if (!latest?.draft || this.ctx.agents.get(id)) throw new Error('Session execution has already started')
        const workspace = request.workspaceId === undefined ? undefined : this.ctx.workspaceRegistry.get(request.workspaceId)
        if (request.workspaceId !== undefined && !workspace) throw new Error('Workspace does not exist')
        const preset = request.agentPreset ?? latest.agentPreset
        if (preset) await this.ctx.get('agentPresets')?.resolve(preset)
        const member = workspace === undefined ? undefined : this.ctx.workspaceRegistry.directoriesOf(workspace.id)[0]
        await configurations.save({ ...latest, cwd: member ?? request.cwd ?? latest.cwd, agentPreset: preset })
        if (workspace) for (const other of this.ctx.workspaceRegistry.list()) {
          if (other.id !== workspace.id) await other.detachSession(id)
        }
        if (workspace) await workspace.attachSession(id)
        return { sessionId: id, ...(preset ? { agentPreset: preset } : {}) }
      })
    }
    const previous = id === undefined ? undefined : await this.configuration(id)
    const cwd = request.cwd ?? previous?.cwd
    const preset = request.agentPreset ?? previous?.agentPreset
    return this.createDraft({ ...(request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId }),
      ...(cwd === undefined ? {} : { cwd }), ...(preset === undefined ? {} : { agentPreset: preset }) })
  }

  private async createDraft(request: SessionCreateRequest): Promise<SessionCreateValue> {
    const configurations = this.configurations
    if (!configurations) return this.commands.create(request)
    if (request.workspaceId !== undefined && request.cwd !== undefined) throw new Error('Choose workspaceId or cwd')
    const workspace = request.workspaceId === undefined ? undefined : this.ctx.workspaceRegistry.get(request.workspaceId)
    if (request.workspaceId !== undefined && !workspace) throw new Error('Workspace does not exist')
    const member = workspace === undefined ? undefined : this.ctx.workspaceRegistry.directoriesOf(workspace.id)[0]
    const cwd = member ?? request.cwd ?? process.cwd()
    if (request.sessionId !== undefined) {
      let current: Awaited<ReturnType<SessionController['configuration']>> | undefined
      try { current = await this.configuration(request.sessionId) }
      catch (error: unknown) {
        if (!(error instanceof SessionQueryError) || error.code !== 'SESSION_QUERY_SESSION_NOT_FOUND') throw error
      }
      if (current !== undefined) {
        if (current.cwd !== cwd) throw new Error('Session belongs to another workspace')
        const reusable = current.blank && !this.ctx.workspaceRegistry.archivedSessionIds.includes(request.sessionId)
          && (workspace === undefined || workspace.sessionIds.includes(request.sessionId))
        if (reusable && current.draft) return this.configure(request)
        // Reusing an executing Agent is the upstream command controller's responsibility.
        // Deferred choices create a separate draft when the old log has already started.
        if (reusable && request.agentPreset === undefined) {
          return { sessionId: current.sessionId, ...(current.agentPreset ? { agentPreset: current.agentPreset } : {}) }
        }
      }
    }
    const { SessionId } = await import('@deepseek-ai/dsh-session')
    const { randomUUID } = await import('node:crypto')
    const id = SessionId('session-' + randomUUID())
    const presets = this.ctx.get('agentPresets')
    const preset = presets ? (await presets.resolve(request.agentPreset)).id : request.agentPreset
    await configurations.run(id, async () => {
      await configurations.save({ sessionId: id, cwd, ...(preset ? { agentPreset: preset } : {}), createdAt: Date.now(), draft: true })
      if (workspace) await workspace.attachSession(id)
    })
    return { sessionId: id, ...(preset ? { agentPreset: preset } : {}) }
  }

  /** @param request - model choices. @returns normalized staged selection without activation. */
  private async stageModel(request: SessionSelectModelRequest): Promise<SessionSelectModelValue> {
    const configurations = this.configurations
    if (!configurations) return this.commands.selectModel(request, false)
    return configurations.run(request.sessionId, async () => {
      const current = await this.configuration(request.sessionId)
      const resolved = await this.ctx.llm.resolveCallConfig({ provider: request.provider, model: request.model,
        ...(request.reasoningEffort ? { reasoningEffort: ReasoningEffortId(request.reasoningEffort) } : {}) })
      const selected = { provider: resolved.provider, model: resolved.model,
        ...(resolved.reasoningEffort ? { reasoningEffort: resolved.reasoningEffort } : {}) }
      const { blank: _blank, ...record } = current
      await configurations.save({ ...record, model: selected })
      return { selected }
    })
  }

  /** @param request - pending permission preset. @returns after saving choices, without activating an Agent. */
  @Remote('selectPermission')
  async selectPermission(request: { readonly sessionId: SessionId; readonly preset: string }): Promise<{ accepted: true }> {
    const configurations = this.configurations
    if (configurations === undefined) throw new Error('Deferred Session configuration is not enabled')
    return configurations.run(request.sessionId, async () => {
      const { blank: _blank, ...record } = await this.configuration(request.sessionId)
      // Validate on an unpublished copy, never mutate the executing Session.
      const temporary = this.ctx.sessions.prepare(undefined, { meta: { cwd: record.cwd } })
      configurations.applyPermission(temporary, request.preset)
      await configurations.save({ ...record, permissionPreset: request.preset })
      return { accepted: true }
    })
  }

  /**
   * Read all visible Session rows without resuming an Agent.
   * @param _request - reserved empty list request.
   * @param signal - cancellation for persistence reads and summary generation.
   * @returns visible Session summaries ordered by activity.
   */
  @Remote('list')
  async list(_request: SessionListRequest, signal: AbortSignal): Promise<SessionListValue> {
    const configurations = this.configurations
    const [persisted, drafts] = await Promise.all([this.listState.list(signal), configurations?.list() ?? []])
    const ids = new Set(persisted.map(item => item.sessionId))
    const decorated = configurations === undefined ? persisted
      : await Promise.all(persisted.map(item => configurations.decorate(item)))
    const items = [...decorated, ...drafts.filter(item => !ids.has(item.sessionId))]
      .filter(item => this.ctx.remoteAccess.allows({ kind: 'session', id: item.sessionId }))
    return { items: items.sort((left, right) => right.updatedAt - left.updatedAt) }
  }

  /**
   * Search visible Session content without resuming an Agent. A non-owner
   * receives only the hits whose Session `allows()` admits; `hasMore`
   * describes the bounded result before that filtering.
   * @param request - literal message-content query.
   * @param signal - cancellation for list and search reads.
   * @returns authorized bounded Session search results.
   */
  @Remote('search')
  async search(request: SessionSearchRequest, signal: AbortSignal): Promise<SessionSearchValue> {
    const result = await this.listState.search(request.query, signal)
    return { ...result, items: result.items.filter(item => this.ctx.remoteAccess.allows({ kind: 'session', id: item.sessionId })) }
  }

  /**
   * Create one ordinary Session for a new conversation, reusing the named blank Session while it is reusable.
   * @param request - optional blank Session to reuse, location, and Agent preset.
   * @returns the created or reused Session identity and its preset when configured.
   */
  @Remote('create')
  create(request: SessionCreateRequest): Promise<SessionCreateValue> {
    const policy = this.policy()
    const next = (value: SessionCreateRequest): Promise<SessionCreateValue> => this.createDraft(value)
    return policy?.create === undefined ? next(request) : policy.create(request, next, value => this.stageModel(value))
  }

  /**
   * Stage model choices in deferred mode; otherwise update the live Session and its default.
   * @param request - Session identity and requested model selection.
   * @returns the normalized selection installed for the Session, without waiting for default persistence.
   */
  @Remote('selectModel')
  selectModel(request: SessionSelectModelRequest): Promise<SessionSelectModelValue> {
    const policy = this.policy()
    const next = (value: SessionSelectModelRequest, persistDefault = true): Promise<SessionSelectModelValue> =>
      this.configurations ? this.stageModel(value) : this.commands.selectModel(value, persistDefault)
    return policy?.selectModel === undefined ? next(request) : policy.selectModel(request, next)
  }

  /**
   * Select the first available account model after login when no provider API key is configured.
   * @returns after saving the first available model or retaining the existing default.
   */
  @Remote
  async initializeDefaultModel(): Promise<void> {
    const provider = 'deepseek-account'
    if (await hasProviderApiKey(this.ctx)) return
    const catalog = await buildModelCatalog(this.ctx)
    const model = catalog.groups.find(group => group.id === provider)?.models[0]
    if (model === undefined) throw new RemoteError('session/provider-models-unavailable',
      `provider "${provider}" has no available models`, { provider })
    const selection = { provider, model: model.id,
      ...model.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(model.reasoning.defaultEffort) },
    }
    await this.ctx.agentDefaultModel.saveSelection(selection)
  }

  /**
   * Describe every currently routable model for Host-generation selectors.
   * @returns provider-grouped models, the deployment default, and isolated provider failures.
   */
  @Remote('modelCatalog')
  async modelCatalog(): Promise<ModelCatalog> {
    const policy = this.policy()
    const catalog = await buildModelCatalog(this.ctx)
    return policy?.modelCatalog === undefined ? catalog : policy.modelCatalog(catalog)
  }

  /**
   * Report whether this deployment can hand a Session workspace path to a native desktop.
   * @returns true when the matching open operation is available.
   */
  @Remote
  canOpenWorkspacePath(): boolean {
    return this.canOpenPath()
  }

  /**
   * Describe the serving desktop for authenticated file-action routes.
   * @returns Host name, configured availability, and platform-specific file-manager behavior.
   */
  workspaceDesktop(): { name: string; available: boolean; fileManager: 'finder' | 'explorer' | 'directory' | null } {
    const fileManager = nativeFileManager()
    return { name: hostname(), available: fileManager !== null && this.canOpenPath(), fileManager }
  }

  /**
   * Verify one path through the composed filesystem and open it on the Host desktop.
   * @param request - path after best-effort Session workspace resolution.
   * @param signal - caller lifetime; abort terminates the native command.
   * @returns confirmation after the native opener accepts the path.
   * @throws RemoteError when the request is invalid, has no verified Host mapping, is cancelled, or the opener fails.
   */
  @Remote('openWorkspacePath')
  async openWorkspacePath(
    request: SessionOpenWorkspacePathRequest,
    signal: AbortSignal,
  ): Promise<SessionOpenWorkspacePathValue> {
    try {
      const path = await this.verifyDesktopPath(request.path, signal)
      if (request.action === 'reveal') await this.revealPath(path, signal)
      else if (request.application !== undefined) await this.openFileApplication(path, request.application, signal)
      else await this.openPath(path, signal)
      return { opened: true }
    } catch (error: unknown) {
      if (signal.aborted) throw new RemoteError('gateway/cancelled', 'path open was aborted', {})
      if (error instanceof RemoteError) throw error
      throw new RemoteError(
        'gateway/internal',
        'path open failed',
        {},
        { cause: error },
      )
    }
  }

  /**
   * Query current file handlers on the serving desktop without activating an Agent.
   * @param request - file path in Host filesystem syntax.
   * @param signal - caller lifetime, propagated to filesystem and desktop queries.
   * @returns OS application names, icons, and default selection; empty when desktop opening is unavailable.
   * @throws RemoteError when the path is invalid, the query is cancelled, or native discovery fails.
   */
  @Remote('workspacePathApplications')
  async workspacePathApplications(
    request: { readonly path: string }, signal: AbortSignal,
  ): Promise<readonly SessionWorkspacePathApplication[]> {
    if (!this.canOpenPath()) return []
    try {
      const path = await this.verifyDesktopPath(request.path, signal)
      return await this.fileApplications(path, signal)
    } catch (error: unknown) {
      if (signal.aborted) throw new RemoteError('gateway/cancelled', 'application query was aborted', {})
      if (error instanceof RemoteError) throw error
      throw new RemoteError('gateway/internal', 'file application query failed', {}, { cause: error })
    }
  }

  private async verifyDesktopPath(path: string, signal: AbortSignal): Promise<string> {
    if (path.length === 0) throw new RemoteError('gateway/bad-request', 'A non-empty file path is required', {})
    signal.throwIfAborted()
    const hostPath = resolve(path)
    const { fs } = this.ctx
    const mapped = fs.processPathFromHostPath(hostPath)
    if (mapped === undefined || fs.processPath(await fs.resolve(mapped, { signal })) !== hostPath) {
      throw new RemoteError('gateway/bad-request', 'Path has no verified Host path', {})
    }
    signal.throwIfAborted()
    return hostPath
  }

  /**
   * Rename one Session after explicitly resuming it.
   * @param request - Session identity and proposed title.
   * @returns the accepted title and durable event sequence.
   */
  @Remote('rename')
  rename(request: SessionRenameRequest): Promise<SessionRenameValue> {
    return this.commands.rename(request)
  }

  /**
   * Fork one cold-readable exact event prefix into a new Session. An omitted
   * boundary selects the latest completed-turn prefix; an open cut receives
   * synthetic fork closers.
   * @param request - source Session, optional exact inclusive event boundary, and migration preflight choice.
   * @returns the new Session identity.
   */
  @Remote('fork')
  async fork(request: SessionForkRequest): Promise<SessionForkValue> {
    if (request.allowMigration === false && this.ctx.sessions.get(request.sessionId) === undefined) {
      const stored = await this.ctx.get('sessionPersistence')?.stat(request.sessionId)
      if (stored?.formatStatus === 'migration-required' && this.ctx.sessions.get(request.sessionId) === undefined) {
        throw new RemoteError('session/migration-required', 'Open the source Session to complete migration before forking', {
          sessionId: request.sessionId,
        })
      }
    }
    return this.commands.fork(request)
  }

  /**
   * Admit one prompt after explicitly resuming its Session.
   * @param request - Session identity, prompt content, source metadata, and delivery mode.
   * @param signal - caller cancellation before prompt admission begins.
   * @returns acknowledgement that the Agent accepted the prompt.
   */
  @Remote('prompt')
  async prompt(request: SessionPromptRequest, signal: AbortSignal): Promise<SessionPromptValue> {
    signal.throwIfAborted()
    const policy = this.policy()
    const next = (value: SessionPromptRequest): Promise<SessionPromptValue> => {
      signal.throwIfAborted()
      if (!hasPromptContent(value.content)) {
        throw new RemoteError('gateway/bad-request', 'prompt content must include non-whitespace text or an attachment', {})
      }
      const clientTimeZone = value.clientTimeZone === undefined
        ? undefined
        : canonicalClientTimeZone(value.clientTimeZone)
      if (value.clientTimeZone !== undefined && clientTimeZone === undefined) {
        throw new RemoteError(
          'session/invalid-time-zone',
          'clientTimeZone must be UTC or a valid IANA Area/Location name',
          { value: value.clientTimeZone },
        )
      }
      // The caller is recorded only when it is not the owner, so owner messages keep their exact source.
      const principal = principalOf(this.ctx.invocation)
      const source: MessageSource = {
        kind: 'user',
        rpcId: value.requestId,
        ...(clientTimeZone === undefined ? {} : { clientTimeZone }),
        ...(principal === undefined ? {} : { principal }),
      }
      return this.commands.prompt(value, source)
    }
    return policy?.prompt === undefined ? next(request) : policy.prompt(request, signal, next)
  }

  /**
   * Read one image proven reachable from the addressed Session log.
   * @param request - Session and attachment identities used for authorization.
   * @returns the durable attachment reference and base64-encoded bytes.
   */
  @Remote('attachment')
  attachment(request: SessionAttachmentRequest): Promise<SessionAttachmentValue> {
    return this.commands.attachment(request)
  }

  /**
   * Mutate one still-pending queue occurrence, resuming a cold Agent first.
   * @param request - Session, queue item, and requested mutation.
   * @returns acknowledgement that the queue mutation was applied.
   */
  @Remote('updateQueue')
  updateQueue(request: SessionUpdateQueueRequest): Promise<SessionUpdateQueueValue> {
    return this.commands.updateQueue(request)
  }

  /**
   * Cancel one active Agent turn without dropping its pending inbox.
   * @param request - Session whose active Agent turn is cancelled.
   * @returns acknowledgement that cancellation was requested.
   */
  @Remote('cancel')
  cancel(request: SessionCancelRequest): SessionCancelValue {
    return this.commands.cancel(request)
  }

  /**
   * Read one cold-safe, message-aligned Session history page.
   * @param request - durable address, backward cursor, and page budget.
   * @param signal - cancellation for persistence reads.
   * @returns one chronological page.
   */
  @Remote({ name: 'page', resources: { session: addressedSession } })
  page(request: SessionPageRequest, signal: AbortSignal): Promise<SessionPage> {
    return this.history.page(request, signal)
  }

  /**
   * Follow one Session log from its opening or resume cursor.
   * @param request - durable address and last committed sequence already held by the caller.
   * @param signal - cancellation owned by the Remote stream carrier.
   * @returns a complete opening snapshot followed by gap-free durable event
   *   frames and optional cursorless assistant-stream frames.
   */
  @Remote({ mode: 'stream', resources: { session: addressedSession } })
  follow(request: SessionFollowRequest, signal: AbortSignal): AsyncIterable<SessionFollowFrame> {
    return this.history.follow(request, signal)
  }

  /**
   * Read exact projections, returning cached hints only when migration is required.
   * @param request - Session whose current values are required.
   * @param signal - cancellation for the Session read.
   * @returns a sequenced baseline, cached hints when migration is deferred, or null when absent.
   */
  @Remote('projections')
  async projections(request: SessionProjectionsRequest, signal: AbortSignal): Promise<SessionProjectionsValue> {
    const { sessionId } = request
    if (sessionId.length === 0) {
      throw new RemoteError('gateway/bad-request', 'sessionId must not be empty', {})
    }
    try {
      signal.throwIfAborted()
      // Only deferred hosts pay for the draft lookup; others keep the synchronous live read.
      const draft = this.configurations === undefined ? undefined : await this.configurations.observe(sessionId)
      if (draft !== undefined) {
        using observation = draft
        return { kind: 'sequenced', asOfSeq: observation.cursor, values: { ...observation.projections?.values } as SessionProjectionValues }
      }
      signal.throwIfAborted()
      const live = this.liveProjections(sessionId)
      if (live !== undefined) return live
      const stored = await this.ctx.get('sessionPersistence')?.stat(sessionId, { signal })
      signal.throwIfAborted()
      const attached = this.liveProjections(sessionId)
      if (attached !== undefined) return attached
      if (stored === undefined) return null
      if (stored.formatStatus === 'migration-required') {
        const cached = this.ctx.get('sessionProjectionCache')?.cachedSnapshot(stored.header)
        return { kind: 'migration-required', values: { ...cached?.values } as SessionProjectionValues }
      }
      using observation = await this.ctx.sessionQuery.observeSession(sessionId, { signal })
      const projections = observation.projections
      if (projections === undefined) {
        throw new RemoteError('session/projections-unavailable', 'Session projections are unavailable', {})
      }
      return { kind: 'sequenced', asOfSeq: projections.asOfSeq, values: projections.values as SessionProjectionValues }
    } catch (error: unknown) {
      if (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
        return this.liveProjections(sessionId) ?? null
      }
      if (signal.aborted || (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_ABORTED')) {
        throw new RemoteError('gateway/cancelled', 'Session projection read was cancelled', {}, { cause: error })
      }
      if (error instanceof RemoteError) throw error
      throw new RemoteError('gateway/internal', 'Session projection read failed', {}, { cause: error })
    }
  }

  private liveProjections(
    sessionId: SessionId,
  ): Extract<SessionProjectionsValue, { readonly kind: 'sequenced' }> | undefined {
    const session = this.ctx.sessions.get(sessionId)
    if (session === undefined) return undefined
    const snapshot = this.ctx.sessionProjections.snapshot(session)
    return { kind: 'sequenced', asOfSeq: snapshot.asOfSeq, values: snapshot.values as SessionProjectionValues }
  }

  /**
   * Stream a complete live-control baseline followed by replacement frames.
   * @param signal - cancellation owned by the Remote stream carrier.
   * @returns one complete baseline followed by live replacement frames.
   */
  @Remote({ mode: 'stream' })
  async *control(signal: AbortSignal): AsyncIterable<SessionControlFrame> {
    for await (const frame of this.controlState.control(signal)) {
      switch (frame.type) {
        case 'baseline': {
          const projections = Object.fromEntries(Object.entries(frame.value.projections)
            .filter(([sessionId]) => this.ctx.remoteAccess.allows({ kind: 'session', id: sessionId as SessionId })))
          yield { type: 'baseline', value: { ...frame.value, projections } }
          break
        }
        case 'projection':
          if (this.ctx.remoteAccess.allows({ kind: 'session', id: frame.sessionId })) yield frame
          break
        /* v8 ignore next -- closed control-frame union. */
        default:
          assertNever(frame)
      }
    }
  }


}

export { buildModelCatalog }
export default SessionController
