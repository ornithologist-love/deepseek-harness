/**
 * The Full access acknowledgement shared by the composer trigger, the
 * `/permission` picker, and the General-settings row.
 *
 * The mirror and its durable field live here so the three surfaces read one
 * observable instead of keeping their own copy. Persistence rides the volatile
 * `fullAccessAcknowledged` field the Host half declares on this plugin's entry,
 * so a deployment configures nothing extra to keep the answer.
 */

import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { FULL_ACCESS_PRESET } from './presentation.ts'

/** Settings namespace: the Host entry id this package's row uses in the shipped profile. */
export const PERMISSION_CLIENT_SETTINGS_NAMESPACE = 'ui-permission'

/** Field recording that the user already acknowledged Full access once. */
export const FULL_ACCESS_ACKNOWLEDGED_FIELD = 'fullAccessAcknowledged'

/** Durable section this package owns in the Host user-settings document. */
export interface PermissionClientSettings {
  /** True once any surface recorded an explicit Full access confirmation. */
  [FULL_ACCESS_ACKNOWLEDGED_FIELD]?: boolean
}

/** Explicit Full access acknowledgement as every surface reads it. */
export class PermissionAcknowledgement {
  /** Reactive mirror bound by the renderer as `useFullAccessAcknowledged`. */
  readonly acknowledged: SnapshotStore<boolean>

  private readonly stop: () => void

  /**
   * @param host - durable settings scope owned by this package.
   * @param initial - value for a deployment whose surfaces cannot persist
   * (the first accepted document replaces it once it arrives).
   */
  constructor(
    private readonly host: ConfigForm<PermissionClientSettings>,
    initial = false,
  ) {
    this.acknowledged = createSnapshotStore(initial)
    this.stop = host.subscribe(() => { this.adopt() })
    this.adopt()
  }

  /** Release the accepted-value subscription. */
  dispose(): void { this.stop() }

  /**
   * Record one explicit confirmation and persist it for later surfaces.
   *
   * A refused or unavailable write leaves the mirror set for this browser
   * session rather than promising durability it did not get.
   * @param remember - whether this deployment keeps the answer across restarts.
   */
  acknowledgeFullAccess(remember: boolean): void {
    this.acknowledged.set(true)
    if (!remember) return
    void this.host.set(FULL_ACCESS_ACKNOWLEDGED_FIELD, true).catch((_error: unknown) => {
      // The current browser session keeps the answer it just recorded.
    })
  }

  /**
   * Whether a pick of `preset` still needs the explicit risk confirmation.
   * @param preset - preset value the user selected.
   * @param remember - whether this deployment keeps an earlier Full access answer.
   * @returns true for Full access until it is acknowledged, and false for
   * every other preset (Auto review keeps its own always-on gate).
   */
  requiresConfirmation(preset: string, remember: boolean): boolean {
    return preset === FULL_ACCESS_PRESET
      && !(remember && this.acknowledged.getSnapshot())
  }

  /** Adopt the latest accepted Host value without writing it back. */
  private adopt(): void {
    const section = this.host.getSnapshot().value
    if (section === undefined) return
    const remembered = section[FULL_ACCESS_ACKNOWLEDGED_FIELD] === true
    if (this.acknowledged.getSnapshot() !== remembered) this.acknowledged.set(remembered)
  }
}
