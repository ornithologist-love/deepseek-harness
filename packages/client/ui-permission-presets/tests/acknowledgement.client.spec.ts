/** The shared Full access acknowledgement mirror and its durable field. */
import { describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  FULL_ACCESS_ACKNOWLEDGED_FIELD, PERMISSION_CLIENT_SETTINGS_NAMESPACE,
  PermissionAcknowledgement, type PermissionClientSettings,
} from '../src/client/acknowledgement.ts'

/** A configuration form whose accepted section a spec moves by hand. */
function form(initial?: PermissionClientSettings) {
  const store = createSnapshotStore<ConfigFormSnapshot<PermissionClientSettings>>({
    status: initial === undefined ? 'loading' : 'ready',
    value: initial,
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
  })
  const set = vi.fn(() => Promise.resolve(true))
  const configForm: ConfigForm<PermissionClientSettings> = {
    getSnapshot: () => store.getSnapshot(),
    subscribe: listener => store.subscribe(listener),
    mutate: () => Promise.resolve(true),
    set,
    unset: () => Promise.resolve(true),
  }
  return { configForm, set, store }
}

describe('PermissionAcknowledgement', () => {
  it('owns the settings namespace and field the answer is written to', () => {
    expect(PERMISSION_CLIENT_SETTINGS_NAMESPACE).toBe('ui-permission')
    expect(FULL_ACCESS_ACKNOWLEDGED_FIELD).toBe('fullAccessAcknowledged')
  })

  it('records and persists one confirmation through this package settings form', () => {
    const { configForm, set } = form({ [FULL_ACCESS_ACKNOWLEDGED_FIELD]: false })
    const acknowledgement = new PermissionAcknowledgement(configForm, true)
    expect(acknowledgement.acknowledged.getSnapshot()).toBe(false)

    acknowledgement.acknowledgeFullAccess(true)

    expect(acknowledgement.acknowledged.getSnapshot()).toBe(true)
    expect(set).toHaveBeenCalledExactlyOnceWith(FULL_ACCESS_ACKNOWLEDGED_FIELD, true)
    acknowledgement.dispose()
  })

  it('keeps the answer in this browser session when the deployment remembers nothing', () => {
    const { configForm, set } = form()
    const acknowledgement = new PermissionAcknowledgement(configForm, false)

    acknowledgement.acknowledgeFullAccess(false)

    expect(acknowledgement.acknowledged.getSnapshot()).toBe(true)
    expect(set).not.toHaveBeenCalled()
    acknowledgement.dispose()
  })

  it('survives a refused or unreachable write', async () => {
    const { configForm, set, store } = form()
    set.mockImplementation(() => Promise.reject(new Error('settings disconnected')))
    const acknowledgement = new PermissionAcknowledgement(configForm, true)

    acknowledgement.acknowledgeFullAccess(true)
    await Promise.resolve()
    await Promise.resolve()

    expect(acknowledgement.acknowledged.getSnapshot()).toBe(true)
    // A later accepted section is the authority again.
    store.set({ ...store.getSnapshot(), status: 'ready', value: { [FULL_ACCESS_ACKNOWLEDGED_FIELD]: false } })
    expect(acknowledgement.acknowledged.getSnapshot()).toBe(false)
    acknowledgement.dispose()
  })

  it('adopts the accepted Host section and stops following after disposal', () => {
    const { configForm, store } = form({ [FULL_ACCESS_ACKNOWLEDGED_FIELD]: true })
    const acknowledgement = new PermissionAcknowledgement(configForm, false)
    expect(acknowledgement.acknowledged.getSnapshot()).toBe(true)

    store.set({ ...store.getSnapshot(), value: { [FULL_ACCESS_ACKNOWLEDGED_FIELD]: false } })
    expect(acknowledgement.acknowledged.getSnapshot()).toBe(false)

    acknowledgement.dispose()
    store.set({ ...store.getSnapshot(), value: { [FULL_ACCESS_ACKNOWLEDGED_FIELD]: true } })
    expect(acknowledgement.acknowledged.getSnapshot()).toBe(false)
  })

  it('keeps the seeded value until a section arrives, and republishes only on change', () => {
    const { configForm, store } = form()
    const listener = vi.fn()
    const acknowledgement = new PermissionAcknowledgement(configForm, true)
    expect(acknowledgement.acknowledged.getSnapshot()).toBe(true)
    acknowledgement.acknowledged.subscribe(listener)

    // A section repeating the held answer publishes nothing.
    store.set({ ...store.getSnapshot(), status: 'ready', value: { [FULL_ACCESS_ACKNOWLEDGED_FIELD]: true } })
    expect(listener).not.toHaveBeenCalled()
    // A section that never carries the field reads as not acknowledged.
    store.set({ ...store.getSnapshot(), value: {} })
    expect(acknowledgement.acknowledged.getSnapshot()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)
    acknowledgement.dispose()
  })

  it('asks for Full access until it is acknowledged, and never for other presets', () => {
    const { configForm } = form()
    const acknowledgement = new PermissionAcknowledgement(configForm, false)
    expect(acknowledgement.requiresConfirmation('danger-full-access', true)).toBe(true)
    expect(acknowledgement.requiresConfirmation('danger-full-access', false)).toBe(true)

    acknowledgement.acknowledgeFullAccess(true)

    // Remembering a deployment suppresses the gate; not remembering keeps it.
    expect(acknowledgement.requiresConfirmation('danger-full-access', true)).toBe(false)
    expect(acknowledgement.requiresConfirmation('danger-full-access', false)).toBe(true)
    // Auto review owns its own always-on gate, and ordinary presets ask nothing.
    expect(acknowledgement.requiresConfirmation('auto', true)).toBe(false)
    expect(acknowledgement.requiresConfirmation('read-only', true)).toBe(false)
    acknowledgement.dispose()
  })
})
