import { IconFolderCloseRegular, IconFolderOpenRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceChipIconProps } from './contract/slots.ts'
import css from './WorkspacePicker.module.css'

/**
 * Icon leading the blank-session Workspace chip: the selected Workspace's
 * presentation icon, otherwise the open or closed folder the chip shows by default.
 * @param props - see {@link WorkspaceChipIconProps}.
 * @returns the icon element.
 */
export function WorkspaceChipIcon({ selectedId, hasLabel, useWorkspacePresentation }: WorkspaceChipIconProps) {
  const icon = useWorkspacePresentation(state => state.items.find(item => item.workspaceId === selectedId)?.icon)
  if (icon !== undefined) {
    return <img className={css.optionIcon} src={icon.src} alt={icon.alt} title={icon.title} aria-label={icon.ariaLabel} />
  }
  return hasLabel
    ? <IconFolderOpenRegular className={css.chipFolder} size={16} />
    : <IconFolderCloseRegular className={css.chipFolder} size={16} />
}
