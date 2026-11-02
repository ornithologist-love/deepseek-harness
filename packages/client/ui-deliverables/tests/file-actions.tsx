/** Capture delivery action ownership without duplicating the opening-control implementation, and stand in for preview contributions. */
import type { PropsRenderSlots, SlotMap } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '../src/client/index.ts'

/**
 * Delivery action control for the action Slots that render one.
 * @param props - delivery action owner props.
 * @returns the action control, or nothing when the action is unavailable.
 */
export function renderFileAction(props: SlotMap['deliverables.file.actions']['owner']) {
  return props.available ? <button type="button" data-action-url={props.actionUrl} disabled={props.pending}
    onClick={() => { void props.onAction('open') }}>Native file action</button> : null
}

/**
 * Every child slot a delivery card is rendered through, dispatched by slot name.
 * An inline parameter annotation keeps both shares unusable, so the action key
 * widens the share once and reads it back as the action owner.
 * @param name - declared child slot key.
 * @param input - owner props for that key.
 * @returns the action control, or no preview contribution.
 */
export const renderFilePreviews: PropsRenderSlots<'deliverables.file.actions' | 'deliverables.file.preview'>['renderSlot'] =
  (name, input) => {
    if (name === 'deliverables.file.preview') return null
    const widened = (): object => input
    return renderFileAction(widened() as SlotMap['deliverables.file.actions']['owner'])
  }
