/**
 * Page-bootstrap startup options shared by the Host and Client halves.
 *
 * The Host publishes {@link WORKSPACE_OPTIONS_GLOBAL} only when its Config
 * changes a default, so a page script may set the global itself (for example,
 * per URL) when the Host leaves the defaults in place.
 */

import z from '@deepseek-ai/schemastery'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Startup options after schema defaults are applied. */
export interface Config {
  /**
   * Restore the previous main view when the page starts. False starts on an
   * empty main view; explicit open and New session actions are unaffected.
   */
  restoreOnStartup: boolean
}

/** Validate Host configuration and its public page-bootstrap payload. */
export const Config: z<Partial<Config>, Config> = z.object({
  restoreOnStartup: z.boolean().default(true),
})

/** Page-global key carrying the startup options. */
export const WORKSPACE_OPTIONS_GLOBAL = '__DSH_WORKSPACE_OPTIONS__'

/** Page-global key carrying the main view a deployment selects for this page. */
export const SESSION_NAVIGATION_GLOBAL = '__DSH_SESSION_NAVIGATION__'

/** Main view a deployment selects for each new page. */
export interface SessionNavigationInput {
  /**
   * Read the main view a page should open on.
   * @returns the Session the next page opens on; an empty object selects none.
   */
  current(): { sessionId?: SessionId }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional deployment-owned initial main view, read for every page bootstrap. */
    sessionNavigationInput: SessionNavigationInput
  }
}

const SessionNavigation: z<{ sessionId?: string }> = z.object({ sessionId: z.string() })

/**
 * Read the startup selection a page carries.
 * @param payload - the {@link SESSION_NAVIGATION_GLOBAL} value, if any.
 * @returns the selected Session, or undefined when the page names none.
 * @throws when the payload is not a navigation object.
 */
export function parseSessionNavigation(payload: unknown): { sessionId?: SessionId } | undefined {
  if (payload === undefined) return undefined
  const { sessionId } = SessionNavigation(payload)
  return sessionId === undefined ? {} : { sessionId: sessionId as SessionId }
}
