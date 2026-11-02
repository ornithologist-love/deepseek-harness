/** Preserve DSH's inherited control pipe across MXC's standard-stream-only spawn API. */

import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import type { Socket } from 'node:net'
import { openInheritedControlChannel } from '@deepseek-ai/dsh-subprocess/control'

/** The bootstrap runs inside PSEC; its target and all descendants inherit containment. */
const CONTROL_CHILD = `
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
const { port, secret, argv, hasControl } = JSON.parse(process.env.DSH_MXC_CONTROL);
delete process.env.DSH_MXC_CONTROL;
const socket = connect({ host: '127.0.0.1', port });
socket.once('error', error => { console.error(error.message); process.exit(127); });
socket.once('connect', () => {
  socket.write(secret);
});
socket.once('data', acknowledgement => {
  if (acknowledgement.toString() !== '1') { socket.destroy(); process.exitCode = 127; return; }
  const child = spawn(argv[0], argv.slice(1), {
    stdio: hasControl ? ['inherit', 'inherit', 'inherit', 'ignore', 'ignore', 'ignore', 'ignore', 'pipe'] : 'inherit',
    env: hasControl ? { ...process.env, DSH_SUBPROCESS_CONTROL: 'pipe' } : process.env,
    windowsHide: true,
  });
  child.once('error', error => { console.error('windows-mxc-run: target spawn failed (' + error.code + ')'); socket.destroy(); process.exitCode = 127; });
  child.once('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
    if (!hasControl) socket.end();
  });
  if (hasControl) { socket.pipe(child.stdio[7]); child.stdio[7].pipe(socket); }
  socket.once('close', () => { if (child.exitCode === null) child.kill(); });
});
`

/** One authenticated loopback bridge, owned until its native sandbox process settles. */
export interface MxcControlBridge {
  argv: string[]
  environment: string
  readonly started: boolean
  dispose(): void
}

/**
 * Bridge the inherited fd 7 to a target spawned inside PSEC. No host pipe handle is exposed to MXC.
 * @param argv - exact target argv, unchanged for the contained bootstrap's spawn.
 * @param hasControl - whether fd 7 must be forwarded; absent control leaves only the authenticated startup acknowledgement.
 * @returns a runner-owned bridge; dispose after the MXC process and streams have settled.
 */
export async function createMxcControlBridge(argv: string[], hasControl: boolean): Promise<MxcControlBridge> {
  const control = hasControl ? openInheritedControlChannel() : undefined
  const secret = randomBytes(32).toString('hex')
  const sockets = new Set<Socket>()
  let authenticated = false
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => { socket.destroy() })
    socket.on('close', () => { sockets.delete(socket) })
    let received = Buffer.alloc(0)
    const authenticate = (data: Buffer): void => {
      received = Buffer.concat([received, data])
      if (received.length < secret.length) return
      socket.off('data', authenticate)
      if (authenticated || received.subarray(0, secret.length).toString() !== secret) {
        socket.destroy()
        return
      }
      authenticated = true
      socket.write('1')
      if (control !== undefined) { control.pipe(socket); socket.pipe(control) }
      const remainder = received.subarray(secret.length)
      if (remainder.length > 0) control?.write(remainder)
    }
    socket.on('data', authenticate)
  })
  control?.on('error', () => { for (const socket of sockets) socket.destroy() })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('MXC control listener has no TCP address')
    return {
      argv: [process.execPath, '--input-type=module', '--eval', CONTROL_CHILD],
      environment: JSON.stringify({ port: address.port, secret, argv, hasControl }),
      get started() { return authenticated },
      dispose() {
        for (const socket of sockets) socket.destroy()
        server.close()
        control?.destroy()
      },
    }
  } catch (error) {
    server.close()
    control?.destroy()
    throw error
  }
}
