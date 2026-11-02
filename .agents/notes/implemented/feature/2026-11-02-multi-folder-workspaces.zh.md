# Agent Note：多目录工作区执行

Status: implemented

[English](2026-11-02-multi-folder-workspaces.md) | 中文

## 问题

同一任务可能需要同时修改应用仓库及单独检出的引擎或依赖库。单目录工作区要么无法覆盖必要文件，要么迫使用户授权过大的共同父目录。拆成多个工作区也无法表达同一条命令在同一文件策略下写入两个仓库。

## 决策

保留一个 Workspace 身份及其既有存储格式。组合通过[工作区注册表](../../../../packages/workspace/workspace/README.zh.md)贡献规范化成员目录，主要目录在前；通过[沙箱策略](../../../../packages/sandbox/sandbox-policy/README.zh.md)贡献对应的 Session 写入根。注册返回 disposer；组合负责持久化、目录校验及两个来源的同步。

新建 Workspace Session 从主要成员目录启动。已有 Session 头保留记录的 cwd。当前成员参与查找和挂接；历史目录保留已记账的归属，但不会成为沙箱写入根。不可变 Workspace 路径保留原有身份和挂接语义，因此组合必须用当前成员校验新会话的目录选择。

[本地运行器](../../../../packages/sandbox/sandbox-local/README.zh.md)向 Linux bwrap/Landlock、macOS Seatbelt 和 Windows ACL 执行传递相同写入集合。Windows 由排序后的成员集合派生同一个 SID；单成员保留原 SID。集合变化后，新进程使用新 SID，因此旧的常驻 ACE 不会向这些新进程授予被移除目录。已运行进程保留原有权限，需要单独停止。

成员集合身份和 Windows 重复参数改编自 [Boy-Grid 的 MIT 实现](https://github.com/Boy-Grid/dsh-multi-folder-workspace)；许可证随 Windows ACL 包分发。本分支包含通用执行与注册表 API。产品编辑器、持久成员目录表、草稿会话来源和终端编辑保护仍由组合负责。

## 考虑过的替代方案

授权共同父目录也会授权无关的同级仓库，甚至需要授权整个盘。独立工作区保持了较小根目录，但无法表达所需的跨仓库命令。修补生成的 JavaScript 会模糊策略归属并偏离上游源码，因此实现直接修改能力所属的包。

## 后果

可选策略字段保持单根默认行为，无须修改 Workspace 记录、Session 头或 Session 事件格式。注册成员属于可信配置：开放目录编辑需要组合应用负责认证校验和明确的提交点。

Windows 保留旧后端的部分强制执行和继承 Low 完整性标签行为。本功能不修复该行为；独立的[原生 MXC 候选方案](https://github.com/deepseek-ai/deepseek-harness/discussions/11835)处理它。运行期修改目录不会撤销已运行令牌或持久终端。原生多目录创建界面和多根文件选择不在本实现内。
