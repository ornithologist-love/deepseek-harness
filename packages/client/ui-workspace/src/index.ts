/**
 * Workspace picker plugin, node half. Publishes the page's startup options and
 * the deployment's initial main view before browser plugins activate; the
 * browser half ships via exports["./client"], discovered through the
 * package.json dsh.client declaration.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { SESSION_NAVIGATION_GLOBAL, WORKSPACE_OPTIONS_GLOBAL, type Config } from './workspace-options.ts'

export { Config } from './workspace-options.ts'
export type { SessionNavigationInput } from './workspace-options.ts'

/**
 * Publish startup options and the optional initial main view for each page.
 * @param ctx - Host context collecting the page's initialization data.
 * @param config - plugin options with schema defaults applied by the Loader.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.on('webserver/index-inject', (table) => {
    if (!config.restoreOnStartup) {
      table.push({ kind: 'global', name: WORKSPACE_OPTIONS_GLOBAL, value: { restoreOnStartup: false } })
    }
    const input = ctx.get('sessionNavigationInput')
    if (input) table.push({ kind: 'global', name: SESSION_NAVIGATION_GLOBAL, value: input.current() })
  })
}
