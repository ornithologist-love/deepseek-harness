---
kind: upgrade-guide
description: "直接调用 Windows ACL 沙箱的代码必须等待授权和清理完成。"
---

# 等待 Windows ACL 授权和清理

[English](guide.md) | 中文

## 变更

`AclWriteGrant.add()`、`AclWriteGrant.dispose()` 和 `AclSandbox.dispose()` 现在返回 Promise。原生权限传播不再阻塞 Host 事件循环。沙箱命令仍需等待授权成功；文件权限和约束策略不变。

## 迁移

1. 直接调用这些方法时必须等待完成，然后才能启动进程、释放资源或删除私有临时目录。
2. 失败处理和退出清理同样需要等待。`AclSandbox.init()` 仍是异步方法。
3. 确认受限命令在授权完成后启动，临时目录在清理完成后删除。使用 `dsh-sandbox-local` 的组合已等待这两项操作。
