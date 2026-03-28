<p align="center">
  <img src="images/icon.png" width="128" height="128" alt="Claude Code Exporter">
</p>

<h1 align="center">Claude Code Exporter</h1>

<p align="center">
  <strong>Auto-export Claude Code conversations to Markdown — build your AI knowledge base effortlessly.</strong><br>
  <strong>自动导出 Claude Code 对话为 Markdown —— 轻松构建你的 AI 知识库。</strong>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=myoontyee.claude-code-exporter"><img src="https://img.shields.io/visual-studio-marketplace/v/myoontyee.claude-code-exporter?style=flat-square&label=VS%20Code%20Marketplace" alt="VS Marketplace"></a>
  <a href="https://github.com/Myoontyee/claude-code-exporter/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Myoontyee/claude-code-exporter?style=flat-square" alt="License"></a>
</p>

---

## Why? / 为什么需要它？

If you use Claude Code across multiple projects, you've probably hit this wall:

如果你在多个项目中使用 Claude Code，你一定遇到过这些痛点：

- **Context is trapped in sessions.** You solved a bug yesterday, but today's session doesn't know about it.
  **上下文被锁在单次会话里。** 昨天解决的 bug，今天的会话完全不知道。

- **Conversations vanish across CLI restarts.** Switching sessions or hitting API cache limits means starting from scratch.
  **跨会话记忆丢失。** 切换 session、API 缓存过期，一切从头开始。

- **No searchable history.** Unlike a codebase, your AI conversations have no `grep`.
  **没有可搜索的历史。** 代码可以 grep，但 AI 对话不行。

**Claude Code Exporter** fixes this by automatically converting every conversation into clean, searchable Markdown files — right inside your project folder. Your AI chat history becomes a **local knowledge base** that you (and Claude) can reference anytime.

**Claude Code Exporter** 自动把每一段对话转为干净、可搜索的 Markdown 文件，直接存在你的项目文件夹里。AI 聊天记录变成了**本地知识库**，你（和 Claude）随时可以引用。

## How It Works / 工作原理

```
~/.claude/projects/<your-project>/session.jsonl
                      │
                      │  (auto-detected, real-time watching)
                      │  (自动检测，实时监控)
                      ▼
         <your-project>/.cc-history/
              ├── 2025-03-27_fix-auth-bug_a1b2c3d4.md
              ├── 2025-03-28_refactor-api_e5f6g7h8.md
              └── ...
```

Open any workspace → the extension matches it to its Claude sessions → exports to `.cc-history/` → watches for new messages in real time. **Zero configuration.**

打开任意工作区 → 插件自动匹配对应的 Claude 会话 → 导出到 `.cc-history/` → 实时监听新消息。**零配置。**

## Features / 功能

| Feature / 功能 | Description / 说明 |
|---|---|
| **Auto-export / 自动导出** | Exports to `.cc-history/` on workspace open. New messages update in real time. / 打开项目即导出，新消息实时更新。 |
| **Two formats / 双格式** | **Readable** — rich Markdown for archiving. **Compact** — clean turns for pasting back to Claude. / **可读模式** — 完整 Markdown 存档。**精简模式** — 干净对话，方便贴回给 Claude 作上下文。 |
| **Sidebar / 侧边栏** | Browse all sessions for the current project. Click to preview. / 浏览当前项目所有会话，点击预览。 |
| **Batch export / 批量导出** | Export all sessions, or scan your entire machine. / 一键导出全部，或扫描全机所有 Claude 项目。 |
| **Smart filenames / 智能命名** | `{date}_{first-message}_{sessionId}.md` — find anything instantly. / 日期 + 首条消息 + 会话 ID，一目了然。 |
| **Tool summaries / 工具摘要** | `[Tool: Bash — git status]` instead of raw JSON. / 工具调用一行摘要，不再是大段 JSON。 |

## Quick Start / 快速开始

1. **Install / 安装** — from [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=myoontyee.claude-code-exporter), or search "Claude Code Exporter" in Extensions.
2. **Open a project / 打开项目** — any folder where you've used Claude Code.
3. **Done / 完成** — check `.cc-history/` in your project root.

## Use as Knowledge Base / 用作知识库

The killer use case: **feed past conversations back to Claude as context.**

核心用法：**把历史对话作为上下文喂回给 Claude。**

1. Set format to **Compact**: Settings → `claudeCodeExporter.exportFormat` → `compact`

   设置格式为 **Compact**（精简模式）

2. In a new Claude Code session:

   在新的 Claude Code 会话中：

   ```
   Read .cc-history/2025-03-27_fix-auth-bug_a1b2c3d4_compact.md
   and use that context to continue the work.
   ```

3. Claude now has full context from the previous session — no re-explaining.

   Claude 现在拥有了上一次会话的完整上下文 —— 无需重新解释。

This gives Claude **persistent memory across sessions**, without relying on API caching.

这相当于给 Claude 加上了**跨会话的持久记忆**，不依赖 API 缓存。

## Settings / 设置

| Setting | Default | Description / 说明 |
|---|---|---|
| `claudeCodeExporter.autoExport` | `true` | Auto-export on open and on changes / 打开项目和检测到变更时自动导出 |
| `claudeCodeExporter.exportFormat` | `readable` | `readable` for archiving, `compact` for AI context / 可读模式存档，精简模式喂 AI |
| `claudeCodeExporter.includeThinking` | `false` | Include extended thinking blocks / 包含扩展思考块 |
| `claudeCodeExporter.includeToolDetails` | `true` | Include tool call details / 包含工具调用详情 |
| `claudeCodeExporter.claudeProjectsDir` | `~/.claude/projects` | Custom Claude projects path / 自定义 Claude 项目目录 |

## Commands / 命令

`Ctrl+Shift+P` →

- **Claude Code Exporter: Export...** — Export all or choose format / 全量导出或选择格式
- **Claude Code Exporter: Refresh Sessions** — Rescan / 重新扫描
- **Claude Code Exporter: Scan Computer** — Export all projects on this machine / 导出本机所有项目

## Compatibility / 兼容性

- **VS Code** 1.85+
- **Cursor** — fully compatible / 完全兼容
- **Claude Code for VS Code** extension
- **Claude Code CLI**
- **Windows / macOS / Linux**

## License

[MIT](LICENSE)

---

<p align="center">
  <sub>Built for developers who talk to AI all day and don't want to lose those conversations.</sub><br>
  <sub>为每天和 AI 对话、又不想丢失这些对话的开发者而造。</sub>
</p>
