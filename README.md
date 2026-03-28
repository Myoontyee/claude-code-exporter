<p align="center">
  <img src="images/icon.png" width="128" height="128" alt="Claude Code Exporter">
</p>

<h1 align="center">Claude Code Exporter</h1>

<p align="center">
  <strong>Auto-export your Claude Code conversations to Markdown — build your AI knowledge base effortlessly.</strong>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=myoontyee.claude-code-exporter"><img src="https://img.shields.io/visual-studio-marketplace/v/myoontyee.claude-code-exporter?style=flat-square&label=VS%20Code%20Marketplace" alt="VS Marketplace"></a>
  <a href="https://github.com/Myoontyee/claude-code-exporter/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Myoontyee/claude-code-exporter?style=flat-square" alt="License"></a>
</p>

---

## Why?

If you use Claude Code across multiple projects, you've probably hit this wall:

- **Context is trapped in sessions.** You solved a bug yesterday, but today's session doesn't know about it.
- **Conversations vanish across CLI restarts.** Switching sessions or hitting API cache limits means starting from scratch.
- **No searchable history.** Unlike a codebase, your AI conversations have no `grep`.

**Claude Code Exporter** fixes this by automatically converting every Claude Code conversation into clean, searchable Markdown files — right inside your project folder. Your AI chat history becomes a **local knowledge base** that you (and Claude) can reference anytime.

## How It Works

```
~/.claude/projects/<your-project>/session.jsonl
                      │
                      │  (auto-detected, real-time file watching)
                      ▼
         <your-project>/.cc-history/
              ├── 2025-03-27_fix-auth-bug_a1b2c3d4.md
              ├── 2025-03-28_refactor-api_e5f6g7h8.md
              └── ...
```

Open any workspace → the extension matches it to its Claude sessions → exports everything to `.cc-history/` → watches for new messages and updates in real time. **Zero configuration required.**

## Features

| Feature | Description |
|---|---|
| **Auto-export** | Conversations export to `.cc-history/` the moment you open a project. New messages are picked up in real time. |
| **Two formats** | **Readable** — rich Markdown with metadata, collapsible tool calls for archiving. **Compact** — clean Human/Claude turns, optimized for pasting back as context. |
| **Sidebar** | Browse all sessions for the current project. Click to preview. |
| **Batch export** | One-click export all sessions, or scan your entire machine for every Claude project. |
| **Smart filenames** | `{date}_{first-message-preview}_{sessionId}.md` — instantly find what you're looking for. |
| **Tool call summaries** | `[Tool: Bash — git status]` instead of raw JSON — readable at a glance. |

## Quick Start

1. **Install** from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=myoontyee.claude-code-exporter) (or search "Claude Code Exporter" in Extensions).
2. **Open a project** where you've used Claude Code before.
3. **Done.** Check the `.cc-history/` folder — your conversations are already there.

## Using Exports as a Knowledge Base

The killer use case: **feed past conversations back to Claude as context.**

1. Set format to **Compact** (Settings → `claudeCodeExporter.exportFormat`)
2. In a new Claude Code session, reference your history:
   ```
   Read .cc-history/2025-03-27_fix-auth-bug_a1b2c3d4_compact.md
   and use that context to continue the work.
   ```
3. Claude now has full context from the previous session — no re-explaining needed.

This effectively gives Claude **persistent memory across sessions**, without relying on API caching or session continuity.

## Settings

| Setting | Default | Description |
|---|---|---|
| `claudeCodeExporter.autoExport` | `true` | Auto-export on workspace open and on file changes |
| `claudeCodeExporter.exportFormat` | `readable` | `readable` for archiving, `compact` for AI context |
| `claudeCodeExporter.includeThinking` | `false` | Include extended thinking blocks |
| `claudeCodeExporter.includeToolDetails` | `true` | Include tool call details |
| `claudeCodeExporter.claudeProjectsDir` | `~/.claude/projects` | Custom Claude projects directory |

## Commands

Open the Command Palette (`Ctrl+Shift+P`) and search for:

- **Claude Code Exporter: Export...** — Export all sessions or choose format
- **Claude Code Exporter: Refresh Sessions** — Rescan for new sessions
- **Claude Code Exporter: Scan Computer** — Find and export ALL Claude projects on your machine

## How It Matches Your Project

Claude Code stores conversations as JSONL files in `~/.claude/projects/`. Each file contains a `cwd` field pointing to the original working directory. The extension reads this field and matches it to your current VS Code workspace — no filename heuristics, no guessing.

## Compatibility

- **VS Code** 1.85+
- **Cursor** (VS Code fork) — fully compatible
- **Claude Code for VS Code** extension sessions
- **Claude Code CLI** sessions
- **Windows / macOS / Linux**

## License

[MIT](LICENSE)

---

<p align="center">
  <sub>Built for developers who talk to AI all day and don't want to lose those conversations.</sub>
</p>
