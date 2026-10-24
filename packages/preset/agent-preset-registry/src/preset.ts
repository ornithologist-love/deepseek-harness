import type { Volatile } from '@deepseek-ai/cordis'
/** Public preset roster and selection configuration. */
/** One declared preset and its current activation failure, if any. */
export interface AgentPreset {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly order?: number
  readonly broken?: string
}

/** Registry selection policy. */
export interface Config {
  /** Deployment default when the caller omits a preset. */
  default: string
  /** Preset ID prefixes left out of the remote roster; the presets stay resolvable and mountable. */
  hiddenPresetPrefixes?: string[]
  /** Preset ID prefixes the remote `select` refuses; Host-side composition may still assign them. */
  lockedPresetPrefixes?: string[]
  /** User-selected default; edited through Settings. */
  selectedDefault: Volatile<string | undefined>
}
