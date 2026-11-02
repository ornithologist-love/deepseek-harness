---
kind: upgrade-guide
description: "Compatible Windows hosts prefer native MXC, which stops descendants when their foreground command exits."
---

# Native Windows MXC process lifetime

English | [中文](guide.zh.md)

## Change

`dsh-sandbox-local` prefers the native MXC/PSEC backend on compatible Windows hosts. This backend does not change workspace ACLs or integrity labels. Its foreground command and descendants share one containment lifetime: descendants stop when the foreground command exits, including detached development servers that the legacy ACL backend could leave running. An unavailable native PSEC capability permits the legacy ACL fallback; a broken native probe or a failed command stops execution instead of switching backends.

The candidate uses `@microsoft/mxc-sdk` 1.0.1, whose supported Node floor is 24. Node 22 compatibility is not established. Native availability is probed at runtime; a Windows version number alone does not establish support.

## Migration

1. Use Node 24 or later when evaluating this candidate. Verify the device supports native Windows PSEC; see [Microsoft's Windows support table](https://github.com/microsoft/mxc/blob/main/docs/backends/process-container/os-version-support.md).
2. Keep a required background service in the foreground for the duration of its sandbox invocation, or start it through a separately managed service lifecycle.
3. Run a confined workspace write, confirm an outside write is denied, and check the workspace integrity label before and after the command. The provider logs `Windows sandbox: native MXC/PSEC` when it selects the new backend.
4. Handle pre-existing Low labels separately. Selecting MXC does not repair earlier ACL changes; this backend applies no workspace permission migration.
