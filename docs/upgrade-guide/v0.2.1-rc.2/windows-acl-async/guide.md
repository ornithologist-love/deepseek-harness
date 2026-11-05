---
kind: upgrade-guide
description: "Direct Windows ACL sandbox callers must await grant and cleanup completion."
---

# Await Windows ACL grants and cleanup

English | [中文](guide.zh.md)

## Change

`AclWriteGrant.add()`, `AclWriteGrant.dispose()`, and `AclSandbox.dispose()` now return promises. Native permission propagation no longer blocks the Host event loop. Sandbox commands still wait for successful authorization; file permissions and confinement policy are unchanged.

## Migration

1. Await every direct call to these methods before spawning, releasing resources, or deleting private temporary directories.
2. Await cleanup in failure and shutdown handlers. `AclSandbox.init()` remains asynchronous.
3. Confirm that authorization finishes before a confined command starts and that cleanup finishes before its temporary directory is removed. Compositions using `dsh-sandbox-local` already await both operations.
