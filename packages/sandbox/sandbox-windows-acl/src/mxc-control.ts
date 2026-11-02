/** Preserve DSH's inherited control pipe across MXC's standard-stream-only spawn API. */

import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import type { Socket } from 'node:net'
import { openInheritedControlChannel } from '@deepseek-ai/dsh-subprocess/control'

/** The bootstrap runs inside PSEC; its target and all descendants inherit containment. */
const CONTROL_CHILD = `
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
const { port, secret, argv } = JSON.parse(process.env.DSH_MXC_CONTROL);
delete process.env.DSH_MXC_CONTROL;
const socket = connect({ host: '127.0.0.1', port });
socket.once('error', error => { console.error(error.message); process.exit(127); });
socket.once('connect', () => {
  socket.write(secret);
  const child = spawn(argv[0], argv.slice(1), {
    stdio: ['inherit', 'inherit', 'inherit', 'ignore', 'ignore', 'ignore', 'ignore', 'pipe'],
    env: { ...process.env, DSH_SUBPROCESS_CONTROL: 'pipe' },
    windowsHide: true,
  });
  child.once('error', error => { console.error(error.message); socket.destroy(); process.exitCode = 127; });
  child.once('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
    socket.end();
  });
  socket.pipe(child.stdio[7]);
  child.stdio[7].pipe(socket);
  socket.once('close', () => { if (child.exitCode === null) child.kill(); });
});
`

/** One authenticated loopback bridge, owned until its native sandbox process settles. */
export interface MxcControlBridge {
  argv: string[]
  environment: string
  dispose(): void
}

/**
 * Bridge the inherited fd 7 to a target spawned inside PSEC. No host pipe handle is exposed to MXC.
 * @param argv - exact target argv, unchanged for the contained bootstrap's spawn.
 * @returns a runner-owned bridge; dispose after the MXC process and streams have settled.
 */
export async function createMxcControlBridge(argv: string[]): Promise<MxcControlBridge> {
  const control = openInheritedControlChannel()
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
      control.pipe(socket)
      socket.pipe(control)
      const remainder = received.subarray(secret.length)
      if (remainder.length > 0) control.write(remainder)
    }
    socket.on('data', authenticate)
  })
  control.on('error', () => { for (const socket of sockets) socket.destroy() })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('MXC control listener has no TCP address')
    return {
      argv: [process.execPath, '--input-type=module', '--eval', CONTROL_CHILD],
      environment: JSON.stringify({ port: address.port, secret, argv }),
      dispose() {
        for (const socket of sockets) socket.destroy()
        server.close()
        control.destroy()
      },
    }
  } catch (error) {
    server.close()
    control.destroy()
    throw error
  }
}
