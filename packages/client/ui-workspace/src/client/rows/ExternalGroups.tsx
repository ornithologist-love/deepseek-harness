import { useState } from 'react'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { WorkspacePresentationSnapshot } from '../presentation.ts'
import { ProjectRowItem, SessionNodeItem } from './Rows.tsx'
import css from './WorkspaceBrowser.module.css'

/** Native rows, supplied by another Host; identities never enter local controllers. */
export function ExternalGroups({ catalog, t, active, query = '' }: {
  catalog: WorkspacePresentationSnapshot['external']
  t: WorkspaceBrowserProps['t']
  active: boolean
  query?: string
}) {
  const [collapsed, setCollapsed] = useState<Readonly<Record<string, boolean>>>({})
  if (!catalog) return null
  const needle = query.trim().toLocaleLowerCase()
  return <>
    {catalog.error && <div role="status">{catalog.error}</div>}
    {catalog.items.map(item => {
      const sessions = item.sessions.filter(row => (!row.blank || row.id === catalog.activeSessionId)
        && (!needle || `${item.title} ${item.hostName} ${row.title}`.toLocaleLowerCase().includes(needle)))
      if (needle && !sessions.length && !`${item.title} ${item.hostName}`.toLocaleLowerCase().includes(needle)) return null
      const selected = active && catalog.activeKey === item.key
      const expanded = !!needle || collapsed[item.key] !== true
      return <div key={item.key} className={css.groupSection} title={`${item.hostName} · ${item.path}`}>
        <ProjectRowItem remoteHost={item.hostName} group={{ key: item.key, workspaceId: item.workspaceId,
          label: item.title, cwd: item.path, createdAt: undefined, expanded, sessionCount: sessions.length,
          containsCurrent: selected, sessions }} onToggle={() => { setCollapsed(value => ({ ...value, [item.key]: expanded })) }}
          onCreate={() => { if (item.online) catalog.create(item.key) }} t={t} />
        {expanded && sessions.map(node => <SessionNodeItem key={node.id} node={node} currentId={selected ? catalog.activeSessionId : undefined}
          now={Date.now()} onOpen={id => { catalog.open(item.key, id) }} onRenameRequest={() => {}}
          navigationOnly renderSlot={() => null} t={t} />)}
        {!item.online && <div role="status" style={{ padding: '4px 28px', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>{t('remote.reconnecting', { host: item.hostName })}</div>}
      </div>
    })}
  </>
}
