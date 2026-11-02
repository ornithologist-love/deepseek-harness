// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fileMediaUrl } from '@deepseek-ai/dsh-util-workspace-path'
import { AssistantMarkdown, localPathMediaUrl } from '../src/client/chat/AssistantMarkdown.tsx'
import type { AssistantMarkdownProps } from '../src/client/chat/AssistantMarkdown.tsx'
import { useDetailedPresentation } from './presentation-fixture.client.ts'
import { unusedImageLoader } from './reasoning-component-fixture.tsx'
import { useDisclosure } from '../src/client/chat/use-disclosure.ts'
import { useSearchableHidden } from '../src/client/chat/searchable-hidden.ts'
import type { ChatViewSlotProps } from '../src/client/contract/slots.ts'
import type { AssistantBlock } from '../src/client/contract/snapshot.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const t = ((_key: string) => 'label') as ChatViewSlotProps['t']

/** Child dispatch stub without contributions: every child keeps its native fallback. */
const renderNativeFallback: AssistantMarkdownProps['renderSlot'] = (_key, _owner, options) => options?.fallback ?? null

function textBlock(text: string): AssistantBlock {
  return { kind: 'text', text }
}

const BASE = 'http://127.0.0.1:3080/'
const MOUNTED_BASE = 'http://127.0.0.1:3080/tools/dsh/'

describe('localPathMediaUrl', () => {
  it('maps an absolute POSIX path to the file route of the document, root or mount', () => {
    const path = encodeURIComponent('/tmp/graph.png')
    for (const [base, root] of [
      [BASE, BASE],
      ['https://127.0.0.1:3080/', 'https://127.0.0.1:3080/'],
      [MOUNTED_BASE, MOUNTED_BASE],
      ['dsh-app://app/', 'dsh-app://app/'],
      ['dsh-app://app/index.html', 'dsh-app://app/'],
      ['http://127.0.0.1:3080/tools/dsh/index.html', MOUNTED_BASE],
    ]) {
      expect(localPathMediaUrl(base!, '/tmp/graph.png')).toBe(`${root!}api/file?path=${path}`)
    }
  })

  it('keeps unsupported application transports inert', () => {
    expect(localPathMediaUrl('about:blank', '/tmp/graph.png')).toBeUndefined()
    expect(localPathMediaUrl('dsh-app://shell/', '/tmp/graph.png')).toBeUndefined()
    expect(localPathMediaUrl('file:///app', '/tmp/graph.png')).toBeUndefined()
    expect(localPathMediaUrl('ws://127.0.0.1:3080/', '/tmp/graph.png')).toBeUndefined()
  })

  it('keeps destinations that cannot be Host-served local files inert', () => {
    expect(localPathMediaUrl(BASE, '')).toBeUndefined()
    expect(localPathMediaUrl(BASE, '//cdn.example.com/x.png')).toBeUndefined()
    expect(localPathMediaUrl(BASE, 'relative.png')).toBeUndefined()
    expect(new URL(localPathMediaUrl(BASE, 'C:\\tmp\\x.png')!).searchParams.get('path')).toBe('C:\\tmp\\x.png')
  })

  it('encodes the full path including spaces', () => {
    expect(localPathMediaUrl(BASE, '/tmp/my graph.png'))
      .toBe(`${BASE}api/file?path=${encodeURIComponent('/tmp/my graph.png')}`)
  })

  it('resolves local file URLs that name a local path', () => {
    const cases = [
      ['file:///tmp/a.png', '/tmp/a.png'],
      ['file:///C:/work/a%20b.png', 'C:/work/a b.png'],
      ['file://localhost/tmp/a.png', '/tmp/a.png'],
    ] as const
    for (const [authored, path] of cases) {
      expect(localPathMediaUrl(BASE, authored)).toBe(fileMediaUrl(BASE, path))
      expect(new URL(localPathMediaUrl(BASE, authored)!).searchParams.get('path')).toBe(path)
    }
  })

  it('keeps file URLs inert when they name no local file', () => {
    expect(localPathMediaUrl(BASE, 'file://server/share/a.png')).toBeUndefined()
    expect(localPathMediaUrl(BASE, 'file:///tmp/%E0%A4%A.png')).toBeUndefined()
    expect(localPathMediaUrl(BASE, 'file://[')).toBeUndefined()
  })

  it('keeps a literal percent sign in a raw Windows path', () => {
    expect(new URL(localPathMediaUrl(BASE, 'C:\\data\\50%off.png')!).searchParams.get('path'))
      .toBe('C:\\data\\50%off.png')
    expect(localPathMediaUrl(BASE, 'C:\\data\\50%off.png')).toBe(fileMediaUrl(BASE, 'C:\\data\\50%off.png'))
  })

  it('keeps invalid percent encoding inert outside Windows paths', () => {
    expect(localPathMediaUrl(BASE, '/tmp/50%off.png')).toBeUndefined()
  })
})

describe('AssistantMarkdown local-path images', () => {
  it.each([BASE, 'dsh-app://app/'])('renders a local image in closing prose through %s', (base) => {
    vi.spyOn(document, 'baseURI', 'get').mockReturnValue(base)
    const { container } = render(
      <AssistantMarkdown renderSlot={renderNativeFallback} useDisclosure={useDisclosure} useGroupAction={useSearchableHidden}
        usePresentation={useDetailedPresentation}
        blocks={[textBlock('See ![diagram](/tmp/graph.png) for the layout.')]}
        streaming={false}
        loadImage={unusedImageLoader}
        t={t}
      />,
    )
    const image = container.querySelector('img')
    expect(image?.getAttribute('alt')).toBe('diagram')
    const url = new URL(image?.getAttribute('src') ?? '')
    expect(url.pathname).toBe('/api/file')
    expect(url.protocol).toBe(new URL(base).protocol)
    expect(url.searchParams.get('path')).toBe('/tmp/graph.png')
  })

  it('keeps non-absolute destinations inert', () => {
    const { container } = render(
      <AssistantMarkdown renderSlot={renderNativeFallback} useDisclosure={useDisclosure} useGroupAction={useSearchableHidden}
        usePresentation={useDetailedPresentation}
        blocks={[textBlock('See ![diagram](relative.png).')]}
        streaming={false}
        loadImage={unusedImageLoader}
        t={t}
      />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('diagram')
  })
})

describe('AssistantMarkdown Markdown image Slot', () => {
  const IMAGE_MARKDOWN = 'See ![diagram](/tmp/graph.png) for the layout.'
  const CWD = 'C:\\work\\proj'

  it('renders a settled image through a contributed replacement', () => {
    vi.spyOn(document, 'baseURI', 'get').mockReturnValue(BASE)
    const renderSlot = vi.fn(() => (
      // The replacement replaces the native presentation entirely.
      <span data-testid="replacement">replaced</span>
    ))
    const { container } = render(
      <AssistantMarkdown renderSlot={renderSlot} useDisclosure={useDisclosure} useGroupAction={useSearchableHidden}
        usePresentation={useDetailedPresentation}
        blocks={[textBlock(IMAGE_MARKDOWN)]}
        streaming={false}
        loadImage={unusedImageLoader}
        cwd={CWD}
        imageScope={JSON.stringify(['s1', 3])}
        t={t}
      />,
    )
    expect(container.querySelector('[data-testid="replacement"]')).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
    expect(renderSlot).toHaveBeenCalledWith('conversation.chat.markdown.image', {
      destination: '/tmp/graph.png',
      alt: 'diagram',
      cwd: CWD,
      scope: JSON.stringify(['s1', 3]),
    }, { fallback: expect.anything() })
  })

  it('keeps the native image when no replacement is contributed', () => {
    vi.spyOn(document, 'baseURI', 'get').mockReturnValue(BASE)
    const renderSlot = vi.fn((_name: string, _owner: object, options?: { fallback?: React.ReactNode }) => options?.fallback ?? null)
    const { container } = render(
      <AssistantMarkdown renderSlot={renderSlot} useDisclosure={useDisclosure} useGroupAction={useSearchableHidden}
        usePresentation={useDetailedPresentation}
        blocks={[textBlock(IMAGE_MARKDOWN)]}
        streaming={false}
        loadImage={unusedImageLoader}
        t={t}
      />,
    )
    expect(container.querySelector('[data-testid="replacement"]')).toBeNull()
    const image = container.querySelector('img')
    expect(image?.getAttribute('alt')).toBe('diagram')
    expect(new URL(image?.getAttribute('src') ?? '').searchParams.get('path')).toBe('/tmp/graph.png')
  })
})

it('decodes Markdown URL escapes once before encoding the file query', () => {
  for (const [authored, path] of [
    ['/work/test%20workspace/图.png', '/work/test workspace/图.png'],
    ['/work/100%25%23.png', '/work/100%#.png'],
    ['/work/literal%2520.png', '/work/literal%20.png'],
  ]) expect(new URL(localPathMediaUrl(BASE, authored!)!).searchParams.get('path')).toBe(path)
  expect(localPathMediaUrl(BASE, '/work/bad%escape.png')).toBeUndefined()
})
