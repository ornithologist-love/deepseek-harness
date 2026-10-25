/**
 * Permission surfaces plugin, node half. Publishes this deployment's
 * presentation options into the browser page before client plugins activate;
 * the browser half then ships the new-session Settings row and current-session
 * command picker through exports["./client"], discovered from the package.json
 * dsh.client declaration.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import { type Config, PERMISSION_OPTIONS_GLOBAL } from './permission-options.ts'

export { Config } from './permission-options.ts'

/**
 * Publish the permission-surface options before browser plugins activate.
 * @param ctx - Host context collecting the page's initialization data.
 * @param config - plugin options with schema defaults applied by the Loader.
 */
export function apply(ctx: Context, config: Config): void {
  // Serve the volatile acknowledgement field without listing it in the General settings page.
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  ctx.on('webserver/index-inject', (table) => {
    table.push({
      kind: 'global',
      name: PERMISSION_OPTIONS_GLOBAL,
      value: {
        colors: config.colors,
        rememberFullAccess: config.rememberFullAccess,
        hiddenAgentPresets: config.hiddenAgentPresets,
      },
    })
  })
}
