/**
 * Public page-bootstrap options shared by the Host and Client halves.
 *
 * Every field is optional in the schema and keeps today's presentation when
 * omitted, so a deployment states only what it changes.
 */

import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** Page-bootstrap options after schema defaults are applied. */
export interface Config {
  /**
   * Display color per permission preset value, painted on the composer
   * trigger and the `/permission` menu rows. Unlisted presets keep the native
   * styles, and the value is applied as a CSS custom property rather than a
   * literal style, so a theme can override it.
   */
  colors: Record<string, string>
  /**
   * Stop asking again after the user's first explicit Full access
   * confirmation in any current-session or Settings surface. Auto review keeps
   * its own confirmation on every selection.
   */
  rememberFullAccess: boolean
  /**
   * Agent-preset projection values whose Sessions keep their own permission
   * mechanism: their composer trigger and `/permission` picker stay hidden.
   */
  hiddenAgentPresets: string[]
  /**
   * User setting recording one explicit Full access confirmation; read only
   * when `rememberFullAccess` is on and written by the browser half.
   */
  fullAccessAcknowledged: Volatile<boolean>
}

/** Validate Host configuration and its public page-bootstrap payload. */
export const Config = z.object({
  colors: z.dict(z.string()).default({}),
  rememberFullAccess: z.boolean().default(false),
  hiddenAgentPresets: z.array(z.string()).default([]),
  fullAccessAcknowledged: z.boolean().default(false).volatile(),
})

/** Page-global key carrying only the public permission-surface options. */
export const PERMISSION_OPTIONS_GLOBAL = '__DSH_PERMISSION_PRESET_OPTIONS__'
