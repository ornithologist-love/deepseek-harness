// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { WorkspaceChipIconProps } from '../src/client/contract/slots.ts'
import { WorkspaceChipIcon } from '../src/client/WorkspaceChipIcon.tsx'
import { DEFAULT_WORKSPACE_PRESENTATION, type WorkspacePresentationSnapshot } from '../src/client/presentation.ts'

afterEach(cleanup)

const wid = (id: string) => id as WorkspaceId

function renderIcon(
  owner: Pick<WorkspaceChipIconProps, 'selectedId' | 'hasLabel'>,
  presentation: WorkspacePresentationSnapshot = DEFAULT_WORKSPACE_PRESENTATION,
) {
  const props = { ...owner, useWorkspacePresentation: bindSnapshotSelector(createSnapshotStore(presentation)) }
  return render(<WorkspaceChipIcon {...props as WorkspaceChipIconProps} />)
}

describe('WorkspaceChipIcon', () => {
  it('shows the selected Workspace presentation icon', () => {
    renderIcon({ selectedId: wid('a'), hasLabel: true }, {
      ...DEFAULT_WORKSPACE_PRESENTATION,
      items: [{ workspaceId: wid('a'), icon: { src: 'data:image/png;base64,', alt: 'Project', ariaLabel: 'Project icon' } }],
    })
    expect(screen.getByRole('img', { name: 'Project icon' }).getAttribute('alt')).toBe('Project')
  })

  it('keeps the open folder for a labelled chip without an icon and the closed folder for the placeholder', () => {
    const labelled = renderIcon({ selectedId: wid('a'), hasLabel: true })
    const open = labelled.container.innerHTML
    expect(labelled.container.querySelector('svg')).toBeTruthy()
    cleanup()
    const placeholder = renderIcon({ selectedId: undefined, hasLabel: false })
    expect(placeholder.container.querySelector('svg')).toBeTruthy()
    expect(placeholder.container.innerHTML).not.toBe(open)
  })
})
