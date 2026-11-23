/** Native Windows PSEC execution; never grants workspace ACLs or integrity labels. */

import { existsSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, parse } from 'node:path'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { randomUUID } from 'node:crypto'
import { MxcError, probe, SDK_CONTRACT_VERSION } from '@microsoft/mxc-sdk/v1'
import type { ContainerRequest } from '@microsoft/mxc-sdk/v1'
import { SUBPROCESS_CONTROL_ENV } from '@deepseek-ai/dsh-subprocess/control'
import {
  closeHandleChecked, isJobEmpty, loadWin32ProcessBindings, pollProcessExit,
  quoteArg, spawnCurrentTokenJobProcess, terminateJob,
} from '@deepseek-ai/dsh-win32-process'
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
  return [...new Set([...volumes, ...[...roots, process.cwd(), process.execPath].map(root => parse(root).root)])]
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
    temp = mkdtempSync(join(tmpdir(), 'dsh-mxc-'))
    bridge = await createMxcControlBridge(argv, !probing && process.env[SUBPROCESS_CONTROL_ENV] === 'pipe')
    const request = requestFor(bridge.argv, policy, temp)
    request.environment = { ...request.environment, DSH_MXC_CONTROL: bridge.environment }
    const requestSupport = probe(request)
    if (requestSupport.tier !== 'base-container' || requestSupport.needsDaclAugmentation !== false) {
      throw new Error('native Windows PSEC cannot enforce the requested policy')
    }
    const configuration = {
      version: SDK_CONTRACT_VERSION, containment: 'processcontainer', containerId: randomUUID().replaceAll('-', ''),
      lifecycle: { destroyOnExit: true, preservePolicy: false },
      process: {
        commandLine: request.command, cwd: request.workingDirectory,
        env: Object.entries(request.environment ?? {}).filter((entry): entry is [string, string] => entry[1] !== undefined)
          .map(([key, value]) => `${key}=${value}`),
      },
      filesystem: request.filesystem, network: request.network,
      processContainer: request.containment?.type === 'processcontainer' ? request.containment.config : undefined,
      ui: { disable: false, clipboard: 'none', injection: false },
    }
    const configFile = join(temp, 'policy.json')
    writeFileSync(configFile, JSON.stringify(configuration), { flag: 'wx' })
    const sdk = dirname(createRequire(import.meta.url).resolve('@microsoft/mxc-sdk/package.json'))
    const executable = join(sdk, 'bin', process.arch, 'wxc-exec.exe')
    const api = loadWin32ProcessBindings()
    const child = spawnCurrentTokenJobProcess(api, {
      command: executable, applicationName: executable, args: [configFile], cwd: process.cwd(),
      env: Object.fromEntries(Object.entries({
        ...process.env, SystemDrive: policy.host.systemDrive, LOCALAPPDATA: policy.host.localAppData,
      })
        .filter((entry): entry is [string, string] => entry[1] !== undefined)),
      stdio: { stdin: 0, stdout: 1, stderr: 2 },
    })
    try {
      let exitCode: number | undefined
      while ((exitCode = pollProcessExit(api, child.process)) === undefined) await delay(25)
      if (!bridge.started) throw new Error('native MXC executor failed before contained command startup')
      return exitCode
    } finally {
      try {
        if (!isJobEmpty(api, child.job)) {
          terminateJob(api, child.job, 1)
          while (!isJobEmpty(api, child.job)) await delay(25)
        }
      } finally {
        try {
          closeHandleChecked(api, child.process, 'MXC executor process')
        } finally {
          closeHandleChecked(api, child.job, 'MXC executor job')
        }
      }
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
