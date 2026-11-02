// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { allowAllAccess, bindSnapshotSelector, contextMenuHook } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { GlobalStandardProps, SessionStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { EMPTY_CONVERSATION_SNAPSHOT, type TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNode } from '../src/client/contract/chat-nodes.ts'
import type { ChatNodeViewProps } from '../src/client/contract/slots.ts'
import { AssistantNodeView } from '../src/client/chat/AssistantNodeView.tsx'
import { useDetailedPresentation } from './presentation-fixture.client.ts'
import { unusedImageLoader } from './reasoning-component-fixture.tsx'
import { useDisclosure } from '../src/client/chat/use-disclosure.ts'
import { useSearchableHidden } from '../src/client/chat/searchable-hidden.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const SID = 'session-a' as SessionId
const CWD = 'C:\\work\\proj'
const IMAGE_MARKDOWN = '![diagram](/tmp/graph.png)'
const t = ((_key: string) => 'label') as ChatNodeViewProps['t']

// The renderer never reads the page-level or Workspace seats; they only have to exist.
const useResource: GlobalStandardProps['useResource'] =
  () => ({ status: 'none', value: undefined, failure: undefined })

/** Session and global standard seats the renderer receives; it reads none of them beyond the Session id. */
const standard: SessionStandardProps & GlobalStandardProps & Record<'sessionId', SessionId> = {
  sessionId: SID,
  useSession: (() => undefined) as SessionStandardProps['useSession'],
  // The renderer reads no projection key; the empty answer is the declared hook shape.
  // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- An empty reader does not satisfy the keyed accessor.
  useProjection: (() => undefined) as SessionStandardProps['useProjection'],
  useInput: () => { throw new Error('unused') },
  inputActions: {
    insertQuote: () => false,
    captureInsertion: () => ({ start: 0, end: 0, draftRev: 0 }),
    insertText: () => false,
    setDraft: () => {},
    persistDraft: () => {},
    addAttachments: () => true,
    removeAttachment: () => {},
    pruneAttachments: () => {},
    submit: () => {},
  },
  useConversation: bindSnapshotSelector(createSnapshotStore(EMPTY_CONVERSATION_SNAPSHOT)),
  useChat: (() => undefined) as SessionStandardProps['useChat'],
  useTrajectory: () => { throw new Error('unused') },
  useSessionRetainInfo: () => undefined,
  useSessions: bindSnapshotSelector(createSnapshotStore<SessionListState>({
    ids: [], byId: {}, phase: 'ready', projectionsBySession: {},
  })),
  useSessionStatus: bindSnapshotSelector(createSnapshotStore<SessionStatusSnapshot>(new Map())),
  useWorkspaces: bindSnapshotSelector(createSnapshotStore<WorkspaceSnapshot>({
    items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  })),
  usePanelInfo: selector => selector({ activePanelId: null }),
  useContextMenu: contextMenuHook(),
  useResource,
  ...allowAllAccess,
}

/**
 * One settled Assistant Step holding a Markdown image.
 * @param turn - closing Turn number, or undefined outside a Turn.
 * @returns the projected Chat Node.
 */
function assistantNode(turn: number | undefined): ChatNode<'assistant-step'> {
  const location: ChatNode<'assistant-step'>['location'] = turn === undefined
    ? { kind: 'unresolved' }
    : { kind: 'turn', turn: { turn } as TurnLocation }
  return {
    key: 'assistant:1',
    kind: 'assistant-step',
    id: '1',
    target: 'chat',
    anchorSeq: 1,
    location,
    visibility: 'visible',
    data: {
      status: 'settled',
      turn: turn ?? 0,
      step: 1,
      time: 1_000,
      blocks: [{ kind: 'text', text: IMAGE_MARKDOWN }],
    },
  }
}

function renderView(turn: number | undefined) {
  const renderSlot = vi.fn(
    (_name: string, _owner: object, options?: { fallback?: React.ReactNode }) => options?.fallback ?? null,
  )
  render(
    <AssistantNodeView
      node={assistantNode(turn)}
      cwd={CWD}
      openFile={() => {}}
      inspectCall={undefined}
      forkAt={() => {}}
      loadImage={unusedImageLoader}
      fileMentions={() => undefined}
      resolveFilePath={path => path}
      useTurnData={() => undefined}
      useDisclosure={useDisclosure}
      useGroupAction={useSearchableHidden}
      usePresentation={useDetailedPresentation}
      renderSlot={renderSlot}
      renderFactorySlot={() => null}
      SessionProvider={({ children }: { children?: React.ReactNode }) => <>{children}</>}
      {...standard}
      t={t}
    />,
  )
  return renderSlot
}

describe('AssistantNodeView Markdown image Slot', () => {
  it('offers the viewed Session, workspace, and root Turn to a settled image', () => {
    const renderSlot = renderView(4)
    expect(renderSlot).toHaveBeenCalledWith('conversation.chat.markdown.image', {
      destination: '/tmp/graph.png',
      alt: 'diagram',
      cwd: CWD,
      scope: JSON.stringify([SID, 4]),
    }, { fallback: expect.anything() })
  })

  it('offers no scope outside a Turn', () => {
    const renderSlot = renderView(undefined)
    expect(renderSlot).toHaveBeenCalledWith('conversation.chat.markdown.image', {
      destination: '/tmp/graph.png',
      alt: 'diagram',
      cwd: CWD,
      scope: undefined,
    }, { fallback: expect.anything() })
  })
})
