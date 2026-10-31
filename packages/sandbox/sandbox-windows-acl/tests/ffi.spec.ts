/**
 * Sandbox-specific FFI tests with stub binding tables: temp-path decoding,
 * invalid-handle checks, pointer-at-offset decoding, and the bounded SID
 * comparison's early exits. Pure stubs — no real Win32
 * calls, so these run on every platform; the real-FFI round-trip lives in
 * acl.spec.ts and probe.spec.ts (win32 only).
 */

import { describe, expect, it, vi } from 'vitest'
import koffi from 'koffi'

import { Win32Error } from '@deepseek-ai/dsh-win32-process'
import {
  allocBytes, callWin32Async, decodePtrAt, getTempPath,
  isInvalidHandle, sameSidAt,
} from '../src/ffi.ts'
import type { NativePtr, Win32Bindings } from '../src/ffi.ts'
import * as abi from '../src/win32-abi.ts'

describe('asynchronous native calls', () => {
  it('uses the asynchronous entry and waits for its result', async () => {
    const started = Promise.withResolvers<(error: Error | null, result: number) => void>()
    const synchronous = vi.fn((_value: number) => 0)
    const binding = Object.assign(synchronous, {
      async: vi.fn((_value: number, complete: (error: Error | null, result: number) => void) => {
        started.resolve(complete)
      }),
    })
    const operation = callWin32Async(binding, 42)
    const complete = await started.promise
    expect(synchronous).not.toHaveBeenCalled()
    complete(null, 7)
    await expect(operation).resolves.toBe(7)
  })

  it('preserves a native asynchronous failure', async () => {
    const error = new Error('native completion failed')
    const binding = Object.assign(vi.fn(() => 0), {
      async: (complete: (error: Error | null, result: number) => void): void => { complete(error, 0) },
    })
    await expect(callWin32Async(binding)).rejects.toBe(error)
  })

  it('rejects when dispatching the native call throws', async () => {
    const error = new Error('native dispatch failed')
    const binding = Object.assign(vi.fn(() => 0), {
      async: (): never => { throw error },
    })
    await expect(callWin32Async(binding)).rejects.toBe(error)
  })
})

/** A stub whose formatMessageW supplies text to the GetTempPath failure path. */
function formatApi(): { api: Win32Bindings; formatMessageW: ReturnType<typeof vi.fn> } {
  const formatMessageW = vi.fn((_flags: number, _source: null, _id: number, _lang: number, buffer: Buffer, _size: number, _args: null) => {
    const text = 'access denied'
    buffer.write(text, 'utf16le')
    return text.length
  })
  const api = {
    formatMessageW,
    getLastError: vi.fn(() => 5),
  } as unknown as Win32Bindings
  return { api, formatMessageW }
}

/** A minimal SID allocation: revision@0, subAuthorityCount@1, identifierAuthority@2, subauthorities@8. */
function craftSid(revision: number, count: number, authority: number[] = [0, 0, 0, 0, 0, 0], subs: number[] = []): NativePtr {
  const sid = allocBytes(8 + subs.length * 4)
  koffi.encode(sid, 'uint8', revision)
  koffi.encode(sid, 1, 'uint8', count)
  authority.forEach((byte, index) => {
    koffi.encode(sid, 2 + index, 'uint8', byte)
  })
  subs.forEach((sub, index) => {
    koffi.encode(sid, 8 + index * 4, 'uint32', sub)
  })
  return sid
}

describe('getTempPath', () => {
  it('decodes the NUL-terminated temp path GetTempPathW wrote', () => {
    const api = {
      getTempPathW: vi.fn((_length: number, buffer: Buffer) => {
        buffer.write('C:\\TEMP', 'utf16le')
        return 7
      }),
    } as unknown as Win32Bindings
    expect(getTempPath(api)).toBe('C:\\TEMP')
  })

  it('reports the Win32 failure when GetTempPathW writes nothing', () => {
    const { api } = formatApi()
    const failing = { ...api, getTempPathW: vi.fn(() => 0) } as Win32Bindings
    let caught: unknown
    try {
      getTempPath(failing)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('GetTempPathW')
  })

  it('rejects a required length larger than the fixed buffer', () => {
    const api = { getTempPathW: vi.fn(() => 300) } as unknown as Win32Bindings
    expect(() => getTempPath(api)).toThrow(/GetTempPathW failed \(Win32 122\): required 300/u)
  })
})

describe('sandbox pointer handling', () => {
  it('isInvalidHandle treats NULL as failure', () => {
    expect(isInvalidHandle(null)).toBe(true)
    expect(isInvalidHandle(undefined)).toBe(true)
    expect(isInvalidHandle(0n as NativePtr)).toBe(true)
    expect(isInvalidHandle(42n as NativePtr)).toBe(false)
  })

  it('decodePtrAt returns null for a NULL pointer stored in a buffer', () => {
    const buffer = Buffer.alloc(8)
    buffer.writeBigUInt64LE(0n, 0)
    expect(decodePtrAt(buffer, 0)).toBeNull()
  })

  it('decodePtrAt returns the stored pointer value', () => {
    const buffer = Buffer.alloc(8)
    buffer.writeBigUInt64LE(42n, 0)
    expect(decodePtrAt(buffer, 0)).toBe(42n)
  })
})

describe('sameSidAt bounded comparison', () => {
  it('rejects a revision mismatch before comparing anything else', () => {
    const left = craftSid(1, 0)
    const right = craftSid(2, 0)
    expect(sameSidAt(left, 0, right, 0)).toBe(false)
  })

  it('rejects a subauthority-count mismatch', () => {
    const left = craftSid(1, 1, [0, 0, 0, 0, 0, 5], [42])
    const right = craftSid(1, 2, [0, 0, 0, 0, 0, 5], [42, 43])
    expect(sameSidAt(left, 0, right, 0)).toBe(false)
  })

  it('rejects an implausible subauthority count', () => {
    const left = craftSid(1, abi.SID_MAX_SUB_AUTHORITIES + 1)
    const right = craftSid(1, abi.SID_MAX_SUB_AUTHORITIES + 1)
    expect(sameSidAt(left, 0, right, 0)).toBe(false)
  })

  it('rejects a differing identifier authority byte', () => {
    const left = craftSid(1, 0, [0, 0, 0, 0, 0, 5])
    const right = craftSid(1, 0, [0, 0, 0, 0, 0, 6])
    expect(sameSidAt(left, 0, right, 0)).toBe(false)
  })

  it('accepts identical SIDs at nonzero offsets over differing leading bytes', () => {
    const sid = craftSid(1, 1, [0, 0, 0, 0, 0, 5], [42])
    // Embed the same SID bytes at offset 4 of two buffers whose first four
    // bytes differ: an offset-ignoring comparison reads the differing
    // prefixes and must reject.
    const left = allocBytes(4 + 12)
    const right = allocBytes(4 + 12)
    koffi.encode(left, 0, 'uint32', 0x11111111)
    koffi.encode(right, 0, 'uint32', 0x22222222)
    for (let offset = 0; offset < 12; offset++) {
      const byte = koffi.decode(sid, offset, 'uint8') as number
      koffi.encode(left, 4 + offset, 'uint8', byte)
      koffi.encode(right, 4 + offset, 'uint8', byte)
    }
    expect(sameSidAt(left, 4, right, 4)).toBe(true)
    expect(sameSidAt(left, 0, right, 0)).toBe(false) // the differing prefixes are not a matching SID
  })
})
