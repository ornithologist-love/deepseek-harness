/**
 * Fake Remote namespaces for the models section specs.
 *
 * The generated `TypertRemoteNamespaceMap` declarations merge into whichever
 * program owns the Host-for-Client projection, so a spec program that does not
 * compile that projection would read `mock.remote.settings` as absent. The
 * entries below restate the namespace members these specs drive; the root
 * `tsconfig.host.json` program compiles this file too, where the generated
 * declarations are present and every entry must agree with them.
 */
import type { TypertRemoteNamespace } from '@deepseek-ai/dsh-typert-protocol'

/** Namespace members the specs register, keyed by Remote namespace. */
export type FakeRemoteNamespaces = {
  readonly settings: TypertRemoteNamespace<'settings'>
  readonly session: TypertRemoteNamespace<'session'>
  readonly llm: TypertRemoteNamespace<'llm'>
  readonly credentials: TypertRemoteNamespace<'credentials'>
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap extends FakeRemoteNamespaces {}
}
