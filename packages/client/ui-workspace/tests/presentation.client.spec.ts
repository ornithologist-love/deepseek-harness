import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_WORKSPACE_PRESENTATION, WorkspacePresentationService, type WorkspacePresentationSnapshot,
} from '../src/client/presentation.ts'
import { Config, parseSessionNavigation, SESSION_NAVIGATION_GLOBAL, WORKSPACE_OPTIONS_GLOBAL } from '../src/workspace-options.ts'
import { apply as hostApply } from '../src/index.ts'

const pinned: WorkspacePresentationSnapshot = {
  items: [{ workspaceId: 'a' as WorkspaceId, pinned: true }], ungrouped: 'recent', newSession: 'fresh',
}

describe('WorkspacePresentationService', () => {
  it('serves the default presentation until a provider registers, then follows the provider', () => {
    const service = new WorkspacePresentationService(new Context())
    const listener = vi.fn()
    const unsubscribe = service.subscribe(listener)
    expect(service.getSnapshot()).toBe(DEFAULT_WORKSPACE_PRESENTATION)
    const source = createSnapshotStore(pinned)
    const dispose = service.register(source)
    expect(service.getSnapshot()).toBe(pinned)
    expect(listener).toHaveBeenCalledOnce()
    const next = { ...pinned, ungrouped: 'group' as const }
    source.set(next)
    expect(service.getSnapshot()).toBe(next)
    expect(listener).toHaveBeenCalledTimes(2)
    dispose()
    expect(service.getSnapshot()).toBe(DEFAULT_WORKSPACE_PRESENTATION)
    expect(listener).toHaveBeenCalledTimes(3)
    source.set(pinned)
    expect(listener).toHaveBeenCalledTimes(3)
    unsubscribe()
    service.register(createSnapshotStore(pinned))
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('refuses a second provider while one is registered', () => {
    const service = new WorkspacePresentationService(new Context())
    service.register(createSnapshotStore(pinned))
    expect(() => service.register(createSnapshotStore(pinned))).toThrow('workspacePresentation already has a provider')
  })
})

describe('Workspace startup options', () => {
  it('defaults to restoring the previous main view', () => {
    expect(Config({})).toEqual({ restoreOnStartup: true })
  })

  it('reads the startup selection a page carries', () => {
    expect(parseSessionNavigation(undefined)).toBeUndefined()
    expect(parseSessionNavigation({})).toEqual({})
    expect(parseSessionNavigation({ sessionId: 's1' })).toEqual({ sessionId: 's1' })
    expect(() => parseSessionNavigation({ sessionId: 1 })).toThrow()
  })
})

describe('ui-workspace Host half', () => {
  type Row = { kind: string; name: string; value: unknown }
  const bootstrap = (ctx: Context): Row[] => {
    const table: Row[] = []
    ctx.emit('webserver/index-inject', table as never)
    return table
  }

  it('publishes nothing for default options without a navigation input', () => {
    const ctx = new Context()
    hostApply(ctx, Config({}))
    expect(bootstrap(ctx)).toEqual([])
  })

  it('publishes disabled restoration and the current navigation input for every page', () => {
    const ctx = new Context()
    let current: { sessionId?: SessionId } = { sessionId: 's1' as SessionId }
    ctx.provide('sessionNavigationInput', { current: () => current })
    hostApply(ctx, Config({ restoreOnStartup: false }))
    expect(bootstrap(ctx)).toEqual([
      { kind: 'global', name: WORKSPACE_OPTIONS_GLOBAL, value: { restoreOnStartup: false } },
      { kind: 'global', name: SESSION_NAVIGATION_GLOBAL, value: { sessionId: 's1' } },
    ])
    current = {}
    expect(bootstrap(ctx).at(-1)).toEqual({ kind: 'global', name: SESSION_NAVIGATION_GLOBAL, value: {} })
  })
})
