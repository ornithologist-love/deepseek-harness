/**
 * The optional project search scope shared by `glob` and `grep`. When a
 * deployment configures it, both tools accept a `search_scope` argument:
 * `project` (the default) skips hidden entries and the configured directory
 * names at any depth, and `glob` also honors ignore files; `all` searches
 * hidden, ignored, and generated files. Both scopes keep VCS metadata out of
 * directory scans, and every result states its actual root and scope.
 *
 * @module @deepseek-ai/dsh-tool-fs-search/scope
 */

import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/**
 * Directory names ripgrep must never descend into for a discovery listing: VCS
 * metadata stores. `--no-ignore --hidden` would otherwise surface them in every
 * broad search. Each name is excluded with TWO negated `--glob`s: an any-depth
 * directory glob that matches — and prunes — the directory during traversal,
 * and a contents glob that still excludes the internals when the search root
 * itself is at or inside the directory (an explicit `path` of `.git` or
 * `sub/.git`), where the prune glob alone never matches.
 */
export const GLOB_VCS_EXCLUDES: readonly string[] = ['.git', '.svn', '.hg', '.bzr', '.jj', '.sl']

/** Deployment configuration of the project search scope. */
export interface ProjectScope {
  /** Directory names excluded at any depth from `project` directory scans, such as build output and caches. */
  excludedDirectories: string[]
}

/** The scope one call searches. */
export type SearchScope = 'project' | 'all'

/** The model-facing `search_scope` parameter both tools register when a project scope is configured. */
export const SEARCH_SCOPE_PARAMETER = {
  type: 'string',
  enum: ['project', 'all'],
  description: 'Directory scans: project (default) skips hidden entries and generated/cache directories; explicit pattern or include filters override ignore rules. '
    + 'all includes hidden, ignored and generated files. Both skip VCS metadata. An exact file path is always searched. Each result reports its root and scope.',
} as const

/**
 * The two negated globs that exclude one directory name at any depth: the bare
 * form prunes it during traversal; the `/**` form excludes its contents when the
 * search root is at or inside it.
 *
 * @param name - the directory name.
 * @returns the two `--glob` flags.
 */
export function excludeDirectory(name: string): string[] {
  return [`--glob=!**/${name}`, `--glob=!**/${name}/**`]
}

/**
 * The ripgrep flags that select one call's scope. `project` omits
 * `--no-ignore --hidden`, so ignore files apply, and excludes hidden entries
 * plus the configured directories; `all` searches hidden and ignored files.
 *
 * @param scope - the scope the call searches.
 * @param config - the deployment's project scope.
 * @returns the scope flags, placed before the `--` search target.
 */
export function scopeFlags(scope: SearchScope, config: ProjectScope): string[] {
  const vcs = GLOB_VCS_EXCLUDES.flatMap(excludeDirectory)
  if (scope === 'all') return ['--no-ignore', '--hidden', ...vcs]
  return ['--glob=!**/.*', '--glob=!**/.*/**', ...config.excludedDirectories.flatMap(excludeDirectory), ...vcs]
}

/**
 * The one-line root and scope statement prepended to a scoped result. An exact
 * file target is searched regardless of scope, so it says so.
 *
 * @param workdir - the resolved workdir the search ran in.
 * @param path - the call's `path` argument, if any.
 * @param scope - the scope the call searched.
 * @param config - the deployment's project scope.
 * @returns the statement text.
 */
export async function scopeSummary(workdir: string, path: string | undefined, scope: SearchScope, config: ProjectScope): Promise<string> {
  const root = resolve(workdir, path ?? '.')
  const explicitFile = path !== undefined && await stat(root).then(entry => entry.isFile(), () => false)
  const coverage = explicitFile
    ? 'exact file, searched regardless of scope'
    : scope === 'all'
      ? 'all files, including hidden, ignored and generated files; VCS metadata excluded'
      : `project files; hidden entries${config.excludedDirectories.map(name => `, ${name}`).join('')} and VCS metadata excluded`
  return `Search root: ${root}. Scope: ${coverage}.`
}

/**
 * Prefix the scope statement to the first text block of a rendered result.
 *
 * @param content - the rendered result content.
 * @param summary - the scope statement, or `undefined` when no project scope is configured.
 * @returns the content with the statement prepended.
 */
export function withScopeSummary(content: ContentBlock[], summary: string | undefined): ContentBlock[] {
  if (summary === undefined) return content
  return content.map((block, index) => index === 0 && block.type === 'text' ? { ...block, text: `${summary}\n\n${block.text}` } : block)
}
