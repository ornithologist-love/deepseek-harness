// @vitest-environment jsdom
import { contextMenuHook } from '@deepseek-ai/dsh-client-test-runtime'
/** First-run DeepSeek prompt behavior over the shared Models join. */
import type { GlobalStandardProps, SlotMap } from '@deepseek-ai/dsh-client-ui-slots'
import type { CredentialPromptOwnerProps } from '../src/client/slot-contract.ts'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { allowAllAccess, bindSnapshotSelector, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { DeepSeekOnboardingDialog } from '../src/client/DeepSeekOnboardingDialog.tsx'
import type { DeepSeekOnboardingDialogProps } from '../src/client/DeepSeekOnboardingDialog.tsx'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { ModelsSettingsStore } from '../src/client/store.ts'
import { createModelsOperations } from '../src/client/operations.ts'
import { en } from '../src/client/locales.ts'
import { settingsSchema } from './settings-schema.client.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

/** Credentials answers over the Remote carrier, which has no envelope. */
function remoteOk<T>(value: T) {
  return { ok: true as const, value }
}
function remoteFail(message: string) {
  return { ok: false as const, error: new RemoteError('gateway/internal', message, {}) }
}

const DeepSeekConfig = Schema.object({
  apiKeyEnv: Schema.string().role('credential-ref'),
  baseURL: Schema.string().pattern(/^https:\/\//),
  reasoningEffort: Schema.union(['off', 'low', 'high', 'max']),
  defaultContextWindow: Schema.number().step(1).min(1),
  models: Schema.array(Schema.object({
    id: Schema.string().required(),
    name: Schema.string(),
    description: Schema.string(),
    contextWindow: Schema.number().step(1).min(1),
  })),
})

type AttentionSnapshot = Parameters<Parameters<DeepSeekOnboardingDialogProps['useSessionStatus']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionStatus: DeepSeekOnboardingDialogProps['useSessionStatus'] = selector => selector(noAttention)

function deepSeekNamespace(apiKeyEnv: string | null): SettingsNamespaceView {
  const value = apiKeyEnv === null ? {} : { apiKeyEnv }
  return {
    ns: 'llm-deepseek',
    schema: JSON.parse(JSON.stringify(DeepSeekConfig.toJSON())) as JsonValue,
    value,
    base: value,
    user: {},
    autoGenerate: true, applies: 'live',
    secrets: [],
    revision: 0,
  }
}

function harness(options: {
  provider?: boolean
  providerSettingsNs?: string
  providerActive?: boolean
  settingsNamespace?: boolean
  apiKeyEnv?: string | null
  configured?: () => boolean
  credential?: { source?: string; writable: boolean }
  describeFailure?: string
  settingsWritable?: boolean
  providersFailure?: string
  setFailure?: string
  defaultProvider?: string
} = {}) {
  if (document.getElementById('root') === null) {
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.append(appRoot)
  }
  let fileConfigured = false
  const configured = options.configured ?? (() => fileConfigured)
  const apiKeyEnv = options.apiKeyEnv === undefined ? 'DEEPSEEK_API_KEY' : options.apiKeyEnv
  const mutate = vi.fn(() => Promise.resolve(remoteOk(deepSeekNamespace(apiKeyEnv))))
  const set = vi.fn((_ref: string, _value: string) => {
    if (options.setFailure !== undefined) return Promise.resolve(remoteFail(options.setFailure))
    fileConfigured = true
    return Promise.resolve(remoteOk(undefined))
  })
  const face = {
    llm: {
      listProviders: () => {
        if (options.providersFailure !== undefined) return Promise.resolve(remoteFail(options.providersFailure))
        return Promise.resolve(remoteOk(
          options.provider === false || options.providerActive === false
            ? []
            : [{ id: 'deepseek-official', name: 'DeepSeek' }],
        ))
      },
      listConfigurableProviders: () => Promise.resolve(remoteOk(
        options.provider === false
          ? []
          : [{
            provider: 'deepseek-official',
            displayName: 'DeepSeek',
            settingsNs: options.providerSettingsNs ?? 'llm-deepseek',
            settingsPath: [],
          }],
      )),
      discoverModels: () => Promise.resolve(remoteOk([])),
    },
    settings: {
      describe: () => Promise.resolve(remoteOk({
        writable: options.settingsWritable ?? true,
        hasDocument: false,
        namespaces: options.settingsNamespace === false ? [] : [deepSeekNamespace(apiKeyEnv)],
      })),
      mutate,
    },
    credentials: {
      describe: () => options.describeFailure === undefined
        ? Promise.resolve(remoteOk({
          DEEPSEEK_API_KEY: {
            configured: configured(),
            ...configured() && options.credential?.source !== undefined
              ? { source: options.credential.source }
              : {},
            writable: options.credential?.writable ?? true,
          },
        }))
        : Promise.resolve(remoteFail(options.describeFailure)),
      set,
    },
  }
  // The page plugin's context, scripted down to the namespaces it reaches.
  const ctx = {
    remote: {
      ...face,
      session: {
        initializeDefaultModel: async () => ({ ok: true, value: undefined }),
        modelCatalog: () => Promise.resolve(remoteOk({
          default: { provider: options.defaultProvider ?? 'deepseek-official', model: 'deepseek-v4-flash' },
          routableProviders: [],
          groups: [],
          failures: [],
        })),
      },
    },
  } as never
  const operations = createModelsOperations(ctx)
  const controller = new ModelsSettingsStore(ctx, settingsSchema, new SettingsDescribeMirror(ctx))
  const openSection = vi.fn()
  const complete = vi.fn()
  const unusedHook = (() => { throw new Error('unused standard hook') }) as never
  const props: DeepSeekOnboardingDialogProps = {
    automatic: true,
    stepId: 'deepseek-official',
    complete,
    openSection,
    renderSlot: (_name, _props, options) => options?.fallback,
    useSessions: unusedHook,
    useSessionStatus,
    usePanelInfo, useSessionRetainInfo: () => undefined, useResource,
    useWorkspaces: unusedHook,
    ...allowAllAccess,
    useContextMenu: contextMenuHook(),
    controller,
    useModels: bindSnapshotSelector(controller.store),
    operations,
    schema: settingsSchema,
    t: key => en[key],
  }
  return {
    controller, complete, openSection, props, mutate, set,
    configure: () => { fileConfigured = true },
  }
}

describe('DeepSeekOnboardingDialog', () => {
  it('renders when the shell root is absent', async () => {
    const h = harness()
    document.getElementById('root')!.remove()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    expect(await screen.findByRole('dialog', { name: en.onboardingTitle })).toBeTruthy()
  })

  it('loads a credential-only modal, inerts the product, and focuses the key', async () => {
    const h = harness()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    expect(await screen.findByRole('dialog', { name: en.onboardingTitle })).toBeTruthy()
    expect(document.getElementById('root')?.inert).toBe(true)
    expect(screen.getByText(en.onboardingDescription)).toBeTruthy()
    const key = screen.getByLabelText<HTMLInputElement>(en.keyInput)
    await waitFor(() => { expect(document.activeElement).toBe(key) })
    expect(screen.queryByText(en.customized)).toBeNull()
  })

  it('cannot be dismissed implicitly and restores the previous inert state', async () => {
    const h = harness()
    const appRoot = document.getElementById('root')!
    appRoot.inert = true
    const view = render(<DeepSeekOnboardingDialog {...h.props} />)
    await screen.findByRole('dialog')

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(document.querySelector('[class*="mask"]')!)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(h.complete).not.toHaveBeenCalled()

    view.unmount()
    expect(appRoot.inert).toBe(true)
  })

  it('requires a non-blank key before Save and continue is available', async () => {
    const h = harness()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    await screen.findByRole('dialog')
    const save = screen.getByRole<HTMLButtonElement>('button', { name: en.onboardingSave })
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(en.keyInput), { target: { value: '   ' } })
    expect(save.disabled).toBe(true)
    expect(screen.getByText(en.keyRequired)).toBeTruthy()
    expect(h.set).not.toHaveBeenCalled()
  })

  it('keeps the modal open and reports a refused credential write', async () => {
    for (const [options, message] of [
      [{ setFailure: 'credential was rejected' }, 'credential was rejected'],
    ] as const) {
      const h = harness(options)
      const view = render(<DeepSeekOnboardingDialog {...h.props} />)
      await screen.findByRole('dialog')
      fireEvent.change(screen.getByLabelText(en.keyInput), { target: { value: 'sk-live' } })
      fireEvent.click(screen.getByRole('button', { name: en.onboardingSave }))
      expect(await screen.findByText(message)).toBeTruthy()
      expect(screen.getByRole('dialog')).toBeTruthy()
      expect(screen.getByRole<HTMLButtonElement>('button', { name: en.onboardingSave }).disabled).toBe(false)
      expect(h.complete).not.toHaveBeenCalled()
      expect(h.mutate).not.toHaveBeenCalled()
      view.unmount()
    }
  })

  it('allows configure-later dismissal without opening settings', async () => {
    const h = harness()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: en.onboardingLater }))
    expect(h.complete).toHaveBeenCalledOnce()
    expect(h.openSection).not.toHaveBeenCalled()
    expect(h.set).not.toHaveBeenCalled()
    expect(h.mutate).not.toHaveBeenCalled()
  })

  it('does not block the product when DeepSeek setup is unavailable', async () => {
    for (const h of [
      harness({ describeFailure: 'credentials service is absent' }),
      harness({ credential: { writable: false } }),
      harness({ settingsWritable: false }),
      harness({ providersFailure: 'the provider directory is unavailable' }),
      harness({ providerActive: false }),
      harness({ settingsNamespace: false }),
      harness({ apiKeyEnv: null }),
    ]) {
      const view = render(<DeepSeekOnboardingDialog {...h.props} />)
      await act(async () => { await h.controller.load() })
      expect(screen.queryByRole('dialog')).toBeNull()
      await waitFor(() => { expect(h.complete).toHaveBeenCalledOnce() })
      expect(h.openSection).not.toHaveBeenCalled()
      view.unmount()
    }
  })

  it('skips an absent adapter and an already-configured environment credential', async () => {
    for (const h of [
      harness({ provider: false }),
      harness({ providerSettingsNs: '' }),
      harness({ configured: () => true, credential: { source: 'env', writable: false } }),
    ]) {
      const view = render(<DeepSeekOnboardingDialog {...h.props} />)
      await act(async () => { await h.controller.load() })
      expect(screen.queryByRole('dialog')).toBeNull()
      await waitFor(() => { expect(h.complete).toHaveBeenCalledOnce() })
      view.unmount()
    }
  })

  it('closes when an external credential invalidation refreshes the shared join', async () => {
    const h = harness()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    await screen.findByRole('dialog')
    h.configure()
    await act(async () => { await h.controller.load() })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(h.complete).toHaveBeenCalledOnce()
  })
})

it('offers account choice before reusing the existing API key editor', async () => {
  const h = harness()
  h.props.renderSlot = (name, owner: unknown, options) => name === 'settings.models.sign-in'
    ? <button onClick={(owner as { useApiKey: () => void }).useApiKey}>Choose API key</button>
    : options?.fallback
  render(<DeepSeekOnboardingDialog {...h.props} />)
  await waitFor(() => { expect(screen.getByRole('button', { name: 'Choose API key' })).toBeTruthy() })
  fireEvent.click(screen.getByRole('button', { name: 'Choose API key' }))
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(h.complete).not.toHaveBeenCalled()
})
it('explicit account-menu setup reuses the editor without another login choice', async () => {
  const h = harness({ configured: () => true })
  h.props.explicit = true
  const choice = vi.fn()
  h.props.renderSlot = (name, _owner, options) => { if (name === 'settings.models.sign-in') choice(); return options?.fallback }
  render(<DeepSeekOnboardingDialog {...h.props} />)
  await waitFor(() => { expect(screen.getByRole('dialog')).toBeTruthy() })
  expect(choice).not.toHaveBeenCalled()
  expect(h.complete).not.toHaveBeenCalled()
})

it('keeps explicit API key setup available when automatic onboarding is disabled', async () => {
  const h = harness()
  h.props.automatic = false
  h.props.explicit = true
  render(<DeepSeekOnboardingDialog {...h.props} />)
  await waitFor(() => { expect(screen.getByRole('dialog')).toBeTruthy() })
  expect(h.complete).not.toHaveBeenCalled()
})

/** The `settings.models.credential-prompt` owner share, from this package's own declaration. */
type CredentialPromptOwner = SlotMap['settings.models.credential-prompt']['owner']

/** The owner props a stand-in credential prompt received on its latest render. */
interface PromptRecord {
  /** The latest dispatch, once the dialog has reached its credential step. */
  latest: CredentialPromptOwnerProps | undefined
}

/**
 * Mount the dialog with `settings.models.credential-prompt` replaced by a
 * stand-in prompt, as a plugin distributed outside this repository would.
 * @param h - the harness whose dialog is mounted.
 * @param record - receives the owner props of every dispatch.
 * @returns after the dialog's first render.
 */
function mountReplacedPrompt(h: ReturnType<typeof harness>, record: PromptRecord): void {
  h.props.renderSlot = (name, owner, options) => {
    if (name !== 'settings.models.credential-prompt') return options?.fallback
    const prompt = promptOwner(owner)
    record.latest = prompt
    return (
      <div>
        <p>custom credential prompt</p>
        <button type="button" onClick={() => { void prompt.save('sk-replacement') }}>Save the replacement key</button>
        <button type="button" onClick={prompt.close}>Dismiss the replacement</button>
      </div>
    )
  }
  render(<DeepSeekOnboardingDialog {...h.props} />)
}

/**
 * The credential-prompt owner share of one dispatch. The seat renderer types
 * owner props per seat, so the two seats' shares arrive as one union here.
 * @param owner - the owner props the dialog dispatched to the seat.
 * @returns those owner props as this package's own declaration types them.
 */
function promptOwner(owner: { provider?: string; displayName?: string; save?: CredentialPromptOwnerProps['save']; close?: () => void }): CredentialPromptOwnerProps {
  if (owner.provider === undefined || owner.displayName === undefined
    || owner.save === undefined || owner.close === undefined) {
    throw new Error('the credential prompt received owner props of another seat')
  }
  return { provider: owner.provider, displayName: owner.displayName, save: owner.save, close: owner.close }
}

/**
 * The owner props of the latest credential-prompt dispatch.
 * @param record - the record the mounted dialog writes into.
 * @returns the owner props.
 */
function promptOf(record: PromptRecord): CredentialPromptOwner {
  if (record.latest === undefined) throw new Error('the credential prompt was never dispatched')
  return record.latest
}

describe('credential prompt replacement', () => {
  it('renders the registered credential prompt instead of its own key editor', async () => {
    const h = harness()
    mountReplacedPrompt(h, { latest: undefined })
    expect(await screen.findByText('custom credential prompt')).toBeTruthy()
    // The dialog's own editor never mounts, so neither does its key field.
    expect(screen.queryByLabelText(en.keyInput)).toBeNull()
    expect(screen.queryByText(en.onboardingDescription)).toBeNull()
  })

  it('hands the replacement prompt the provider, its name, and the save and close actions', async () => {
    const h = harness()
    const record: PromptRecord = { latest: undefined }
    mountReplacedPrompt(h, record)
    await screen.findByText('custom credential prompt')
    expect(promptOf(record).provider).toBe('deepseek-official')
    expect(promptOf(record).displayName).toBe('DeepSeek')
    expect(typeof promptOf(record).save).toBe('function')
    expect(typeof promptOf(record).close).toBe('function')
  })

  it('refuses a whitespace-only key with the required-key copy and completes nothing', async () => {
    const h = harness()
    const record: PromptRecord = { latest: undefined }
    mountReplacedPrompt(h, record)
    await screen.findByText('custom credential prompt')
    await expect(promptOf(record).save('  ')).rejects.toThrow(en.keyRequired)
    expect(h.set).not.toHaveBeenCalled()
    expect(h.complete).not.toHaveBeenCalled()
  })

  it('stores a valid key under the conventional reference and completes the step', async () => {
    const h = harness()
    mountReplacedPrompt(h, { latest: undefined })
    fireEvent.click(await screen.findByRole('button', { name: 'Save the replacement key' }))
    await waitFor(() => { expect(h.set).toHaveBeenCalledWith('DEEPSEEK_API_KEY', 'sk-replacement') })
    await waitFor(() => { expect(h.complete).toHaveBeenCalled() })
  })

  it('completes the step when the replacement prompt closes without a key', async () => {
    const h = harness()
    mountReplacedPrompt(h, { latest: undefined })
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss the replacement' }))
    expect(h.complete).toHaveBeenCalledOnce()
    expect(h.set).not.toHaveBeenCalled()
  })
})

describe('deployment default provider', () => {
  it('skips the dialog entirely when the deployment defaults to another route', async () => {
    const h = harness({ defaultProvider: 'example-gateway' })
    render(<DeepSeekOnboardingDialog {...h.props} />)
    await act(async () => { await h.controller.load() })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByLabelText(en.keyInput)).toBeNull()
    await waitFor(() => { expect(h.complete).toHaveBeenCalledOnce() })
    expect(h.set).not.toHaveBeenCalled()
  })

  it('still prompts when another route is the default but setup was asked for explicitly', async () => {
    const h = harness({ defaultProvider: 'example-gateway' })
    h.props.explicit = true
    render(<DeepSeekOnboardingDialog {...h.props} />)
    expect(await screen.findByRole('dialog', { name: en.onboardingTitle })).toBeTruthy()
    expect(h.complete).not.toHaveBeenCalled()
  })
})
