import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished } from 'vitest'
import * as HostPlugin from '../src/index.ts'
import { liveConfig, omitsGeneratedPage } from '../../../settings/settings/tests/live-config.ts'
import { plainConfig } from '../../../settings/settings/src/schema.ts'
import {
  DEFAULT_BUSY_ENTER_BEHAVIOR,
} from '@deepseek-ai/dsh-client-ui-conversation'
import { CONVERSATION_OPTIONS_GLOBAL, PresentationOptions } from '../src/presentation-options.ts'


describe('ui-conversation host', () => {
  it('registers, validates, and disposes the durable busy-Enter preference', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const configuration = await liveConfig(ctx, HostPlugin)
    const { fiber } = configuration
    expect(plainConfig(configuration.fiber.effectiveConfig)).toEqual({ showHeroText: true, busyEnter: DEFAULT_BUSY_ENTER_BEHAVIOR })
    await configuration.update({ busyEnter: 'steer' })
    expect(plainConfig(configuration.fiber.effectiveConfig)).toEqual({ showHeroText: true, busyEnter: 'steer' })
    await expect(configuration.update({ busyEnter: 'invalid' })).rejects.toThrow()
    await fiber.dispose()
  })
})

it('keeps its own instance off the generated Settings pages', () => omitsGeneratedPage(async (ctx) => {
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  return ctx.plugin(HostPlugin)
}))

describe('ui-conversation presentation options', () => {
  type Row = { kind: string; name: string; value: unknown }
  const bootstrap = (ctx: Context): Row[] => {
    const table: Row[] = []
    ctx.emit('webserver/index-inject', table as never)
    return table
  }

  it('publishes nothing while every presentation option keeps its default', () => {
    const ctx = new Context()
    HostPlugin.apply(ctx, HostPlugin.Config({}))
    expect(bootstrap(ctx)).toEqual([])
  })

  it('publishes only the presentation options the deployment changed', () => {
    const hidden = new Context()
    HostPlugin.apply(hidden, HostPlugin.Config({ showHeroText: false }))
    expect(bootstrap(hidden)).toEqual([{ kind: 'global', name: CONVERSATION_OPTIONS_GLOBAL, value: { showHeroText: false } }])
    const labelled = new Context()
    HostPlugin.apply(labelled, HostPlugin.Config({ unboundWorkspaceLabel: 'Scratch' }))
    expect(bootstrap(labelled)).toEqual([
      { kind: 'global', name: CONVERSATION_OPTIONS_GLOBAL, value: { unboundWorkspaceLabel: 'Scratch' } },
    ])
  })

  it('reads a page payload with the same defaults', () => {
    expect(PresentationOptions({})).toEqual({ showHeroText: true })
    expect(PresentationOptions({ showHeroText: false, unboundWorkspaceLabel: 'Scratch' }))
      .toEqual({ showHeroText: false, unboundWorkspaceLabel: 'Scratch' })
  })
})
