/**
 * Registry-owned interruption of one running call: a user interrupt or the
 * `maxCallMs` budget settles the call even when its body ignores the signal.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { defineContentToolFixture, executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import ToolRuntime, { TOOL_CANCELLED_BY_USER, TOOL_TIMEOUT, ToolInterruptedError } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

const signal = new AbortController().signal

async function setup(config: { maxCallMs?: number; interruptGraceMs?: number } = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, config)
  await ctx.plugin(NativeToolExecutor)
  return ctx
}

afterEach(() => { vi.useRealTimers() })

describe('tool call interruption', () => {
  it('settles a user-interrupted call after the grace period even when the body ignores its signal', async () => {
    const ctx = await setup({ interruptGraceMs: 10 })
    let running: ToolExecution | undefined
    let observed: unknown
    ctx.tools.register(defineContentToolFixture({
      name: 'stuck', description: 'never settles', parameters: {},
      execute(_args, exec) {
        running = exec
        exec.signal.addEventListener('abort', () => { observed = exec.signal.reason })
        return new Promise(() => {})
      },
    }))
    const pending = executeToolFixture(ctx, { callId: ToolCallId('c1'), name: 'stuck', arguments: {}, signal })
    await vi.waitFor(() => { expect(running).toBeDefined() })
    expect(ctx.tools.interrupt(running!, { kind: 'user' })).toBe(true)
    const result = await pending
    expect(observed).toBeInstanceOf(ToolInterruptedError)
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe(TOOL_CANCELLED_BY_USER)
    expect(ctx.tools.interrupt(running!, { kind: 'user' })).toBe(false)
  })

  it('times out a bounded call and leaves unbounded tools running', async () => {
    const ctx = await setup({ maxCallMs: 20, interruptGraceMs: 10 })
    let release!: () => void
    ctx.tools.register(defineContentToolFixture({
      name: 'slow', description: 'waits', parameters: {},
      execute: () => new Promise(() => {}),
    }))
    ctx.tools.register(defineContentToolFixture({
      name: 'waits_for_user', description: 'waits on a person', parameters: {}, unbounded: true,
      execute: () => new Promise((resolve) => { release = () => { resolve([{ type: 'text', text: 'answered' }]) } }),
    }))
    const timed = await executeToolFixture(ctx, { callId: ToolCallId('c1'), name: 'slow', arguments: {}, signal })
    expect(timed.error?.info?.code).toBe(TOOL_TIMEOUT)
    const unbounded = executeToolFixture(ctx, { callId: ToolCallId('c2'), name: 'waits_for_user', arguments: {}, signal })
    await new Promise(resolve => setTimeout(resolve, 60))
    release()
    const answered = await unbounded
    expect(answered.isError).toBe(false)
  })

  it('reports no running call for an unknown execution', async () => {
    const ctx = await setup()
    expect(ctx.tools.interrupt({ token: {} as ToolExecution['token'] }, { kind: 'user' })).toBe(false)
  })
})
