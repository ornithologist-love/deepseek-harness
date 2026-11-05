/** Recoverable, cross-process ownership of temporary workspace ACL edits. */
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, parse, relative, sep } from 'node:path'
import { restoreWriteSecurity, snapshotWriteSecurity, withPathLock } from './acl.ts'
import type { WriteSecuritySnapshot } from './acl.ts'
import { getTempPath, win32Sync } from './ffi.ts'
import type { Win32Bindings } from './ffi.ts'
import { AclWriteGrant } from './grant.ts'

interface RootGrant {
  before: WriteSecuritySnapshot
  applied: WriteSecuritySnapshot | null
  preserveDacl?: boolean
}
interface Lease {
  pid: number
  roots: string[]
}
interface Journal {
  version: 1
  roots: Record<string, RootGrant>
  leases: Record<string, Lease>
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function snapshot(value: unknown): value is WriteSecuritySnapshot {
  return record(value) && (value.dacl === null || typeof value.dacl === 'string')
    && (value.label === null || typeof value.label === 'string')
}
function journal(value: unknown): value is Journal {
  if (!record(value) || value.version !== 1 || !record(value.roots) || !record(value.leases)) return false
  const roots = value.roots
  return Object.entries(roots).every(([path, root]) => isAbsolute(path) && parse(path).root !== path
      && record(root) && snapshot(root.before) && (root.applied === null || snapshot(root.applied))
      && (root.preserveDacl === undefined || typeof root.preserveDacl === 'boolean'))
    && Object.values(value.leases).every(lease => record(lease) && Number.isInteger(lease.pid) && Number(lease.pid) > 0
      && Array.isArray(lease.roots) && lease.roots.every(path => typeof path === 'string' && Object.hasOwn(roots, path)))
}
function overlaps(left: string, right: string): boolean {
  const contains = (parent: string, child: string): boolean => {
    const suffix = relative(parent, child)
    return suffix === '' || (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith('..' + sep))
  }
  return contains(left, right) || contains(right, left)
}
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true }
  catch (error) {
    // Access denied and PID reuse retain a lease conservatively; neither can
    // justify revoking permissions underneath a potentially live child.
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
    return true
  }
}

class WorkspaceLeaseRegistry {
  private readonly api: Win32Bindings
  private readonly file: string

  constructor() {
    this.api = win32Sync()
    this.file = join(getTempPath(this.api), 'dsh-acl-workspace-leases', 'journal.json')
  }

  private read(): Journal {
    let text: string
    try { text = readFileSync(this.file, 'utf8') }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { version: 1, roots: {}, leases: {} }
      throw error
    }
    const value: unknown = JSON.parse(text)
    if (!journal(value)) throw new Error(`Invalid Windows workspace-grant recovery journal: ${this.file}`)
    return value
  }

  private save(state: Journal): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const temporary = this.file + '.' + randomUUID() + '.tmp'
    writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 })
    try { renameSync(temporary, this.file) }
    catch (error) {
      try { unlinkSync(temporary) } catch (_cleanupFailed) { /* The committed journal remains authoritative. */ }
      throw error
    }
  }

  private async cleanup(state: Journal): Promise<void> {
    for (const [id, lease] of Object.entries(state.leases)) if (!alive(lease.pid)) Reflect.deleteProperty(state.leases, id)
    const active = Object.values(state.leases).flatMap(lease => lease.roots)
    // Parent restoration propagates to descendants; never restore either end
    // of an overlapping workspace while a confined child still uses the other.
    const unused = Object.entries(state.roots).filter(([path]) => !active.some(root => overlaps(path, root)))
      .sort(([left], [right]) => right.length - left.length)
    for (const [path, root] of unused) {
      const restoredDacl = await restoreWriteSecurity(this.api, path, root.before, root.preserveDacl ? null : root.applied)
      if (!restoredDacl) process.stderr.write(`[windows-acl-cleanup] Restored integrity label; retained newer directory permissions: ${path}\n`)
      Reflect.deleteProperty(state.roots, path)
      this.save(state)
    }
  }

  async acquire(id: string, roots: string[], sid: string): Promise<void> {
    await withPathLock(this.api, this.file, async () => {
      const state = this.read()
      await this.cleanup(state)
      for (const [path, root] of Object.entries(state.roots)) {
        if (root.applied !== null && snapshotWriteSecurity(this.api, path).dacl !== root.applied.dacl) root.preserveDacl = true
      }
      for (const path of roots) state.roots[path] ??= { before: snapshotWriteSecurity(this.api, path), applied: null }
      state.leases[id] = { pid: process.pid, roots }
      // Commit recovery facts before the first native mutation, including the
      // init-failure/crash window before an applied snapshot can be saved.
      this.save(state)
      try {
        const grant = AclWriteGrant.create(sid)
        try {
          for (const path of roots) await grant.add(path, true)
          for (const [path, root] of Object.entries(state.roots)) root.applied = snapshotWriteSecurity(this.api, path)
          this.save(state)
        } finally { await grant.dispose() }
      } catch (error) {
        Reflect.deleteProperty(state.leases, id)
        try { await this.cleanup(state); this.save(state) }
        catch (cleanupError) { throw new AggregateError([error, cleanupError], `Workspace ACL initialization and recovery failed; recovery journal: ${this.file}`) }
        throw error
      }
    })
  }

  async release(id: string): Promise<void> {
    await withPathLock(this.api, this.file, async () => {
      const state = this.read()
      Reflect.deleteProperty(state.leases, id)
      this.save(state)
      await this.cleanup(state)
      this.save(state)
    })
  }

  async recover(): Promise<void> {
    await withPathLock(this.api, this.file, async () => {
      const state = this.read()
      await this.cleanup(state)
      this.save(state)
    })
  }
}

/** One invocation's workspace permissions, shared safely with concurrent runners. */
export class WorkspaceWriteLease {
  private readonly id = randomUUID()
  private readonly registry = new WorkspaceLeaseRegistry()
  private released = false

  /** Acquire before spawning; a failed grant never permits an unconfined child. */
  static async acquire(paths: readonly string[], sid: string): Promise<WorkspaceWriteLease> {
    const roots = [...new Set(paths.map(path => realpathSync.native(path)))]
    if (roots.some(path => parse(path).root === path)) throw new Error('A filesystem root cannot be a Windows sandbox workspace')
    const lease = new WorkspaceWriteLease()
    await lease.registry.acquire(lease.id, roots, sid)
    return lease
  }

  /** Restore stale grants from terminated runners without touching live leases. */
  static async recover(): Promise<void> { await new WorkspaceLeaseRegistry().recover() }

  /** Release only after the complete confined process range has exited. */
  async dispose(): Promise<void> {
    if (this.released) return
    await this.registry.release(this.id)
    this.released = true
  }
}
