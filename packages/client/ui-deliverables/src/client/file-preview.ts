/** Per-file presentation of one declared delivery, rendered before the delivery card. */
import type { PresentedPath } from './turn-deliverables.ts'

/** One declared delivery position offered to preview contributions. */
export interface DeliverableFilePreviewOwner {
  /** The declared file this position presents. */
  readonly file: PresentedPath
  /** Session working directory that relative file paths resolve against, when known. */
  readonly cwd: string | undefined
  /** Stable JSON pair of the viewed Session ID and the closing root Turn number; groups previews of one Turn. */
  readonly scope: string
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Content rendered before one delivery card, inside that file's grid
     * position. An element whose root carries `data-deliverable-preview`
     * widens the position to the whole row. Without a contribution, the
     * position holds the delivery card alone and the rows are unchanged.
     * @example
     * return {
     *   inject: ['slots'],
     *   apply(ctx) {
     *     ctx.slots.inject('deliverables.file.preview', () => ctx.slots.register(
     *       { name: 'deliverables.file.preview', id: 'image-preview', order: 100 },
     *       ({ file, cwd }) => React.createElement('img', {
     *         src: resolvePath(cwd, file.path), alt: file.path, 'data-deliverable-preview': true,
     *       }),
     *     ))
     *   },
     * }
     */
    'deliverables.file.preview': {
      kind: 'list'
      scope: 'session'
      owner: DeliverableFilePreviewOwner
    }
  }
}
