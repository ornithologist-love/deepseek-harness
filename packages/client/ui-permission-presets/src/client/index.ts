/**
 * Permission preset plugin, browser half — a popupSelect DECORATION hung on
 * the host `/permission` command: one flat list of presets, current value
 * marked active, a pick executes the switch. One process catalog directory is
 * shared with the composer slot; Session projection carries current value
 * only. The decoration owns only the
 * bare invocation; the host command keeps its catalog row, the argued path
 * (`/permission <preset>` still switches directly), and the lifecycle
 * logging. Options read the process catalog and the active mark reads the
 * session's `permissions` projection; a
 * pick submits the `/permission <preset>` command line, so both surfaces
 * write through one path and the pushed projection frame is the one
 * confirmation. The Full access row carries the same explicit risk gate as
 * the composer chip; the shared popup shell owns the modal mechanics.
 * The General-settings row separately writes the default preset for sessions
 * created later through the host Settings API.
 *
 * The Host publishes this deployment's options as one page-global; they shape
 * the surfaces in three ways: preset colors, the opt-in remembered Full access
 * acknowledgement (the `ui-permission` entry's volatile user setting), and
 * the agent presets whose Sessions keep their own permission mechanism.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionFace, SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { PermissionCatalog, PermissionSelection } from '@deepseek-ai/dsh-permission-presets/client'
// Direct dependency: catalog settlements are fenced by the actual connection
// generation rather than by a parallel domain counter.
import type {} from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings slot types (this package registers a General row).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face
// (the settings invalidation rides the allowlist) into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { CommandUiContract, SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { ClientSessionContext } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Config, PERMISSION_OPTIONS_GLOBAL } from '../permission-options.ts'
import { PERMISSION_CLIENT_SETTINGS_NAMESPACE, PermissionAcknowledgement } from './acknowledgement.ts'
import { PermissionCatalogDirectory } from './catalog.ts'
import { PermissionSelect } from './PermissionSelect.tsx'
import type { PermissionSelectInjected } from './PermissionSelect.tsx'
import { PermissionRow } from './PermissionRow.tsx'
import type { PermissionRowInjected } from './PermissionRow.tsx'
import {
  accessEn, accessJa, accessEs, accessFr, accessDe, accessRu, accessPt, accessZh, en, ja, es, fr, de, ru, pt,
  PERMISSION_ACCESS_NS, type PermissionSettingsKey, zh,
} from './locales.ts'
import {
  AUTO_REVIEW_PRESET, displayPermissionPreset, FULL_ACCESS_PRESET,
} from './presentation.ts'
import { PermissionPresetSettingsController } from './settings-store.ts'

export type { PermissionRowInjected, PermissionRowProps } from './PermissionRow.tsx'
export type { PermissionCatalogState } from './catalog.ts'
export type { PermissionSelectInjected, PermissionSelectProps } from './PermissionSelect.tsx'
export type {
  PermissionDefaultOption, PermissionSettingsState,
} from './settings-store.ts'
export type { Config } from '../permission-options.ts'
export type { PermissionClientSettings } from './acknowledgement.ts'
export type { PermissionAcknowledgement } from './acknowledgement.ts'

/** Required services (cordis fiber inject). */
export const inject = [
  'commandUi', 'connection', 'sessions', 'slots', 'locale', 'remote',
  'remote.permissionPresets', 'remote.session', 'remote.settings',
  'configForms', 'settingsSchema',
]

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Current-session permission picker and confirmation copy. */
    'permission.access': keyof typeof accessEn
    /** Permission row copy. */
    'settings.permission': PermissionSettingsKey
  }
}

/** Read one session's current permissions projection value (undefined = capability absent). */
function selectionOf(session: SessionFace | undefined): PermissionSelection | undefined {
  return session?.projections.faceOf('permissions').getSnapshot() as PermissionSelection | undefined
}

/**
 * Whether a Session keeps this package's local permission controls.
 * @param list - the Session Controller's Session list of current summaries.
 * @param sessionId - addressed Session.
 * @param hidden - configured agent-preset projection values whose Sessions
 * keep their own permission mechanism.
 * @returns false when the Session's agent preset matches one exactly.
 */
function localControlsAvailable(
  list: ObservableSnapshot<SessionListState>,
  sessionId: SessionId,
  hidden: readonly string[],
): boolean {
  const preset = list.getSnapshot().byId[sessionId]?.projectionValues?.agentPreset
  return typeof preset !== 'string' || !hidden.includes(preset)
}

/** Join the process catalog with one Session's current value. */
function optionsOf(
  catalog: PermissionCatalog,
  currentValue: string,
  t: TranslateNS<typeof PERMISSION_ACCESS_NS>,
  confirmationRequired: (preset: string) => boolean,
): SelectOption[] {
  return catalog.options
    .map(option => ({
      id: option.value,
      label: option.value === AUTO_REVIEW_PRESET
        ? t('auto.label')
        : displayPermissionPreset(option.value, option.name, t),
      ...(option.value === AUTO_REVIEW_PRESET ? { badge: t('auto.badge') } : {}),
      ...(option.value === AUTO_REVIEW_PRESET
        ? { detail: t('auto.description') }
        : option.description !== undefined ? { detail: option.description } : {}),
      ...(option.value === currentValue ? { active: true } : {}),
      ...(confirmationRequired(option.value)
        ? {
          confirmation: {
            title: t(option.value === AUTO_REVIEW_PRESET ? 'auto.confirm.title' : 'confirm.title'),
            description: t(option.value === AUTO_REVIEW_PRESET ? 'auto.confirm.description' : 'confirm.description'),
            acknowledgeLabel: t(option.value === AUTO_REVIEW_PRESET ? 'auto.confirm.acknowledge' : 'confirm.acknowledge'),
            cancelLabel: t('confirm.cancel'),
            confirmLabel: t(option.value === AUTO_REVIEW_PRESET ? 'auto.confirm.enable' : 'confirm.enable'),
          },
        }
        : {}),
    }))
}

/**
 * Client plugin body: register the /permission popup picker over the
 * permissions projection.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const page = globalThis as Partial<Record<typeof PERMISSION_OPTIONS_GLOBAL, unknown>>
  const payload = page[PERMISSION_OPTIONS_GLOBAL]
  const configured = Config(payload === undefined ? {} : payload)
  const command = ctx.get('commandUi') as CommandUiContract
  const sessions = ctx.sessions
  const accessDictionaries = {
    zh: accessZh,
    en: accessEn,
    ja: accessJa,
    es: accessEs,
    fr: accessFr,
    de: accessDe,
    ru: accessRu,
    pt: accessPt,
  }
  ctx.effect(
    () => ctx.locale.register(PERMISSION_ACCESS_NS, accessDictionaries),
    'ui-permission: current-session dictionaries',
  )
  const t = ctx.locale.bind(PERMISSION_ACCESS_NS)
  const sessionFor = (session: ClientSessionContext): SessionFace | undefined =>
    sessions.binding(session.sessionId)?.session
  const controlsAvailable = (sessionId: SessionId): boolean =>
    localControlsAvailable(sessions.list, sessionId, configured.hiddenAgentPresets)
  // One acknowledgement mirror feeds every surface that gates Full access.
  const acknowledgement = new PermissionAcknowledgement(
    ctx.configForms.get(PERMISSION_CLIENT_SETTINGS_NAMESPACE), configured.rememberFullAccess)
  ctx.effect(() => () => { acknowledgement.dispose() }, 'ui-permission: acknowledgement mirror')
  const acknowledgeFullAccess = (): void => {
    acknowledgement.acknowledgeFullAccess(configured.rememberFullAccess)
  }
  // Auto review keeps its own confirmation on every selection.
  const confirmationRequired = (preset: string): boolean =>
    preset === AUTO_REVIEW_PRESET || acknowledgement.requiresConfirmation(preset, configured.rememberFullAccess)
  const submit = async (sessionId: SessionId, preset: string): Promise<boolean> => {
    const live = sessions.binding(sessionId)?.session
    if (live === undefined) throw new Error('this session is not materialized yet')
    // A deferred draft has no Agent to run `/permission`; the choice is saved and applied at activation.
    if (sessions.deferredActivation) {
      const saved = await ctx.remote.session.selectPermission({ sessionId, preset })
      if (!saved.ok) throw new Error(`permission switch failed: ${saved.error.code}: ${saved.error.message}`)
      return true
    }
    const result = await live.command(`/permission ${preset}`)
    if (!result.ok) {
      throw new Error(`permission switch failed: ${result.error.code}: ${result.error.message}`)
    }
    if (!result.value.matched) throw new Error('the host offers no /permission command')
    return true
  }

  const catalog = new PermissionCatalogDirectory(ctx)
  ctx.effect(() => () => { catalog.dispose() }, 'ui-permission: process catalog directory')
  ctx.effect(
    // Only an invalidation makes displayed options stale; publishing the result
    // of a read a displayed picker waits for must leave it open with its failure
    // and retry state intact.
    () => catalog.invalidations.subscribe(() => { command.dismiss('permission') }),
    'ui-permission: dismiss stale slash choices',
  )

  ctx.effect(() => ctx.locale.register('settings.permission', { zh, en, ja, es, fr, de, ru, pt }), 'ui-permission: settings row dictionaries')

  // The shared ConfigForm mirror updates after document commits and reconnects.
  const controller = new PermissionPresetSettingsController(
    ctx.configForms.describe(), ctx, catalog)
  const load = (): Promise<void> => controller.load()
  const select = (preset: string): Promise<void> => controller.select(preset)
  const injected = (): PermissionRowInjected => ({
    hooks: { permission: controller.store, fullAccessAcknowledged: acknowledgement.acknowledged },
    acknowledgeFullAccess,
    fullAccessRemembered: configured.rememberFullAccess,
    load,
    select,
  })

  ctx.effect(() => () => { controller.dispose() }, 'ui-permission: settings row directory')

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'permission',
    order: -20,
    locale: 'settings.permission',
    inject: injected,
  }, PermissionRow))

  ctx.slots.inject('conversation.input.permission', () => ctx.slots.register({
    name: 'conversation.input.permission',
    locale: PERMISSION_ACCESS_NS,
    inject: (sessionId: SessionId): PermissionSelectInjected => ({
      colors: configured.colors,
      acknowledgeFullAccess,
      fullAccessRemembered: configured.rememberFullAccess,
      hooks: { permissionCatalog: catalog.store, fullAccessAcknowledged: acknowledgement.acknowledged },
      select: preset => submit(sessionId, preset),
    }),
  }, PermissionSelect))

  ctx.effect(() => command.decorate({
    name: 'permission',
    // The Session's current value alone decides availability, apart from a
    // Session configured with another permission mechanism, which keeps this
    // picker away. A missing catalog surfaces through `options()`, which keeps
    // the picker's own retry entry reachable after a failed read instead of
    // hiding the command.
    available: session => selectionOf(sessionFor(session)) !== undefined
      && controlsAvailable(session.sessionId),
    ui: {
      kind: 'popupSelect',
      options: async (session) => {
        const selection = selectionOf(sessionFor(session))
        if (selection === undefined) throw new Error('permission presets are not available on this host')
        return optionsOf(await catalog.load(), selection.currentValue, t, confirmationRequired)
      },
      onSelect: (option, session) => submit(session.sessionId, option.id)
        .then((accepted) => {
          // The picker's own confirmation, or a direct pick on a deployment
          // that remembers, is the explicit confirmation either way.
          if (option.id === FULL_ACCESS_PRESET) acknowledgeFullAccess()
          return accepted
        })
        .then(() => undefined),
    },
  }), 'ui-permission: /permission decoration')
}
