/** Capture delivery action ownership without duplicating the opening-control implementation, and stand in for preview contributions. */
import type { PropsRenderSlots, SlotMap } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '../src/client/index.ts'

/** Slot renderer exposing the owning route and gesture for component tests. */
export const renderFileActions: PropsRenderSlots<'deliverables.file.actions' | 'deliverables.review.file.actions'>['renderSlot'] = (_name: string, input) => {
  const props = input satisfies SlotMap['deliverables.file.actions']['owner']
  return props.available ? <button type="button" data-action-url={props.actionUrl} disabled={props.pending}
    onClick={() => { void props.onAction('open') }}>Native file action</button> : null
}

/**
 * Every child slot a delivery card is rendered through, dispatched by slot name.
 * @param name - declared child slot key.
 * @param input - owner props for that key.
 * @returns the action control, or no preview contribution.
 */
export const renderFilePreviews: PropsRenderSlots<'deliverables.file.actions' | 'deliverables.file.preview'>['renderSlot'] = (name, input) => {
  if (name === 'deliverables.file.preview') return null
  return renderFileActions(name, input)
}
