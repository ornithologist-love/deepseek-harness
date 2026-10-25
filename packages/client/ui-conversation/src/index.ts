/** Host registration for browser conversation preferences and presentation options. */
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'

import type { Volatile, Context } from '@deepseek-ai/cordis'
import type { BusyEnterBehavior } from './submission-settings.ts'
import z from '@deepseek-ai/schemastery'
import { BUSY_ENTER_FIELD } from './submission-settings.ts'

import { ConversationSettingsFields } from './submission-settings.ts'
import { CONVERSATION_OPTIONS_GLOBAL, PresentationFields, type PresentationOptions } from './presentation-options.ts'

export {
  BUSY_ENTER_BEHAVIORS, BUSY_ENTER_FIELD, CONVERSATION_SETTINGS_NAMESPACE,
  DEFAULT_BUSY_ENTER_BEHAVIOR, type BusyEnterBehavior, type ConversationSettings,
} from './submission-settings.ts'

/** Runtime preferences and deployment presentation projected to the browser. */
export interface Config extends PresentationOptions {
  /** Enter key behavior while a turn is running. */
  busyEnter: Volatile<BusyEnterBehavior>
}

/** Live preferences and deployment presentation projected to the browser. */
export const Config = z.object({
  showHeroText: PresentationFields.showHeroText,
  unboundWorkspaceLabel: PresentationFields.unboundWorkspaceLabel,
  busyEnter: ConversationSettingsFields[BUSY_ENTER_FIELD].volatile(),
})

/**
 * Host preferences are consumed through the configuration form projection;
 * non-default presentation options are published to every page.
 * @param ctx Plugin context used for optional settings presentation.
 * @param config Plugin options with schema defaults applied by the Loader.
 */
export function apply(ctx: Context, config: Config): void {
  const presentation: Partial<PresentationOptions> = {
    ...config.showHeroText ? {} : { showHeroText: false },
    ...config.unboundWorkspaceLabel === undefined ? {} : { unboundWorkspaceLabel: config.unboundWorkspaceLabel },
  }
  if (Object.keys(presentation).length > 0) {
    ctx.on('webserver/index-inject', (table) => {
      table.push({ kind: 'global', name: CONVERSATION_OPTIONS_GLOBAL, value: presentation })
    })
  }
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
}
