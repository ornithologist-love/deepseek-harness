import { useCallback, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import type { ExternalWorkspaceCatalog, ExternalWorkspaceHostId } from './presentation.ts'
import type { WorkspacePickerProps } from './contract/slots.ts'
import css from './ExternalWorkspacePicker.module.css'

function systemName(platform?: string): string {
  switch (platform) {
    case 'win32': return 'Windows'
    case 'darwin': return 'macOS'
    case 'linux': return 'Linux'
    default: return platform ?? ''
  }
}

/** Choose the owner before browsing. Server paths never enter local Workspace creation. */
export function RemoteWorkspacePicker({ catalog, onLocal, onClose, renderFactorySlot, t: upstreamT }: {
  renderFactorySlot: PropsRenderFactories['renderFactorySlot']
  catalog: ExternalWorkspaceCatalog
  onLocal: () => void
  onClose: () => void
  t: WorkspacePickerProps['t']
}) {
  const t = upstreamT
  const [hostId, setHostId] = useState<ExternalWorkspaceHostId>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const host = catalog.hosts.find(item => item.id === hostId)
  const list = catalog.listDirectory, mkdir = catalog.createDirectory
  const listDirectory = useCallback((path?: string, signal?: AbortSignal) => list(hostId!, path, signal), [list, hostId])
  const createDirectory = useCallback((path: string, name: string) => mkdir(hostId!, path, name), [mkdir, hostId])
  return <>
    <Modal open={!hostId} onClose={onClose} title={t('remote.chooseHost')} closeLabel={t('close')}>
      <div className={css.hostChoices}>
        <Button variant="outline" className={css.hostChoice} onClick={onLocal}>
          <span className={css.hostName}>{catalog.localHost?.name ?? t('remote.currentMachine')}</span>
          <span className={css.hostDetails}>{[systemName(catalog.localHost?.platform), t('remote.currentMachine')].filter(Boolean).join(' · ')}</span>
        </Button>
        {catalog.hosts.map(item => <Button key={item.id} variant="outline" className={css.hostChoice} disabled={!item.online || !item.canAdd}
          onClick={() => { setHostId(item.id) }}>
          <span className={css.hostName}>{item.name}</span>
          <span className={css.hostDetails}>{[systemName(item.platform), t('remote.remoteMachine'),
            item.hostname !== item.name ? item.hostname : undefined, item.address,
            !item.online ? t('remote.offline') : !item.canAdd ? t('remote.notConfigured') : undefined].filter(Boolean).join(' · ')}</span>
        </Button>)}
      </div>
    </Modal>
    {host && renderFactorySlot('workspace.directory.browser', { open: true, busy,
      title: t('remote.browser.title', { host: host.name }), listDirectory, createDirectory,
      onClose: () => { if (!busy) onClose() }, onOpen: path => {
        setBusy(true); setError('')
        void catalog.addWorkspace(host.id, path).then(onClose).catch((failure: unknown) => {
          setError(failure instanceof Error ? failure.message : String(failure))
        }).finally(() => { setBusy(false) })
      } })}
    <Modal open={busy || !!error} onClose={() => { if (!busy) setError('') }} title={t(busy ? 'remote.adding' : 'folderError.title')}
      closeLabel={t('close')} footer={!busy && <Button variant="primary" onClick={() => { setError('') }}>{t('close')}</Button>}>
      <div role={busy ? 'status' : 'alert'}>{busy ? t('remote.addingHint') : error}</div>
    </Modal>
  </>
}
