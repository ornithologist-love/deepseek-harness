/**
 * Client decode of the generated `session/modelCatalog` result: display metadata a
 * deployment decorates onto a model entry survives Typert's strict result codec.
 */

import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import { apply } from '@deepseek-ai/dsh-api-gateway/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { ModelCatalog } from '../src/types.ts'

const MULTIPLIER = 1.5

const CATALOG: ModelCatalog = {
  default: { provider: 'fixture', model: 'fixture-model' },
  routableProviders: ['fixture'],
  groups: [{
    id: 'fixture',
    name: 'Fixture',
    models: [
      { id: 'fixture-model', name: 'Fixture Model', metadata: { multiplier: MULTIPLIER, mark: 'example' } },
    ],
  }],
  failures: [],
}

/** The model entry's generated schema, with or without the display-metadata field under test. */
const modelEntry = (metadata: boolean): z.ZodType => z.object({
  id: z.string().readonly(),
  name: z.string().readonly(),
  ...metadata ? { metadata: z.record(z.string(), z.json()).readonly().optional() } : {},
}).readonly()

/** The generated Catalog schema, varying only the model-entry field under test. */
function catalogSchema(metadata: boolean): z.ZodType {
  return z.object({
    default: z.object({ provider: z.string().readonly(), model: z.string().readonly() }).readonly(),
    routableProviders: z.array(z.string()).readonly(),
    groups: z.array(z.object({
      id: z.string().readonly(),
      name: z.string().readonly(),
      models: z.array(modelEntry(metadata)).readonly(),
    }).readonly()).readonly(),
    failures: z.array(z.object({
      id: z.string().readonly(),
      name: z.string().readonly(),
      message: z.string().readonly(),
    }).readonly()).readonly(),
  }).readonly()
}

/** Generated modelCatalog contribution whose result codec is the one the emitter derives from the schema. */
function remote(of: z.ZodType): ReturnType<typeof createTypertRemoteInfo> {
  return createTypertRemoteInfo({
    package: '@deepseek-ai/dsh-api-session-controller',
    methods: {
      'session/modelCatalog': {
        service: 'sessionController',
        invocation: { kind: 'direct' },
        parameters: [],
        result: {
          mode: 'strict',
          typeSymbol: '@deepseek-ai/dsh-api-session-controller/types#ModelCatalog',
          create: () => of,
          decode: (value: unknown) => of.parse(value),
        },
      },
    },
  }, z)
}

/** Install the Gateway and the generated contribution on a Client Context that answers with `answer`. */
async function mount(
  ctx: Context,
  info: ReturnType<typeof createTypertRemoteInfo>,
  answer: ModelCatalog,
): Promise<void> {
  const connection = {
    interactions: 'answer',
    rpc: { call: () => Promise.resolve({ ok: true, value: structuredClone(answer) }) },
    generation: { getSnapshot: () => undefined, subscribe: () => () => {} },
    state: { getSnapshot: () => undefined, subscribe: () => () => {} },
    reconnect: () => {},
    registerGenerationSource: () => () => {},
    openWebSocket: () => { throw new Error('this fixture does not install a WebSocket carrier') },
    isLoopback: true,
    start: () => ({ stop: () => {} }),
  } satisfies ConnectionHandle
  ctx.provide('connection', connection)
  // The Gateway installs and decodes every generated descriptor; the business assembly selects it.
  apply(ctx)
  ctx.provide('typert', {
    lookups: { configure: () => () => {} },
    contexts: { configureHost: () => () => {} },
    resources: { register: () => () => {} },
    remotes: { register: () => async () => {} },
  })
  await ctx.remote.$mount(info)
}

/** The model metadata one mounted contribution delivers for `CATALOG`. */
async function deliveredMetadata(metadata: boolean): Promise<unknown> {
  const ctx = new Context()
  try {
    await mount(ctx, remote(catalogSchema(metadata)), CATALOG)
    const result = await ctx.remote.session.modelCatalog()
    if (!result.ok) throw result.error
    return result.value.groups[0]?.models[0]?.metadata
  } finally {
    await ctx.fiber.dispose()
  }
}

describe('session/modelCatalog result decode', () => {
  it('delivers model display metadata a deployment decorated onto the catalog', async () => {
    await expect(deliveredMetadata(true)).resolves.toEqual({ multiplier: MULTIPLIER, mark: 'example' })
  })

  it('drops display metadata the strict result schema does not declare', async () => {
    await expect(deliveredMetadata(false)).resolves.toBeUndefined()
  })
})
