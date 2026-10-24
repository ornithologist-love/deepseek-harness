import { describe, expect, it } from 'vitest'
import { SettingsShell } from '../src/client/shell-service.ts'
import { createSettingsShellStore } from '../src/client/shell-store.ts'

describe('SettingsShell', () => {
  it('opens the dialog at the requested section or at the first one', () => {
    const { store, actions } = createSettingsShellStore().create()
    const shell = new SettingsShell(actions)

    shell.open('models')
    expect(store.getSnapshot()).toEqual({ open: true, activeId: 'models' })

    actions.close()
    shell.open()
    expect(store.getSnapshot()).toEqual({ open: true, activeId: undefined })
  })
})
