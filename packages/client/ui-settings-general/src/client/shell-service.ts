/**
 * SettingsShell: the cross-plugin navigation face behind ctx.settingsShell.
 * Features that point the user at their own settings (a missing credential, a
 * server status badge) open the dialog through it instead of synthesizing
 * clicks; writes stay inside the shell store's declared action set, shared
 * with the `sidebar.settings` registration and the `settings.open` command.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { createSettingsShellStore } from './shell-store.ts'

/** The shell store's bound action set. */
export type SettingsShellActions = BoundActions<ReturnType<typeof createSettingsShellStore>>

/** Settings dialog navigation exposed through ctx.settingsShell. */
export interface ISettingsShell {
  /**
   * Open the settings dialog.
   * @param sectionId - registered `settings.section` id to show; absent or
   *   unregistered shows the first section.
   */
  open(sectionId?: string): void
}

/** Cross-plugin settings navigation face (ctx.settingsShell). */
export class SettingsShell implements ISettingsShell {
  /** @param actions - actions of the instance shared with the root entry. */
  constructor(private readonly actions: SettingsShellActions) {}

  /** Open the dialog, at a section when one is named. */
  open(sectionId?: string): void {
    if (sectionId === undefined) this.actions.open()
    else this.actions.openSection(sectionId)
  }
}
