/** Native Windows PSEC execution; never grants workspace ACLs or integrity labels. */

import { existsSync, mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, parse } from 'node:path'
import { finished } from 'node:stream/promises'
import { MxcError, probe, spawn } from '@microsoft/mxc-sdk/v1'
import type { ContainerRequest } from '@microsoft/mxc-sdk/v1'
import { SUBPROCESS_CONTROL_ENV } from '@deepseek-ai/dsh-subprocess/control'
import { quoteArg } from '@deepseek-ai/dsh-win32-process'
import { createMxcControlBridge } from './mxc-control.ts'
import type { MxcControlBridge } from './mxc-control.ts'

interface Policy {
  mode: 'read-only' | 'workspace-write'
  roots: string[]
  host: { systemDrive: string; localAppData: string }
}

function policyFromJson(raw: string | undefined): Policy {
  if (raw === undefined) throw new Error('missing MXC file policy')
  const value: unknown = JSON.parse(raw)
  if (typeof value !== 'object' || value === null || !('mode' in value) || !('roots' in value)
    || (value.mode !== 'read-only' && value.mode !== 'workspace-write')
    || !('host' in value) || typeof value.host !== 'object' || value.host === null
    || !('systemDrive' in value.host) || typeof value.host.systemDrive !== 'string' || value.host.systemDrive.length === 0
    || !('localAppData' in value.host) || typeof value.host.localAppData !== 'string' || !isAbsolute(value.host.localAppData)
    || !Array.isArray(value.roots) || value.roots.length === 0
    || !value.roots.every((root: unknown): root is string => typeof root === 'string' && isAbsolute(root))) {
    throw new Error('invalid MXC file policy')
  }
  const roots = value.roots.map((root) => {
    if (!statSync(root).isDirectory()) throw new Error('MXC workspace must be an existing directory')
    const canonical = realpathSync.native(root)
    if (value.mode === 'workspace-write' && canonical === parse(canonical).root) {
      throw new Error('MXC writable workspaces must not be volume roots')
    }
    return canonical
  })
  return { mode: value.mode, roots, host: { systemDrive: value.host.systemDrive, localAppData: value.host.localAppData } }
}

function readRoots(roots: string[]): string[] {
  const volumes = Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:\\`)
    .filter(root => existsSync(root))
  return [...new Set([...volumes, ...roots, process.cwd(), process.execPath])]
}

function requestFor(argv: string[], policy: Policy, temp?: string): ContainerRequest {
  const environment = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !['SYSTEMDRIVE', 'LOCALAPPDATA', 'MXC_FFI_DIR', 'MXC_BIN_DIR'].includes(key.toUpperCase())))
  return {
    containment: { type: 'processcontainer', config: { capabilities: ['registryRead'], ui: {
      isolation: 'desktop', desktopSystemControl: false, systemSettings: 'none', ime: false,
    } } },
    command: argv.map(quoteArg).join(' '),
    workingDirectory: process.cwd(),
    environment: {
      ...environment, SystemDrive: policy.host.systemDrive, LOCALAPPDATA: policy.host.localAppData,
      ...temp === undefined ? {} : { TMP: temp, TEMP: temp },
    },
    filesystem: {
      readonlyPaths: readRoots(policy.roots),
      readwritePaths: policy.mode === 'workspace-write' ? [...policy.roots, ...temp === undefined ? [] : [temp]] : [],
    },
    // DSH's file-effect policy does not constrain network access.
    network: { egress: { default: 'allow' }, ingress: { default: 'allow', hostLoopback: 'allow' } },
    ui: { disable: false, clipboard: 'none', allowInputInjection: false },
  }
}

/**
 * Run the native MXC backend, or probe it without changing host permissions.
 * @param args - `--probe`, or serialized mode/roots, `--`, and exact command argv.
 * @returns the workload exit code; unavailable probes return 1, launch failures reject before workload execution.
 */
export async function runMxc(args: string[]): Promise<number> {
  const probing = args.length === 1 && args[0] === '--probe'
  const policy: Policy = probing ? policyFromJson(JSON.stringify({
    mode: 'read-only', roots: [process.cwd()],
    host: { systemDrive: process.env['SystemDrive'], localAppData: process.env['LOCALAPPDATA'] },
  })) : policyFromJson(args[0])
  const argv = probing ? [process.execPath, '--version'] : args.slice(2)
  if (!probing && (args[1] !== '--' || argv.length === 0)) throw new Error('missing MXC command after --')
  let temp: string | undefined
  let bridge: MxcControlBridge | undefined
  try {
    for (const key of Object.keys(process.env)) {
      if (['MXC_FFI_DIR', 'MXC_BIN_DIR'].includes(key.toUpperCase())) Reflect.deleteProperty(process.env, key)
    }
    const support = probe()
    if (support.tier !== 'base-container' || support.needsDaclAugmentation !== false) {
      if (probing) return 1
      throw new Error('native Windows PSEC is unavailable; refusing an ACL-based fallback')
    }
    if (policy.mode === 'workspace-write') temp = mkdtempSync(join(tmpdir(), 'dsh-mxc-'))
    if (!probing && process.env[SUBPROCESS_CONTROL_ENV] === 'pipe') bridge = await createMxcControlBridge(argv)
    const request = requestFor(bridge?.argv ?? argv, policy, temp)
    if (bridge !== undefined) request.environment = { ...request.environment, DSH_MXC_CONTROL: bridge.environment }
    const requestSupport = probe(request)
    if (requestSupport.tier !== 'base-container' || requestSupport.needsDaclAugmentation !== false) {
      throw new Error('native Windows PSEC cannot enforce the requested policy')
    }
    const child = await spawn(request)
    const input = child.standardInput
    const output = child.standardOutput
    const error = child.standardError
    if (input !== null) {
      input.on('error', () => { input.destroy() })
      process.stdin.pipe(input)
    }
    const drains: Promise<void>[] = []
    if (output !== null) { output.pipe(process.stdout, { end: false }); drains.push(finished(output, { cleanup: true })) }
    if (error !== null) { error.pipe(process.stderr, { end: false }); drains.push(finished(error, { cleanup: true })) }
    try {
      const [result] = await Promise.all([child.wait(), ...drains])
      return result.exitCode
    } finally {
      if (input !== null) { process.stdin.unpipe(input); input.destroy() }
      child.dispose()
    }
  } catch (error) {
    // Native diagnostic buffers can contain the command or environment.
    if (error instanceof MxcError) throw new Error(`native MXC failure (${error.code})`, { cause: error })
    throw error
  } finally {
    bridge?.dispose()
    if (temp !== undefined) {
      if (!temp.startsWith(join(tmpdir(), 'dsh-mxc-'))) throw new Error('MXC cleanup path is outside its private temp root')
      rmSync(temp, { recursive: true, force: true })
    }
  }
}
