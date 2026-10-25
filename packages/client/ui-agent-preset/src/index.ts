/**
 * Agent-preset surface plugin, node half. Publishes this deployment's
 * presentation options into the browser page before client plugins activate;
 * the browser half then ships the new-session picker, the session-header label
 * and the settings section through exports["./client"], discovered from the
 * package.json dsh.client declaration.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { AGENT_PRESET_OPTIONS_GLOBAL, type Config } from './agent-preset-options.ts'

export { Config } from './agent-preset-options.ts'

/**
 * Publish the agent-preset surface options before browser plugins activate.
 * @param ctx - Host context collecting the page's initialization data.
 * @param config - plugin options with schema defaults applied by the Loader.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.on('webserver/index-inject', (table) => {
    table.push({
      kind: 'global',
      name: AGENT_PRESET_OPTIONS_GLOBAL,
      value: {
        hiddenAgentPresetPrefixes: config.hiddenAgentPresetPrefixes,
        seatRequiresDeveloperTools: config.seatRequiresDeveloperTools,
      },
    })
  })
}
