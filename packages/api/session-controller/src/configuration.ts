/** Durable composer configuration, independent of Agent and Session-log ownership. */
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION, Session, SessionId, SessionLogOffset, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SessionObservation } from '@deepseek-ai/dsh-session-query'
import { z } from 'zod'
import type { ModelSelection, SessionSummary, SessionProjectionValues } from './types.ts'

const recordSchema = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9._-]{1,256}$/),
  cwd: z.string().refine(isAbsolute),
  createdAt: z.number().int().nonnegative(),
  agentPreset: z.string().optional(),
  draft: z.boolean(),
  model: z.object({ provider: z.string(), model: z.string(), reasoningEffort: z.string().optional() }).optional(),
  events: z.array(z.custom<SessionEvent>(value => typeof value === 'object' && value !== null)).optional(),
  permissionPreset: z.string().optional(),
  revision: z.number().int().nonnegative().default(0),
})

/** Saved pre-execution choices; draft records have no Session log or live Agent. */
export interface SessionConfiguration {
  readonly sessionId: SessionId
  readonly cwd: string
  readonly createdAt: number
  readonly agentPreset?: string | undefined
  readonly draft: boolean
  readonly model?: ModelSelection | undefined
  readonly events?: readonly SessionEvent[] | undefined
  readonly permissionPreset?: string | undefined
  readonly revision?: number | undefined
}

/** Owns serialized configuration writes and the draft-to-execution transition. */
export class SessionConfigurations {
  private readonly records = new Map<SessionId, SessionConfiguration>()
  private readonly operations = new Map<SessionId, Promise<unknown>>()
  private readonly ready: Promise<void>

  /**
   * @param ctx - Session readers and projections.
   * @param directory - product-owned configuration directory.
   * @param applyPermission - installs one saved permission preset on a Session.
   */
  constructor(private readonly ctx: Context, private readonly directory: string,
    readonly applyPermission: (session: Session, preset: string) => void) {
    this.ready = this.load()
    ctx.effect(() => ctx.workspaceRegistry.registerSessionSource(async () => {
      await this.ready
      return this.unexecuted().map(record => this.header(record))
    }), 'session configuration workspace headers')
    ctx.effect(() => async () => { await Promise.allSettled([...this.operations.values()]) }, 'session configuration writes')
    const refresh = this.ready.then(() => ctx.workspaceRegistry.refreshSessionHeaders())
    void refresh.catch((error: unknown) => ctx.logger.error(`Session draft headers failed to load: ${String(error)}`))
    ctx.effect(() => async () => { await refresh }, 'session configuration workspace initialization')
  }

  private async load(): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    for (const file of await readdir(this.directory)) {
      if (!file.endsWith('.json')) continue
      const value = recordSchema.parse(JSON.parse(await readFile(join(this.directory, file), 'utf8')))
      const { model: _model, ...fields } = value
      const record: SessionConfiguration = { ...fields, sessionId: SessionId(value.sessionId),
        ...(value.model ? { model: { provider: value.model.provider, model: value.model.model,
          ...(value.model.reasoningEffort ? { reasoningEffort: value.model.reasoningEffort } : {}) } } : {}) }
      if (file !== record.sessionId + '.json') throw new Error('Session configuration identity differs from its filename')
      // A process can exit after publishing the first Agent but before retiring its draft.
      const persisted = await this.ctx.get('sessionPersistence')?.stat(record.sessionId)
      this.records.set(record.sessionId, { ...record, draft: !persisted })
    }
  }

  /** @param id - Session identity. @returns detached choices, without opening an Agent. */
  async read(id: SessionId): Promise<SessionConfiguration | undefined> {
    await this.ready
    return structuredClone(this.records.get(id))
  }

  /** @param id - Session identity. @param operation - one configuration or execution transition. @returns its result. */
  run<T>(id: SessionId, operation: () => Promise<T>): Promise<T> {
    const previous = this.operations.get(id)
    const pending = (previous ? previous.catch(() => {}) : this.ready).then(operation)
    this.operations.set(id, pending)
    void pending.finally(() => { if (this.operations.get(id) === pending) this.operations.delete(id) }).catch(() => {})
    return pending
  }

  /** Call inside run(). @param value - validated choices. */
  async save(value: SessionConfiguration): Promise<void> {
    const previous = this.records.get(value.sessionId)
    value = { ...value, revision: (previous?.revision ?? 0) + 1 }
    if (value.draft) {
      const prior = this.records.get(value.sessionId)
      // Draft logs are independent scratch Sessions; they enter the store only at execution.
      const session = this.restore({ ...value, events: prior?.events ?? [] })
      if (value.agentPreset && (!prior || prior.agentPreset !== value.agentPreset)) session.append('agent-preset/selected', { agentPreset: value.agentPreset })
      if (value.model && JSON.stringify(value.model) !== JSON.stringify(prior?.model)) session.append('model/selection', agentSelection(value.model))
      if (value.permissionPreset && value.permissionPreset !== prior?.permissionPreset) {
        this.applyPermission(session, value.permissionPreset)
      }
      value = { ...value, events: session.snapshotEvents() }
    }
    recordSchema.parse(value)
    const target = join(this.directory, value.sessionId + '.json')
    const temporary = target + '.' + randomUUID() + '.tmp'
    try {
      await writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
      await rename(temporary, target)
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
    }
    this.records.set(value.sessionId, structuredClone(value))
    if (!previous || previous.cwd !== value.cwd || previous.draft !== value.draft) {
      await this.ctx.workspaceRegistry.refreshSessionHeaders()
    }
    this.ctx.emit('api-session/added', value.draft ? this.summary(value) : await this.summaryForPersisted(value))
  }

  private async summaryForPersisted(value: SessionConfiguration): Promise<SessionSummary> {
    using observation = await this.ctx.sessionQuery.observeSession(value.sessionId)
    const live = this.ctx.agents.get(value.sessionId)
    const projected = observation.projections?.values
    const modelSelection = value.model
      ? { modelSelection: { lastUsed: projected?.modelSelection?.lastUsed ?? null, next: value.model } }
      : {}
    return { sessionId: value.sessionId, ...(observation.header.cwd ? { cwd: observation.header.cwd } : {}),
      updatedAt: Math.max(observation.header.createdAt, projected?.sessionListMetadata?.lastPromptAt ?? 0),
      configuration: this.choices(value, observation),
      agentAvailable: live !== undefined, running: live?.status === 'running',
      blank: !observation.events.some(event => event.type === 'turn/start'),
      projections: { kind: live ? 'sequenced' : 'cached', asOfSeq: observation.cursor,
        values: { ...projected, ...modelSelection } as SessionProjectionValues } }
  }

  /** @returns drafts that have not entered the execution lifecycle. */
  async list(): Promise<SessionSummary[]> {
    await this.ready
    return this.unexecuted().map(value => this.summary(value))
  }

  /** @param summary - durable Session summary. @returns the summary with independently versioned pending choices. */
  async decorate(summary: SessionSummary): Promise<SessionSummary> {
    const record = await this.read(summary.sessionId)
    if (!record) return summary
    // A stale read cut carries its own model view, which supersedes the stored selection.
    using observation = record.model || record.draft ? await this.ctx.sessionQuery.observeSession(summary.sessionId) : undefined
    return { ...summary, configuration: this.choices(record, observation) }
  }

  private unexecuted(): SessionConfiguration[] {
    return [...this.records.values()].filter(value => value.draft && !this.ctx.sessions.get(value.sessionId))
  }

  private summary(value: SessionConfiguration): SessionSummary {
    using observation = this.observeRecord(value)
    return { sessionId: value.sessionId, cwd: value.cwd, updatedAt: value.createdAt,
      configuration: this.choices(value, observation),
      agentAvailable: false, running: false, blank: true,
      projections: { kind: 'sequenced', asOfSeq: observation.cursor, values: (observation.projections?.values ?? {}) as SessionProjectionValues } }
  }

  private choices(value: SessionConfiguration, observation?: SessionObservation): NonNullable<SessionSummary['configuration']> {
    const selected = value.model
      ? { modelSelection: { lastUsed: observation?.projections?.values.modelSelection?.lastUsed ?? null, next: value.model } }
      : {}
    const permissions = value.permissionPreset ? { permissions: { currentValue: value.permissionPreset } } : {}
    return { revision: value.revision ?? 0, values: { ...(value.draft ? observation?.projections?.values ?? {} : {}),
      ...selected, ...permissions } as SessionProjectionValues }
  }

  /** @param id - Session identity. @returns a read-only draft cut, or undefined for durable history. */
  async observe(id: SessionId): Promise<SessionObservation | undefined> {
    const value = await this.read(id)
    return value?.draft && !this.ctx.sessions.get(id) ? this.observeRecord(value) : undefined
  }

  private observeRecord(value: SessionConfiguration): SessionObservation {
    const session = this.restore(value)
    const projected = this.ctx.sessionProjections.snapshot(session)
    const observation: SessionObservation = {
      source: 'prepared', header: session.header, events: session.snapshotEvents(), cursor: value.events?.at(-1)?.seq ?? -1, inheritedEventCount: SessionLogOffset(0),
      projections: { ...projected, values: { ...projected.values,
        ...(value.model ? { modelSelection: { lastUsed: null, next: agentSelection(value.model) } } : {}) } },
      retain: () => this.observeRecord(value), [Symbol.dispose]: () => {},
    }
    return observation
  }

  private header(value: SessionConfiguration): SessionHeader {
    return { version: SESSION_FORMAT_VERSION, id: value.sessionId, createdAt: value.createdAt,
      cwd: value.cwd, isSeeded: false, ...(value.agentPreset ? { agentPreset: value.agentPreset } : {}) }
  }

  private restore(value: SessionConfiguration): Session {
    return Session.create(value.sessionId, structuredClone([...(value.events ?? [])]), this.header(value),
      SessionLogOffset(0), this.ctx.sessions.messageProjections)
  }
}

/** Brand a stored selection's reasoning effort for the Agent model vocabulary. */
function agentSelection(model: ModelSelection): { provider: string; model: string; reasoningEffort?: ReasoningEffortId } {
  return { provider: model.provider, model: model.model,
    ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(model.reasoningEffort) }) }
}
