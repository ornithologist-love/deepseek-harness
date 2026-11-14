/** Per-call transport routing preserves local profiles and isolates credentials. */
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as PiAi from '../src/index.ts'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

afterEach(async () => {
  await closeMockServers()
  vi.unstubAllEnvs()
})

async function harness(baseURL: string): Promise<Context> {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(PiAi, { providers: { deepseek: {
    apiKeyEnv: 'PI_ROUTE_KEY', baseURL, headers: { 'X-Local-Only': 'local-fixture' },
  } } })
  return ctx
}

it('routes overlapping calls independently without copying local authentication or changing the profile', async () => {
  vi.stubEnv('PI_ROUTE_KEY', 'local-key')
  const local = await mockServer(Array.from({ length: 2 }, () => ({ events: textEvents })))
  const remote = await mockServer([{ events: textEvents }])
  const ctx = await harness(local.url)
  const seen: string[] = []
  ctx.on('llm-pi-ai/request-route', (request, _route, next) => {
    expect(Object.isFrozen(request)).toBe(true)
    expect(request.baseURL).toBe(local.url)
    return request.sessionId === 'remote' ? { baseURL: remote.url, apiKey: 'remote-key', headers: { 'X-Remote-Only': 'remote-fixture' } } : next()
  })
  ctx.on('llm-pi-ai/request-headers', (request, _headers, next) => {
    seen.push(request.baseURL)
    return next()
  })
  const results = await Promise.all(['local', 'remote'].map(session =>
    assemble(ctx, { model: 'deepseek-flash', messages: [], sessionId: SessionId(session) })))
  results.push(await assemble(ctx, { model: 'deepseek-flash', messages: [] }))
  expect(results.map(result => result.finish)).toEqual(Array.from({ length: 3 }, () => ({ kind: 'stop' })))
  expect(local.headers.map(headers => headers.authorization)).toEqual(['Bearer local-key', 'Bearer local-key'])
  expect(local.headers[0]).toHaveProperty('x-local-only', 'local-fixture')
  expect(remote.headers[0]).toMatchObject({ authorization: 'Bearer remote-key', 'x-remote-only': 'remote-fixture' })
  expect(remote.headers[0]).not.toHaveProperty('x-local-only')
  expect(seen).toContain(new URL(remote.url).href)
})

it('dispatches the overridden route without looking up an unavailable local credential', async () => {
  vi.stubEnv('PI_ROUTE_KEY', '')
  const local = await mockServer([]), remote = await mockServer([{ events: textEvents }])
  const ctx = await harness(local.url)
  ctx.on('llm-pi-ai/request-route', () => ({ baseURL: remote.url, apiKey: 'remote-key' }))
  expect((await assemble(ctx, { model: 'deepseek-flash', messages: [] })).finish).toEqual({ kind: 'stop' })
  expect(local.requests).toHaveLength(0)
  expect(remote.headers[0]?.authorization).toBe('Bearer remote-key')
})

it('rejects an invalid override before HTTP dispatch and reports no credential value', async () => {
  const local = await mockServer([])
  const ctx = await harness(local.url)
  ctx.on('llm-pi-ai/request-route', () => ({ baseURL: 'file:///invalid', apiKey: 'private-fixture' }))
  const result = await assemble(ctx, { model: 'deepseek-flash', messages: [] })
  expect(result.finish).toMatchObject({ kind: 'error', failure: { code: 'REQUEST_ROUTE' } })
  expect(JSON.stringify(result.finish)).not.toContain('private-fixture')
  expect(local.requests).toHaveLength(0)
})
