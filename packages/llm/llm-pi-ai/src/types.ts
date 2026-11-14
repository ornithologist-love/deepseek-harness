/** Request metadata exposed to pi-ai transport-header contributors. */

import type { GenerateOptions } from '@deepseek-ai/dsh-llm'

/** Model-hidden routing metadata from the exact prepared adapter call. */
export interface PiAiRequestHeaderContext extends Readonly<Pick<GenerateOptions<string>,
  'provider' | 'model' | 'sessionId' | 'purpose'>> {
  /** Resolved endpoint of the model selected for this call. */
  readonly baseURL: string
}

/** A complete transport override owned by one inference call. */
export interface PiAiRequestRoute {
  readonly baseURL: string
  readonly apiKey: string
  readonly headers?: Readonly<Record<string, string>>
}
