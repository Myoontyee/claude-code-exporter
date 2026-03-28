import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import {
  ConversationSession,
  ConversationMessage,
  ContentBlock,
  TextBlock,
  ThinkingBlock,
  ToolUseBlock,
  ToolResultBlock,
  parseSessionFile,
  scanProjectsDir,
} from './parser';

export interface ExportOptions {
  includeThinking: boolean;
  includeToolDetails: boolean;
  groupByProject: boolean;
  filenameFormat: string;
  outputDir: string;
}

export class MarkdownExporter {
  constructor(private readonly context: vscode.ExtensionContext) {}

  getOptions(): ExportOptions {
    const cfg = vscode.workspace.getConfiguration('claudeCodeExporter');
    const outputDir =
      cfg.get<string>('outputDirectory') ||
      path.join(os.homedir(), 'claude-exports');
    return {
      includeThinking: cfg.get<boolean>('includeThinking') ?? false,
      includeToolDetails: cfg.get<boolean>('includeToolDetails') ?? true,
      groupByProject: cfg.get<boolean>('groupByProject') ?? true,
      filenameFormat:
        cfg.get<string>('filenameFormat') ?? '{project}_{date}_{sessionId}',
      outputDir,
    };
  }

  /** Export a single session file to Markdown. Returns the output path. */
  async exportSession(
    sessionFilePath: string,
    opts?: Partial<ExportOptions>
  ): Promise<string> {
    const options = { ...this.getOptions(), ...opts };
    const session = parseSessionFile(sessionFilePath);
    const markdown = this.renderMarkdown(session, options);

    const outPath = this.resolveOutputPath(session, options);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, markdown, 'utf8');
    return outPath;
  }

  /** Export all sessions under a projectsDir */
  async exportAll(projectsDir: string): Promise<string[]> {
    const options = this.getOptions();
    const files = scanProjectsDir(projectsDir);
    const results: string[] = [];

    for (const file of files) {
      try {
        const outPath = await this.exportSession(file, options);
        results.push(outPath);
      } catch (err) {
        console.error(`[claude-code-exporter] Failed to export ${file}:`, err);
      }
    }
    return results;
  }

  // ─── Path resolution ────────────────────────────────────────────────────────

  resolveOutputPath(session: ConversationSession, opts: ExportOptions): string {
    const date = session.startTime
      ? new Date(session.startTime).toISOString().slice(0, 10)
      : 'unknown-date';

    const safeName = session.projectName
      .replace(/[:\\/*?"<>|]/g, '_')
      .replace(/\s+/g, '_');

    const shortId = session.sessionId.split('-')[0];

    const filename = opts.filenameFormat
      .replace('{project}', safeName)
      .replace('{date}', date)
      .replace('{sessionId}', shortId)
      .replace(/[\\/*?"<>|]/g, '_');

    if (opts.groupByProject) {
      return path.join(opts.outputDir, safeName, `${filename}.md`);
    }
    return path.join(opts.outputDir, `${filename}.md`);
  }

  // ─── Markdown rendering ──────────────────────────────────────────────────────

  renderMarkdown(session: ConversationSession, opts: ExportOptions): string {
    const lines: string[] = [];

    // Header
    lines.push(`# Claude Code Session`);
    lines.push('');
    lines.push(`| Field | Value |`);
    lines.push(`|---|---|`);
    lines.push(`| **Project** | \`${session.projectName}\` |`);
    lines.push(`| **Session ID** | \`${session.sessionId}\` |`);
    if (session.cwd) lines.push(`| **Working Dir** | \`${session.cwd}\` |`);
    if (session.startTime) {
      lines.push(`| **Started** | ${formatDate(session.startTime)} |`);
    }
    if (session.endTime && session.endTime !== session.startTime) {
      lines.push(`| **Last Updated** | ${formatDate(session.endTime)} |`);
    }
    lines.push(`| **Messages** | ${session.messages.length} |`);
    lines.push('');
    lines.push('---');
    lines.push('');

    // Messages
    for (const msg of session.messages) {
      lines.push(...this.renderMessage(msg, opts));
      lines.push('');
    }

    return lines.join('\n');
  }

  private renderMessage(
    msg: ConversationMessage,
    opts: ExportOptions
  ): string[] {
    const lines: string[] = [];
    const roleLabel = msg.role === 'user' ? '## 👤 User' : '## 🤖 Assistant';
    const ts = msg.timestamp ? ` <sup>${formatDate(msg.timestamp)}</sup>` : '';
    lines.push(`${roleLabel}${ts}`);
    lines.push('');

    for (const block of msg.blocks) {
      lines.push(...this.renderBlock(block, opts));
    }

    lines.push('');
    lines.push('---');

    return lines;
  }

  private renderBlock(block: ContentBlock, opts: ExportOptions): string[] {
    switch (block.type) {
      case 'text':
        return this.renderText(block as TextBlock);

      case 'thinking':
        if (!opts.includeThinking) return [];
        return this.renderThinking(block as ThinkingBlock);

      case 'tool_use':
        if (!opts.includeToolDetails) {
          return [`> 🔧 **Tool:** \`${(block as ToolUseBlock).name}\``, ''];
        }
        return this.renderToolUse(block as ToolUseBlock);

      case 'tool_result':
        if (!opts.includeToolDetails) return [];
        return this.renderToolResult(block as ToolResultBlock);

      case 'image':
        return ['> 📷 *[Image]*', ''];

      default:
        return [];
    }
  }

  private renderText(block: TextBlock): string[] {
    if (!block.text?.trim()) return [];
    return [block.text.trim(), ''];
  }

  private renderThinking(block: ThinkingBlock): string[] {
    if (!block.thinking?.trim()) return [];
    return [
      '<details>',
      '<summary>💭 Extended Thinking</summary>',
      '',
      '```',
      block.thinking.trim(),
      '```',
      '',
      '</details>',
      '',
    ];
  }

  private renderToolUse(block: ToolUseBlock): string[] {
    const inputStr = JSON.stringify(block.input, null, 2);
    // Truncate very large inputs
    const displayInput =
      inputStr.length > 2000
        ? inputStr.slice(0, 2000) + '\n... (truncated)'
        : inputStr;

    return [
      '<details>',
      `<summary>🔧 Tool Call: <code>${block.name}</code></summary>`,
      '',
      '```json',
      displayInput,
      '```',
      '',
      '</details>',
      '',
    ];
  }

  private renderToolResult(block: ToolResultBlock): string[] {
    let content = '';
    if (typeof block.content === 'string') {
      content = block.content;
    } else if (Array.isArray(block.content)) {
      content = block.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as TextBlock).text)
        .join('\n');
    }

    if (!content.trim()) return [];

    const displayContent =
      content.length > 1000
        ? content.slice(0, 1000) + '\n... (truncated)'
        : content;

    return [
      '<details>',
      `<summary>📤 Tool Result</summary>`,
      '',
      '```',
      displayContent.trim(),
      '```',
      '',
      '</details>',
      '',
    ];
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
