import { useState } from 'react'
import {
  IconChevronDownOutlineRegular, IconCloseFillRegular, IconProjectAddOutlineRegular, IconSearchOutlineRegular, Menu, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { ExternalWorkspaceHostId, WorkspacePresentationSnapshot } from '../presentation.ts'
import { ProjectRowItem, RemoteGlyph, SessionNodeItem } from './Rows.tsx'
import css from './WorkspaceBrowser.module.css'

/** Row seats an external group borrows from the local browser; external identities never reach local access or menus. */
type ExternalRowSeats = Pick<WorkspaceBrowserProps, 'useContextMenu' | 'useContextMenuTarget'>

/** External rows grant no local action and open no local menu. */
const denied = (): boolean => false
const noMenu = (): void => {}

/** Native rows, supplied by another Host; identities never enter local controllers. */
export function ExternalGroups({ catalog, t, active, query = '', recent = false, includeUngrouped = true, onAdd, machineExpansion,
  useContextMenu, useContextMenuTarget }: {
    catalog: WorkspacePresentationSnapshot['external']
    t: WorkspaceBrowserProps['t']
    active: boolean
    query?: string
    /** Label each machine's loose Sessions as Recent and keep that group expanded. */
    recent?: boolean
    /** Omit loose Sessions when the parent requests an archived-only view. */
    includeUngrouped?: boolean
    /** Add a Workspace on one machine; present only where machine sections sit beside the local section. */
    onAdd?: ((hostId: ExternalWorkspaceHostId) => void) | undefined
    machineExpansion?: WorkspacePresentationSnapshot['machineExpansion']
  } & ExternalRowSeats) {
  const seats = { useContextMenu, useContextMenuTarget }
  const [collapsed, setCollapsed] = useState<Readonly<Record<string, boolean>>>({})
  const [hostFilter, setHostFilter] = useState<string>('all')
  const [hostMenuOpen, setHostMenuOpen] = useState(false)
  // Each machine section searches only its own rows; absent means the field is closed.
  const [hostQueries, setHostQueries] = useState<Readonly<Record<string, string>>>({})
  if (!catalog) return null
  const machineTools = !catalog.hideLocalWorkspaces
  const needle = query.trim().toLocaleLowerCase()
  const filteredHost = catalog.hosts.find(host => host.id === hostFilter)
  const filterName = filteredHost?.name ?? t('remote.allMachines')
  return <div className={catalog.hideLocalWorkspaces ? css.treeBody : undefined}>
    {catalog.hideLocalWorkspaces && <div className={css.hostFilters}>
      <Menu open={hostMenuOpen} onClose={() => { setHostMenuOpen(false) }}
        className={css.hostMenu} portal autoFocus dense selectedId={hostFilter}
        items={[{ id: 'all', label: t('remote.allMachines') }, ...catalog.hosts.map(host => ({
          id: host.id, label: host.name, icon: <span className={css.hostStatus} data-online={host.online} />,
        }))]}
        onSelect={(id) => { setHostFilter(id); setHostMenuOpen(false) }}
        anchor={<button type="button" className={css.hostSelect}
          aria-haspopup="menu" aria-expanded={hostMenuOpen}
          aria-label={`${t('remote.machines')}：${filterName}`} title={filterName}
          onClick={() => { setHostMenuOpen(value => !value) }}>
          <span className={css.hostLabel}>
            {filteredHost && <span className={css.hostStatus} data-online={filteredHost.online} />}
            <span className={css.hostName}>{filterName}</span>
          </span>
          <span className={css.hostArrow} aria-hidden="true"><IconChevronDownOutlineRegular /></span>
        </button>} />
    </div>}
    {catalog.error && <div role="status">{catalog.error}</div>}
    <div className={catalog.hideLocalWorkspaces ? css.hostPanel : undefined}>
      <div className={catalog.hideLocalWorkspaces ? css.list : undefined}
        role={catalog.hideLocalWorkspaces ? 'tree' : 'group'} aria-label={t('section.sessions')}>
        {catalog.hosts.map((host) => {
          if (catalog.hideLocalWorkspaces && hostFilter !== 'all' && hostFilter !== host.id) return null
          const hostQuery = hostQueries[host.id]
          const hostNeedle = needle || (hostQuery ?? '').trim().toLocaleLowerCase()
          const items = catalog.items.filter(item => item.hostId === host.id
            && (item.workspaceId !== undefined || includeUngrouped)
            && (!hostNeedle || `${item.title} ${host.name}`.toLocaleLowerCase().includes(hostNeedle)
              || item.sessions.some(row => row.title.toLocaleLowerCase().includes(hostNeedle))))
          if (needle && !items.length) return null
          const closeSearch = () => { setHostQueries(({ [host.id]: _closed, ...rest }) => rest) }
          const hostExpanded = !!needle || hostQuery !== undefined || machineExpansion?.hosts[host.id] !== false
          return <section key={host.id} className={css.machineSection} aria-label={host.name}>
            <div className={css.machineHeader} data-online={host.online}>
              <h3 className={css.machineTitle}>
                {machineExpansion && <button type="button" className={css.machineToggle}
                  aria-expanded={hostExpanded} aria-label={t(hostExpanded ? 'machine.collapse' : 'machine.expand', { host: host.name })}
                  onClick={() => { closeSearch(); machineExpansion.setExpanded(host.id, !hostExpanded) }}>
                  <IconChevronDownOutlineRegular size={14} />
                </button>}
                {!host.local && <span className={css.machineIcon}><RemoteGlyph size={16} /></span>}
                <span className={css.hostName} title={host.name}>{host.name}</span>
              </h3>
              {machineTools && <span className={css.machineActions}>
                <Tooltip label={t('search')} side="bottom" delayMs={500}>
                  <button type="button" className={css.iconButton} aria-label={t('search.sessions.aria')}
                    aria-expanded={hostQuery !== undefined}
                    onClick={() => { if (hostQuery === undefined) setHostQueries(value => ({ ...value, [host.id]: '' })); else closeSearch() }}>
                    <IconSearchOutlineRegular size={14} />
                  </button>
                </Tooltip>
                {onAdd !== undefined && host.canAdd && <Tooltip label={t('workspace.add')} side="bottom" delayMs={500}>
                  <button type="button" className={css.iconButton} aria-label={t('workspace.add')} disabled={!host.online}
                    onClick={() => { onAdd(host.id) }}>
                    <IconProjectAddOutlineRegular size={16} />
                  </button>
                </Tooltip>}
              </span>}
            </div>
            {hostQuery !== undefined && <div className={css.machineSearch}>
              <IconSearchOutlineRegular size={12} />
              <input type="text" autoFocus className={css.machineSearchInput} placeholder={t('search.placeholder')}
                value={hostQuery} aria-label={t('search.sessions.aria')}
                onChange={(e) => { const next = e.target.value; setHostQueries(value => ({ ...value, [host.id]: next })) }}
                onKeyDown={(e) => { if (e.key === 'Escape') closeSearch() }} />
              <button type="button" className={css.clearButton} aria-label={t('search.clear')} onClick={closeSearch}>
                <IconCloseFillRegular />
              </button>
            </div>}
            {hostExpanded && items.map((item) => {
              const itemRecent = recent && item.workspaceId === undefined
              const sessions = item.sessions.filter(row => (!row.blank || row.id === catalog.activeSessionId)
                && (!hostNeedle || `${item.title} ${item.hostName} ${row.title}`.toLocaleLowerCase().includes(hostNeedle)))
              if (itemRecent) sessions.sort((a, b) => b.updatedAt - a.updatedAt)
              const selected = active && catalog.activeKey === item.key
              const expanded = itemRecent || !!hostNeedle || collapsed[item.key] !== true
              return <div key={item.key} className={css.groupSection} title={`${item.hostName} · ${item.path}`}>
                <ProjectRowItem recent={itemRecent} remoteHost={host.local ? undefined : item.hostName}
                  group={{ key: item.key, workspaceId: item.workspaceId,
                    label: item.title, cwd: item.path, createdAt: undefined, expanded, sessionCount: sessions.length,
                    containsCurrent: selected, sessions }} onToggle={() => { setCollapsed(value => ({ ...value, [item.key]: expanded })) }}
                  onCreate={item.workspaceId === undefined ? undefined : () => { if (item.online) catalog.create(item.key) }} t={t}
                  {...seats} useRemoteAccess={() => item.online}
                  useWorkspaceAccess={(_workspaceId, action) => item.online && action === 'session/create'}
                  openWorkspaceMenu={noMenu} />
                {expanded && item.roots !== undefined && item.roots.length > 1 && <details className={css.memberDirectories}>
                  <summary>{t('remote.memberDirectories', { count: item.roots.length })}</summary>
                  {item.roots.map(root => <div key={root.path}>
                    <span>{root.label}{root.path === item.primaryPath && ` · ${t('remote.primaryDirectory')}`}</span>
                    <code>{root.path}</code>
                  </div>)}
                </details>}
                {expanded && sessions.map(node => <SessionNodeItem key={node.id} node={node} flat={itemRecent}
                  currentId={selected ? catalog.activeSessionId : undefined}
                  now={Date.now()} onOpen={(id) => { catalog.open(item.key, id) }} onRenameRequest={() => {}}
                  remoteHost={host.local ? undefined : host.name} rowKey={`external:${host.id}:session:${node.id}`}
                  navigationOnly renderSlot={() => null} t={t}
                  {...seats} openSessionMenu={noMenu} useSessionAccess={denied} />)}
                {!item.online && <div role="status"
                  style={{ padding: '4px 28px', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>
                  {t('remote.reconnecting', { host: item.hostName })}
                </div>}
              </div>
            })}
          </section>
        })}
      </div>
    </div>
  </div>
}
