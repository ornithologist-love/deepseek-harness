# Agent Note: Multi-folder workspace execution

Status: implemented

English | [中文](2026-11-02-multi-folder-workspaces.zh.md)

## Problem

A task can require edits in an application repository and its separately checked-out engine or library. A single-directory workspace either excludes required files or makes users grant a much larger common parent. Separate workspaces cannot express one command that writes to both repositories under the same file policy.

## Decision

Keep one Workspace identity and its existing storage format. A composition contributes canonical member directories, primary first, through the [workspace registry](../../../../packages/workspace/workspace/README.md), and contributes the corresponding Session write roots through [sandbox policy](../../../../packages/sandbox/sandbox-policy/README.md). Registration returns disposers; the composition owns persistence, directory validation, and synchronization between the two sources.

New Workspace Sessions start in the primary member. Existing Session headers keep their recorded cwd. Current members participate in lookup and attachment; historical directories preserve previously accounted membership without becoming sandbox write roots. The immutable Workspace path retains its existing identity and attachment semantics, so a composition must validate new-session directory choices against its current members.

The [local runner](../../../../packages/sandbox/sandbox-local/README.md) passes the same write set to Linux bwrap/Landlock, macOS Seatbelt, and Windows ACL execution. Windows uses one SID derived from the sorted member set; one member retains its existing SID. Changing the set gives new processes a new SID, so old standing ACEs do not grant removed directories to those new processes. Already-running processes retain their original authority and must be stopped separately.

The member-set identity and repeated Windows runner arguments adapt [Boy-Grid's MIT implementation](https://github.com/Boy-Grid/dsh-multi-folder-workspace); its license ships with the Windows ACL package. This branch contains the generic execution and registry APIs. A product editor, persistent member catalog, draft-session producer, and terminal-edit guard remain composition responsibilities.

## Alternatives considered

Granting a common parent also grants unrelated sibling repositories and may require granting an entire drive. Independent workspaces keep narrow roots but cannot represent the required cross-repository command. Patching generated JavaScript obscures the policy owner and drifts from upstream source; the implementation instead changes the owning packages.

## Consequences

The optional policy field preserves the single-root default without changing Workspace records, Session headers, or Session event formats. Registered members are trusted configuration: exposing directory editing requires authenticated validation and an owned commit point in the composing application.

Windows retains the legacy backend's partial enforcement and inherited Low-integrity labels. This feature does not repair that behavior; the independent [native MXC candidate](https://github.com/deepseek-ai/deepseek-harness/discussions/11835) addresses it. Live directory edits do not revoke running tokens or persistent terminals. Native multi-folder creation UI and multi-root file picking remain outside this implementation.
