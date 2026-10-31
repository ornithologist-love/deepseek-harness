import type { Win32Bindings } from '../src/ffi.ts'

type SecurityInfoCall = Win32Bindings['setNamedSecurityInfoW']

/** The asynchronous entry exposed by a real Koffi security binding. */
export type AsyncSecurityInfoCall = SecurityInfoCall & {
  async(...args: [...Parameters<SecurityInfoCall>, (error: Error | null, result?: number) => void]): void
}

/** Attach Koffi's completion shape to a security stub without running its callback inline. */
export function asyncSecurityInfoMock(call: SecurityInfoCall): AsyncSecurityInfoCall {
  return Object.assign(call, {
    async(
      path: string, objectType: number, information: number,
      owner: null, group: null,
      dacl: Parameters<SecurityInfoCall>[5], sacl: Parameters<SecurityInfoCall>[6],
      complete: (error: Error | null, result?: number) => void,
    ): void {
      queueMicrotask(() => {
        let result: number
        try {
          result = call(path, objectType, information, owner, group, dacl, sacl)
        } catch (error) {
          complete(error instanceof Error ? error : new Error(String(error)))
          return
        }
        complete(null, result)
      })
    },
  })
}
