/**
 * Deployment-owned Workspace presentation: icons, pinning, the ungrouped
 * heading, new-session behavior and row visibility. Workspace membership and
 * Session history stay Host-owned; this service only changes what the sidebar,
 * the picker and the new-session action present.
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionNode } from './tree.ts'
import type { DirectoryListing } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identity of a catalog's external Host. */
export type ExternalWorkspaceHostId = Branded<'ExternalWorkspaceHostId'>

/** Host-scoped Workspace identity used only for navigation. */
export type ExternalWorkspaceKey = Branded<'ExternalWorkspaceKey'>

/** Navigation projections remain scoped to their source Host. */
export interface ExternalWorkspaceCatalog {
  readonly localHost?: { readonly name: string; readonly platform: string } | undefined
  readonly hosts: readonly { readonly id: ExternalWorkspaceHostId; readonly name: string; readonly hostname?: string; readonly platform?: string;
    readonly address?: string; readonly online: boolean; readonly canAdd: boolean }[]
  /** Browse a directory on its owning Host. */
  readonly listDirectory: (hostId: ExternalWorkspaceHostId, path?: string, signal?: AbortSignal) => Promise<DirectoryListing>
  /** Create a directory on its owning Host. */
  readonly createDirectory: (hostId: ExternalWorkspaceHostId, path: string, name: string) => Promise<string>
  /** Adopt a directory into the external Host's Workspace controller. */
  readonly addWorkspace: (hostId: ExternalWorkspaceHostId, path: string) => Promise<void>
  readonly items: readonly {
    readonly key: ExternalWorkspaceKey
    readonly hostId: ExternalWorkspaceHostId
    readonly hostName: string
    readonly workspaceId: WorkspaceId
    readonly title: string
    readonly path: string
    readonly online: boolean
    readonly sessions: readonly SessionNode[]
  }[]
  readonly activeKey?: ExternalWorkspaceKey | undefined
  readonly activeSessionId?: SessionId | undefined
  readonly error?: string | undefined
  /** Open a Session through its owning Host's navigation. */
  readonly open: (key: ExternalWorkspaceKey, sessionId: SessionId) => void
  /** Create a Session through its owning Host's Workspace. */
  readonly create: (key: ExternalWorkspaceKey) => void
}



/** Image shown in place of the folder icon for one Workspace. */
export interface WorkspacePresentationIcon {
  /** Image URL. */
  readonly src: string
  /** Alternative text. */
  readonly alt: string
  /** Hover text; absent shows none. */
  readonly title?: string
  /** Accessible name; absent uses the alternative text. */
  readonly ariaLabel?: string
}

/** Presentation inputs supplied by one deployment-owned provider. */
export interface WorkspacePresentationSnapshot {
  /** Additional Host-owned Workspace navigation; never enters local controllers. */
  readonly external?: ExternalWorkspaceCatalog | undefined
  /** Per-Workspace display entries; Workspaces without one keep the default presentation. */
  readonly items: readonly {
    readonly workspaceId: WorkspaceId
    /** Pinned Workspaces list before the others, keeping their relative order. */
    readonly pinned?: boolean
    /** Image shown in the sidebar row and the picker in place of the folder icon. */
    readonly icon?: WorkspacePresentationIcon
  }[]
  /**
   * `recent` titles the ungrouped bucket "Recent", keeps it expanded with a
   * non-collapsible heading, and flattens idle Session rows.
   */
  readonly ungrouped: 'group' | 'recent'
  /**
   * `fresh` makes New session create a Session every time (concurrent requests
   * for one Workspace share one creation) and creates one at startup when
   * nothing is restored; `inherit` reuses the current blank Session.
   */
  readonly newSession: 'inherit' | 'fresh'
  /** Sessions the sidebar omits; membership and history are unchanged. */
  readonly excludedSessionIds?: readonly string[]
  /** When present, the sidebar lists only these Sessions, so unclassified rows never flash. */
  readonly classifiedSessionIds?: readonly string[]
  /** When present, a Workspace row menu offers Edit, calling this, instead of Rename. */
  readonly editWorkspace?: (workspaceId: WorkspaceId) => void
}

/** Observable Workspace presentation with at most one registered provider. */
export interface WorkspacePresentation extends HostObservable<WorkspacePresentationSnapshot> {
  /**
   * Install the deployment's presentation source.
   * @param source - observable presentation inputs.
   * @returns disposer that restores the default presentation.
   * @throws Error when another provider is already registered.
   */
  register(source: HostObservable<WorkspacePresentationSnapshot>): () => void
  /**
   * Register one independent external catalog.
   * @param source - observable Host-owned navigation entries.
   * @returns disposer releasing the external catalog.
   */
  registerExternal(source: HostObservable<ExternalWorkspaceCatalog>): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Deployment-owned Workspace presentation inputs. */
    workspacePresentation: WorkspacePresentation
  }
}

/** Presentation in effect while no provider is registered. */
export const DEFAULT_WORKSPACE_PRESENTATION: WorkspacePresentationSnapshot = {
  items: [], ungrouped: 'group', newSession: 'inherit',
}

/** Holds the single registered presentation source and republishes its changes. */
export class WorkspacePresentationService extends Service implements WorkspacePresentation {
  private source: HostObservable<WorkspacePresentationSnapshot> | undefined
  private external: HostObservable<ExternalWorkspaceCatalog> | undefined
  private snapshot = DEFAULT_WORKSPACE_PRESENTATION
  private readonly listeners = new Set<() => void>()

  /** @param ctx - Client root Context. */
  constructor(ctx: Context) {
    super(ctx, 'workspacePresentation')
  }

  /** @returns the registered provider's snapshot, or the default presentation. */
  getSnapshot = (): WorkspacePresentationSnapshot => this.snapshot

  /**
   * @param listener - called after the presentation changes.
   * @returns unsubscribe function.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  registerExternal(source: HostObservable<ExternalWorkspaceCatalog>): () => void {
    if (this.external !== undefined) throw new Error('external workspaces already have a provider')
    this.external = source
    const off = source.subscribe(this.publish)
    this.publish()
    return () => { off(); if (this.external === source) { this.external = undefined; this.publish() } }
  }

  register(source: HostObservable<WorkspacePresentationSnapshot>): () => void {
    if (this.source !== undefined) throw new Error('workspacePresentation already has a provider')
    const unsubscribe = source.subscribe(this.publish)
    this.source = source
    this.publish()
    return () => {
      unsubscribe()
      this.source = undefined
      this.publish()
    }
  }

  private readonly publish = (): void => {
    this.snapshot = { ...(this.source?.getSnapshot() ?? DEFAULT_WORKSPACE_PRESENTATION), external: this.external?.getSnapshot() }
    for (const listener of [...this.listeners]) listener()
  }
}
