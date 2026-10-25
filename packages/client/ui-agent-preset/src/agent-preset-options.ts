/**
 * Public page-bootstrap options shared by the Host and Client halves.
 *
 * Every field is optional in the schema and keeps today's presentation when
 * omitted, so a deployment states only what it changes.
 */

import z from '@deepseek-ai/schemastery'

/** Page-bootstrap options after schema defaults are applied. */
export interface Config {
  /**
   * Preset ids whose Sessions keep their own presenter: a session running a
   * preset starting with one of these prefixes shows neither the new-session
   * picker nor the session-header label. The registry's own
   * `hiddenPresetPrefixes` only filters the roster this browser lists.
   */
  hiddenAgentPresetPrefixes: string[]
  /**
   * Show the new-session picker only while Developer tools is on. A preset the
   * deployment picked stays composed either way; the picker itself is hidden.
   */
  seatRequiresDeveloperTools: boolean
}

/** Validate Host configuration and its public page-bootstrap payload. */
export const Config: z<Partial<Config>, Config> = z.object({
  hiddenAgentPresetPrefixes: z.array(z.string()).default([]),
  seatRequiresDeveloperTools: z.boolean().default(false),
})

/** Page-global key carrying only the public agent-preset surface options. */
export const AGENT_PRESET_OPTIONS_GLOBAL = '__DSH_AGENT_PRESET_SURFACE_OPTIONS__'
