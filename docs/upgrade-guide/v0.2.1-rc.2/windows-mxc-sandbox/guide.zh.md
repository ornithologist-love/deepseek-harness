---
kind: upgrade-guide
description: "兼容的 Windows 主机优先使用原生 MXC，前台命令退出时停止其派生进程。"
---

# Windows 原生 MXC 的进程生命周期

[English](guide.md) | 中文

## 变更

`dsh-sandbox-local` 在兼容的 Windows 主机上优先选择原生 MXC/PSEC 后端。此后端不修改工作区 ACL 或完整性标签。前台命令及其派生进程共用一次隔离生命周期：前台命令退出时，所有派生进程随之停止，包括旧版 ACL 后端可能保留的后台开发服务器。仅在原生 PSEC 能力不可用时允许回退旧版 ACL；原生探测异常或命令执行失败均会停止执行，不切换后端。

候选方案使用 `@microsoft/mxc-sdk` 1.0.1，SDK 支持的 Node 最低版本为 24，尚未确认 Node 22 兼容性。原生能力由运行时探测判定，不能仅凭 Windows 版本号确认支持。

## 迁移

1. 评估此候选方案时使用 Node 24 或更新版本，并确认设备支持 Windows 原生 PSEC，见[微软的 Windows 支持表](https://github.com/microsoft/mxc/blob/main/docs/backends/process-container/os-version-support.md)。
2. 需要后台服务时，让其在沙箱调用期间保持前台运行，或交由独立管理的服务生命周期启动。
3. 执行一次受限工作区写入，确认外部写入被拒绝，并比较命令执行前后的工作区完整性标签。提供方选中此后端时会记录 `Windows sandbox: native MXC/PSEC`。
4. 单独处理此前遗留的 Low 标签。选择 MXC 不会修复旧 ACL 改动；此后端不执行工作区权限迁移。
