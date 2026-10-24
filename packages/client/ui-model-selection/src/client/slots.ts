/** Composer model selection injection and inline label extension. */
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelCatalogModel, ModelProviderGroup } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelDirectoryState } from './directory.ts'

/** Catalog data for a model name inside the composer's existing controls. */
export interface ModelLabelOwner {
  /** Provider identity and localized display name; contains no connection configuration. */
  provider: Pick<ModelProviderGroup, 'id' | 'name'>
  /** The exact provider's model catalog entry. */
  model: ModelCatalogModel
  /** Trigger caption, root-menu current value, or selectable model row. */
  placement: 'trigger' | 'menu' | 'option'
  /** Whether this provider/model pair is the current selection. */
  selected: boolean
}

/** A provider, and for model rows a catalog model, whose mark the model menu shows. */
export interface ModelIconOwner {
  /** Provider identity; absent on the trigger while no listed model is selected. */
  provider: Pick<ModelProviderGroup, 'id' | 'name'> | undefined
  /** The catalog entry for trigger and option placements; absent for group headings and while no listed model is selected. */
  model: ModelCatalogModel | undefined
  /** Trigger button, provider group heading, or selectable model row. */
  placement: 'trigger' | 'group' | 'option'
}

/** A provider whose catalog lists no models, offered a setup action inside the menu. */
export interface ModelProviderSetupOwner {
  /** Provider identity and localized display name. */
  provider: Pick<ModelProviderGroup, 'id' | 'name'>
  /** Close the model menu, for an action that moves focus elsewhere. */
  close: () => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Decorative mark before a model caption, provider heading, or model row.
     * Without a contribution, the trigger shows the generic model icon and other placements show none.
     */
    'conversation.input.model.icon': {
      kind: 'single'
      scope: 'session'
      inline: true
      owner: ModelIconOwner
    }
    /** Non-interactive trailing badge on a model row, such as a price tier; empty without a contribution. */
    'conversation.input.model.badge': {
      kind: 'single'
      scope: 'session'
      inline: true
      owner: Omit<ModelLabelOwner, 'placement'>
    }
    /** Setup action for a provider with an empty catalog; while any contribution is registered, such providers stay listed. */
    'conversation.input.model.provider-setup': {
      kind: 'single'
      scope: 'session'
      owner: ModelProviderSetupOwner
    }
    /**
     * Non-interactive inline model label; selection controls remain owner-managed.
     * Without a contribution, the badge precedes the catalog name in the trigger
     * and follows it in menus.
     * @example
     * return {
     *   inject: ['slots'],
     *   apply(ctx) {
     *     ctx.slots.inject('conversation.input.model.label', () => ctx.slots.register(
     *       { name: 'conversation.input.model.label' },
     *       ({ provider, model }) => React.createElement('span', { title: provider.name }, model.name),
     *     ))
     *   },
     * }
     */
    'conversation.input.model.label': {
      kind: 'single'
      scope: 'session'
      inline: true
      owner: ModelLabelOwner
    }
  }
}

/** Injected business face of the composer model seat. */
export interface ModelSelectInjected {
  /** Whether this session supports Agent-bound model inspection and selection. */
  available: boolean
  /** The session's shared directory store (same instance the /model popup reads). */
  directory: SnapshotStore<ModelDirectoryState>
  /** Ensure the shared advisory catalog is loaded (errors land on the store). */
  load: () => void
  /**
   * Choose a catalog badge's provider-authored text for the active locale.
   * @param text - the badge's literal text or translations.
   * @returns the text to display.
   */
  resolveText: (text: NonNullable<ModelCatalogModel['badge']>['text']) => string
  /**
   * Select a complete provider/model/reasoning selection.
   * @param selection - model selection and optional adapter-owned effort.
   * @returns the Host outcome, or undefined when this Session cannot select a model.
   */
  select: (selection: ModelSelection) => Promise<RemoteResult<void> | undefined>
  /**
   * Whether a `conversation.input.model.provider-setup` contribution is registered, read while rendering.
   * @returns true when providers with an empty catalog should stay listed with their setup action.
   */
  offersProviderSetup: () => boolean
}
