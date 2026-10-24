/**
 * Official-DeepSeek first-run step. Readiness comes from the same
 * provider/settings/credential join as the Models page: any provider the user
 * can already talk to ends the step, and only a user with none is offered the
 * official DeepSeek route. The step reuses that page's credential editor in
 * the onboarding plugin's shared modal, so the key is entered once.
 */
import type { TrackProductEvent } from '@deepseek-ai/dsh-client-product-analytics/client'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsRuntime, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelsSettingsState, ModelsSettingsStore } from './store.ts'
import { deriveKeyRef, onboardingReadiness } from './store.ts'
import type { ModelsOperations } from './operations.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import { apiKeyFailure } from './apiKey.ts'
import { ProviderEditor } from './ProviderEditor.tsx'
import type {} from './slot-contract.ts'
import type { en } from './locales.ts'
import { OnboardingModal } from './OnboardingModal.tsx'
import styles from './DeepSeekOnboardingDialog.module.css'

/** Registration-side dependencies of {@link DeepSeekOnboardingDialog}. */
export interface DeepSeekOnboardingInjected {
  /** Desktop-only event collection. */
  track?: TrackProductEvent
  /** Whether first-run setup should show automatically. Explicit requests remain available. */
  automatic: boolean
  /** Editor family per settings namespace (see `Config.providerEditorLayouts`). */
  providerEditorLayouts?: Readonly<Record<string, 'deepseek' | 'pi-ai'>>
  hooks: {
    /** Shared Models-page join state, bound by the slot renderer. */
    models: SnapshotStore<ModelsSettingsState>
  }
  /** Shared Models-page join controller. */
  controller: ModelsSettingsStore
  /** The Host operations the reused Models credential editor writes through. */
  operations: ModelsOperations
  /** Settings schema and immutable path callbacks. */
  schema: SettingsSchemaOperations
  /** Feature copy. */
  t: (key: keyof typeof en) => string
}

/** Slot owner props plus the feature's injected dependencies. */
export type DeepSeekOnboardingDialogProps =
  PropsRuntime<'settings.onboarding'> & PropsRenderSlots<'settings.models.sign-in' | 'settings.models.credential-prompt'>
    & InjectFace<DeepSeekOnboardingInjected>

/* v8 ignore next 3 -- closed-union defaults only defend future source widening */
function assertNever(_value: never): never {
  throw new Error('unexpected DeepSeek onboarding state')
}

/**
 * Prompt a first-run user for the official DeepSeek credential while no
 * provider can serve requests and that credential is writable.
 * @param props - settings-shell owner state and Models feature dependencies.
 * @returns the onboarding modal or null when onboarding needs no intervention.
 */
export function DeepSeekOnboardingDialog(props: DeepSeekOnboardingDialogProps): ReactNode {
  const {
    complete, controller, useModels, operations, schema, t, renderSlot, automatic, explicit = false,
    providerEditorLayouts,
  } = props
  const [apiKey, setApiKey] = useState(explicit)
  const state = useModels(snapshot => snapshot)
  const readiness = onboardingReadiness(state)
  // A deployment whose default provider is another route has nothing to ask
  // this step for; the prompt belongs to the route it can store a key for.
  const otherProvider = state.defaultProvider !== undefined && state.defaultProvider !== 'deepseek-official'

  useEffect(() => {
    if ((automatic || explicit) && state.status === 'idle') void controller.load()
  }, [controller, state.status, automatic, explicit])

  useEffect(() => {
    if (
      ((!automatic || otherProvider) && !explicit)
      || readiness.kind === 'adapter-absent'
      || (!explicit && readiness.kind === 'provider-ready')
      || readiness.kind === 'unavailable'
    ) complete()
  }, [complete, readiness.kind, explicit, automatic, otherProvider])

  if ((!automatic || otherProvider) && !explicit) return null

  switch (readiness.kind) {
    case 'loading':
    case 'adapter-absent':
    case 'unavailable':
      return null
    case 'provider-ready':
      if (!explicit) return null
      break
    case 'credential-missing':
      break
    /* v8 ignore next -- every current readiness variant is handled above */
    default:
      return assertNever(readiness)
  }

  const row = state.rows.find(candidate =>
    candidate.entry.provider === 'deepseek-official'
    && candidate.entry.settingsNs === 'llm-deepseek'
    && candidate.entry.settingsPath.length === 0)
  const namespace = state.namespaces.get('llm-deepseek')
  /* v8 ignore next 2 -- credential-missing is derived only from this exact joined row. */
  if (row === undefined || namespace === undefined) return null

  const finishCredential = (changed: boolean): void => {
    if (!changed) {
      complete()
      return
    }
    void controller.load()
  }

  /** The reference the reused editor stores a typed key under: the profile's own, else the derived one. */
  const keyRef = ((): string => {
    const profile = schema.getPath(namespace.value, row.entry.settingsPath)
    const named = typeof profile === 'object' && profile !== null
      ? (profile as { apiKeyEnv?: unknown }).apiKeyEnv
      : undefined
    return typeof named === 'string' && named.length > 0 ? named : deriveKeyRef(row.entry.provider)
  })()

  /**
   * The credential save the replacement prompt reaches: the same judgement,
   * write, and follow-up the reused editor makes after its own submit.
   * @param value - the key the prompt collected, untrimmed.
   * @returns resolution once the key is stored and the join refreshed.
   * @throws a localized message the prompt shows when the key or the write is refused.
   */
  const save = async (value: string): Promise<void> => {
    const key = value.trim()
    if (key.length === 0) throw new Error(t('keyRequired'))
    const failure = apiKeyFailure(key)
    if (failure !== undefined) throw new Error(t(failure))
    const stored = await operations.storeCredential(keyRef, key)
    if (stored !== undefined) throw new Error(stored)
    props.track?.('api_key_save_click', {})
    await controller.load()
    complete()
  }

  const editor = renderSlot('settings.models.credential-prompt', {
    provider: row.entry.provider,
    displayName: row.entry.displayName,
    save,
    close: complete,
  }, {
    fallback: (
      <OnboardingModal title={t('onboardingTitle')}>
        <p className={styles.description}>{t('onboardingDescription')}</p>
        <div className={styles.editor}>
          <ProviderEditor
            provider={row.entry.provider}
            displayName={row.entry.displayName}
            namespace={namespace}
            schema={schema}
            settingsPath={row.entry.settingsPath}
            operations={operations}
            t={t}
            readOnly={false}
            hideTitle
            credentialOnly
            {...providerEditorLayouts === undefined ? {} : { providerEditorLayouts }}
            onSubmitCredential={() => { props.track?.('api_key_save_click', {}) }}
            credentialRequired
            autoFocusCredential
            cancelLabelKey="onboardingLater"
            submitLabelKey="onboardingSave"
            submitBusyLabelKey="onboardingSaving"
            onClose={finishCredential}
          />
        </div>
      </OnboardingModal>
    ),
  })
  return apiKey ? editor : renderSlot('settings.models.sign-in', { complete, useApiKey: () => { setApiKey(true) } }, { fallback: editor })
}
