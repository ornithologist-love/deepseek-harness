/**
 * Deployment presentation options shared by the Host and Client halves.
 *
 * The Host publishes {@link CONVERSATION_OPTIONS_GLOBAL} only when its Config
 * changes a default, so pages of an unconfigured deployment carry no global.
 */

import z from '@deepseek-ai/schemastery'

/** Conversation presentation after schema defaults are applied. */
export interface PresentationOptions {
  /** Show the built-in hero headline and preview badge; the brand mark stays either way. */
  showHeroText: boolean
  /**
   * Workspace chip label for a Session whose directory belongs to no
   * registered Workspace once the list is ready; absent shows the
   * "Choose workspace" placeholder.
   */
  unboundWorkspaceLabel?: string
}

/** Presentation fields of the Host configuration. */
export const PresentationFields = {
  showHeroText: z.boolean().default(true),
  unboundWorkspaceLabel: z.string(),
}

/** Validate the presentation page payload. */
export const PresentationOptions: z<Partial<PresentationOptions>, PresentationOptions> = z.object(PresentationFields)

/** Page-global key carrying the presentation options. */
export const CONVERSATION_OPTIONS_GLOBAL = '__DSH_CONVERSATION_OPTIONS__'
