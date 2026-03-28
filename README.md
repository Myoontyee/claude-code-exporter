<p align="center">
  <img src="images/icon.png" width="128" height="128" alt="Claude Code Exporter">
</p>

<h1 align="center">Claude Code Exporter</h1>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=myoontyee.claude-code-exporter"><img src="https://img.shields.io/visual-studio-marketplace/v/myoontyee.claude-code-exporter?style=flat-square&label=VS%20Code%20Marketplace" alt="VS Marketplace"></a>
  <a href="https://github.com/Myoontyee/claude-code-exporter/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Myoontyee/claude-code-exporter?style=flat-square" alt="License"></a>
</p>

<p align="center">
  <a href="#english">English</a> · <a href="#中文">中文</a>
</p>

---

## English

### Why This Exists

I use Claude Code every day — across multiple projects, across dozens of sessions. And I kept running into the same wall:

Every session starts from zero. You explained your architecture last Tuesday. You debugged that auth issue on Thursday. You built a whole mental model with Claude over three hours — and then the session ends, and it's gone. The next time you open Claude Code, it doesn't know any of it.

This isn't just a memory problem. It's a **knowledge problem**. The conversations where Claude helped you think through hard problems, refactor messy code, or design a new system — those are genuinely valuable. They shouldn't evaporate.

**Claude Code Exporter** does one thing: it automatically saves every Claude Code conversation as a Markdown file, inside your project folder, in real time. Your AI sessions become a searchable, reusable knowledge base. And when you start a new session, you can hand Claude the relevant history and pick up exactly where you left off — no re-explaining, no lost context.

It works the same way SpecStory works for Cursor and GitHub Copilot. Except this one is for Claude Code.

### How It Works

```
~/.claude/projects/<your-project>/session.jsonl
                      │
                      │  auto-detected + real-time file watching
                      ▼
         <your-project>/.cc-history/
              ├── 2025-03-27_fix-auth-bug_a1b2c3d4.md
              ├── 2025-03-28_refactor-api_e5f6g7h8.md
              └── ...
```

Open any workspace → extension matches it to its Claude sessions → exports to `.cc-history/` → watches for new messages and updates instantly. **Zero configuration.**

### Features

| Feature | Description |
|---|---|
| **Auto-export** | Exports to `.cc-history/` when you open a workspace. Updates in real time as you chat. |
| **Two formats** | **Readable** — rich Markdown with metadata and tool call details, for archiving. **Compact** — clean Human/Claude turns only, optimized for pasting back as context. |
| **Sidebar** | Browse all sessions for the current project. Click any session to preview. |
| **Batch export** | One-click export all sessions, or scan your entire machine for every Claude project. |
| **Smart filenames** | `{date}_{first-message}_{sessionId}.md` — find what you need at a glance. |
| **Tool summaries** | `[Tool: Bash — git status]` instead of raw JSON walls. |

### Quick Start

1. Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=myoontyee.claude-code-exporter)
2. Open a project where you've used Claude Code
3. Done — check the `.cc-history/` folder in your project root

### Use as a Knowledge Base

Set format to **Compact**, then in a new Claude Code session:

```
Read .cc-history/2025-03-27_fix-auth-bug_a1b2c3d4_compact.md
and use that context to continue the work.
```

Claude now has full context from the previous session. This is the closest thing to **persistent memory across sessions** that Claude Code currently supports.

### Settings

| Setting | Default | Description |
|---|---|---|
| `claudeCodeExporter.autoExport` | `true` | Auto-export on open and on changes |
| `claudeCodeExporter.exportFormat` | `readable` | `readable` for archiving, `compact` for AI context |
| `claudeCodeExporter.includeThinking` | `false` | Include extended thinking blocks |
| `claudeCodeExporter.includeToolDetails` | `true` | Include tool call details |
| `claudeCodeExporter.claudeProjectsDir` | `~/.claude/projects` | Custom Claude projects path |

### Compatibility

- VS Code 1.85+ · Cursor · Claude Code CLI · Claude Code for VS Code
- Windows / macOS / Linux

---

## 中文

### 为什么做这个插件

我每天都在用 Claude Code，跨多个项目，跨几十个会话。然后我一直撞上同一堵墙：

每个会话从零开始。上周二你解释了系统架构，周四调试了那个鉴权 bug，花了三个小时和 Claude 建立了完整的心智模型——然后会话结束了，什么都没了。下次打开 Claude Code，它什么都不知道。

这不只是记忆的问题，这是一个**知识沉淀**的问题。那些你和 Claude 一起思考难题、重构代码、设计新系统的对话，是真正有价值的东西，不应该就这样消散。

**Claude Code Exporter** 只做一件事：自动把每一段 Claude Code 对话实时保存为 Markdown 文件，就放在你的项目文件夹里。你的 AI 会话变成了可搜索、可复用的知识库。下次开启新会话时，把相关历史交给 Claude，你们可以从上次结束的地方继续——无需重新解释，上下文不再丢失。

它的工作方式和 SpecStory 对于 Cursor、GitHub Copilot 的方式一样。只不过这个是专门为 Claude Code 做的。

### 工作原理

```
~/.claude/projects/<your-project>/session.jsonl
                      │
                      │  自动检测 + 实时文件监控
                      ▼
         <your-project>/.cc-history/
              ├── 2025-03-27_fix-auth-bug_a1b2c3d4.md
              ├── 2025-03-28_refactor-api_e5f6g7h8.md
              └── ...
```

打开任意工作区 → 插件自动匹配对应的 Claude 会话 → 导出到 `.cc-history/` → 实时监听新消息并更新。**零配置。**

### 功能

| 功能 | 说明 |
|---|---|
| **自动导出** | 打开工作区即导出，对话进行中实时更新 |
| **双格式** | **可读模式** — 完整 Markdown，含元数据和工具调用，用于存档。**精简模式** — 纯对话流，用于贴回给 Claude 作上下文 |
| **侧边栏** | 浏览当前项目的所有会话，点击直接预览 |
| **批量导出** | 一键导出全部会话，或扫描全机所有 Claude 项目 |
| **智能命名** | `{日期}_{首条消息}_{会话ID}.md`，一眼找到想要的 |
| **工具摘要** | `[Tool: Bash — git status]` 替代大段 JSON |

### 快速开始

1. 从 [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=myoontyee.claude-code-exporter) 安装，或在扩展搜索 "Claude Code Exporter"
2. 打开一个你用过 Claude Code 的项目文件夹
3. 完成——查看项目根目录下的 `.cc-history/` 文件夹

### 用作知识库

设置格式为 **Compact（精简模式）**，然后在新会话里：

```
Read .cc-history/2025-03-27_fix-auth-bug_a1b2c3d4_compact.md
and use that context to continue the work.
```

Claude 就拥有了上一次会话的完整上下文。这是目前 Claude Code 能做到的最接近**跨会话持久记忆**的方案。

### 设置项

| 设置 | 默认值 | 说明 |
|---|---|---|
| `claudeCodeExporter.autoExport` | `true` | 打开项目和检测到变更时自动导出 |
| `claudeCodeExporter.exportFormat` | `readable` | `readable` 存档，`compact` 喂 AI |
| `claudeCodeExporter.includeThinking` | `false` | 包含扩展思考块 |
| `claudeCodeExporter.includeToolDetails` | `true` | 包含工具调用详情 |
| `claudeCodeExporter.claudeProjectsDir` | `~/.claude/projects` | 自定义 Claude 项目目录 |

### 兼容性

- VS Code 1.85+ · Cursor · Claude Code CLI · Claude Code for VS Code
- Windows / macOS / Linux

---

<p align="center">
  <sub>Built for developers who talk to AI all day and don't want to lose those conversations.</sub><br>
  <sub>为每天和 AI 对话、又不想丢失这些对话的开发者而造。</sub>
</p>
