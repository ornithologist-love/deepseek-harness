/** The permission-surface Host configuration and its page-bootstrap payload. */
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { apply, Config } from '../src/index.ts'
import { PERMISSION_OPTIONS_GLOBAL } from '../src/permission-options.ts'

type PublishListener = (table: IndexInjection[]) => void

/** Settings presentation options one mount passed to `settings.configure`. */
type SettingsPresentation = Record<string, unknown>

/** The Host context members this apply touches. */
interface PublisherContext {
  fiber: object
  on(event: string, listener: PublishListener): void
  inject(deps: string[], callback: (child: SettingsChild) => void): void
}

/** The injected child that serves the volatile settings form. */
interface SettingsChild {
  effect(effect: () => () => void): void
  settings: { configure(presentation: SettingsPresentation, fiber: object): () => void }
}

/** Mount the Host plugin over a stand-in context and emit its index table. */
function publisher(): {
  configured: { presentation: SettingsPresentation; fiber: object }[]
  publish(config: Parameters<typeof apply>[1]): IndexInjection[]
} {
  const listeners: PublishListener[] = []
  const configured: { presentation: SettingsPresentation; fiber: object }[] = []
  const context: PublisherContext = {
    fiber: {},
    on: (_event, listener) => { listeners.push(listener) },
    inject: (_deps, callback) => {
      callback({
        effect: (effect) => { effect() },
        settings: {
          configure: (presentation, fiber) => {
            configured.push({ presentation, fiber })
            return () => {}
          },
        },
      })
    },
  }
  return {
    configured,
    publish(config) {
      apply(context as Context, config)
      const table: IndexInjection[] = []
      for (const listener of listeners) listener(table)
      return table
    },
  }
}

describe('permission-surface Host configuration', () => {
  it('keeps today’s presentation under the declared defaults', () => {
    const defaults = Config({})
    expect(defaults).toMatchObject({ colors: {}, rememberFullAccess: false, hiddenAgentPresets: [] })
    expect(defaults.fullAccessAcknowledged.get()).toBe(false)
    expect(publisher().publish(Config({}))).toEqual([{
      kind: 'global',
      name: PERMISSION_OPTIONS_GLOBAL,
      value: { colors: {}, rememberFullAccess: false, hiddenAgentPresets: [] },
    }])
  })

  it('publishes the deployment choices into the browser page', () => {
    const config = Config({
      colors: { 'read-only': 'var(--brand-accent)' },
      rememberFullAccess: true,
      hiddenAgentPresets: ['remote-review'],
    })
    expect(publisher().publish(config)).toEqual([{
      kind: 'global',
      name: PERMISSION_OPTIONS_GLOBAL,
      value: {
        colors: { 'read-only': 'var(--brand-accent)' },
        rememberFullAccess: true,
        hiddenAgentPresets: ['remote-review'],
      },
    }])
  })

  it('rejects a malformed configuration instead of defaulting it', () => {
    expect(Config['~standard'].validate({ rememberFullAccess: 'yes' })).toHaveProperty('issues')
    expect(Config['~standard'].validate({ hiddenAgentPresets: 'remote-review' })).toHaveProperty('issues')
    expect(Config['~standard'].validate({ colors: { 'read-only': 1 } })).toHaveProperty('issues')
  })

  it('serves the acknowledgement as a user setting kept off the General page', () => {
    const host = publisher()
    host.publish(Config({}))
    expect(host.configured.map(entry => entry.presentation)).toEqual([{ auto: false }])
  })

  it('appends its current row on every index render', () => {
    // The listener reads the mounted plugin's options at emit time, so the row
    // repeats on each render (and each worker boot-payload request) instead of
    // being captured once.
    expect(publisher().publish(Config({}))).toHaveLength(1)
  })
})
