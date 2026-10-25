/**
 * Deployment-owned Workspace presentation: icons, pinning, the ungrouped
 * heading, new-session behavior and row visibility. Workspace membership and
 * Session history stay Host-owned; this service only changes what the sidebar,
 * the picker and the new-session action present.
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'

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
  private readonly listeners = new Set<() => void>()

  /** @param ctx - Client root Context. */
  constructor(ctx: Context) {
    super(ctx, 'workspacePresentation')
  }

  /** @returns the registered provider's snapshot, or the default presentation. */
  getSnapshot = (): WorkspacePresentationSnapshot => this.source?.getSnapshot() ?? DEFAULT_WORKSPACE_PRESENTATION

  /**
   * @param listener - called after the presentation changes.
   * @returns unsubscribe function.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
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
    for (const listener of [...this.listeners]) listener()
  }
}
