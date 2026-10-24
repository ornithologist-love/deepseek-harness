// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { contextMenuHook } from '@deepseek-ai/dsh-client-test-runtime'
import type { ComponentProps } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
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

function assistantNode(turn: number | undefined): ChatNode<'assistant-step'> {
  return {
    key: 'assistant:1',
    kind: 'assistant-step',
    id: '1',
    target: 'chat',
    anchorSeq: 1,
    location: turn === undefined
      ? { kind: 'unresolved' }
      : { kind: 'turn', turn: { turn } as TurnLocation },
    visibility: 'visible',
    data: {
      status: 'settled',
      turn: turn ?? 0,
      step: 1,
      time: 1_000,
      blocks: [{ kind: 'text', text: IMAGE_MARKDOWN }],
    },
  } as ChatNode<'assistant-step'>
}

function renderView(turn: number | undefined) {
  const renderSlot = vi.fn<ComponentProps<typeof AssistantNodeView>['renderSlot']>(
    (_name, _owner, options) => options?.fallback ?? null,
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
      useContextMenu={contextMenuHook()}
      useTurnData={() => undefined}
      useDisclosure={useDisclosure}
      useGroupAction={useSearchableHidden}
      usePresentation={useDetailedPresentation}
      renderSlot={renderSlot}
      sessionId={SID}
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
