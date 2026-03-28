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
  /** 'readable' = rich Markdown for humans; 'compact' = clean text for pasting back to Claude */
  exportFormat: 'readable' | 'compact';
}

export class MarkdownExporter {
  constructor(private readonly context: vscode.ExtensionContext) {}

  getOptions(): ExportOptions {
    const cfg = vscode.workspace.getConfiguration('claudeCodeExporter');
    const outputDir =
      cfg.get<string>('outputDirectory') || '';
    return {
      includeThinking: cfg.get<boolean>('includeThinking') ?? false,
      includeToolDetails: cfg.get<boolean>('includeToolDetails') ?? true,
      groupByProject: cfg.get<boolean>('groupByProject') ?? true,
      filenameFormat:
        cfg.get<string>('filenameFormat') ?? '{date}_{project}_{sessionId}',
      outputDir,
      exportFormat: (cfg.get<string>('exportFormat') ?? 'readable') as 'readable' | 'compact',
    };
  }

  /**
   * Resolve output dir, prompting user to pick one if not configured.
   * Returns undefined if the user cancels.
   */
  async resolveOutputDir(opts: ExportOptions): Promise<string | undefined> {
    if (opts.outputDir) return opts.outputDir;

    // Prompt user to choose a folder
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: 'Choose folder to save exported conversations',
      openLabel: 'Select Export Folder',
    });

    if (!picked || picked.length === 0) return undefined;

    const chosen = picked[0].fsPath;
    // Save to user settings so we don't ask again
    await vscode.workspace
      .getConfiguration('claudeCodeExporter')
      .update('outputDirectory', chosen, vscode.ConfigurationTarget.Global);

    return chosen;
  }

  /** Export a single session file to Markdown. Returns the output path. */
  async exportSession(
    sessionFilePath: string,
    opts?: Partial<ExportOptions>
  ): Promise<string> {
    const options = { ...this.getOptions(), ...opts };

    // Resolve output dir (may prompt)
    const outDir = await this.resolveOutputDir(options);
    if (!outDir) throw new Error('No output directory selected.');
    options.outputDir = outDir;

    const session = parseSessionFile(sessionFilePath);
    const markdown =
      options.exportFormat === 'compact'
        ? this.renderCompact(session, options)
        : this.renderReadable(session, options);

    const outPath = this.resolveOutputPath(session, options);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, markdown, 'utf8');
    return outPath;
  }

  /** Export all sessions under a projectsDir */
  async exportAll(projectsDir: string, opts?: Partial<ExportOptions>): Promise<string[]> {
    const options = { ...this.getOptions(), ...opts };

    // Resolve output dir once for all
    const outDir = await this.resolveOutputDir(options);
    if (!outDir) return [];
    options.outputDir = outDir;

    const files = scanProjectsDir(projectsDir);
    const results: string[] = [];

    for (const file of files) {
      try {
        const session = parseSessionFile(file);
        const markdown =
          options.exportFormat === 'compact'
            ? this.renderCompact(session, options)
            : this.renderReadable(session, options);
        const outPath = this.resolveOutputPath(session, options);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, markdown, 'utf8');
        results.push(outPath);
      } catch (err) {
        console.error(`[claude-code-exporter] Failed to export ${file}:`, err);
      }
    }
    return results;
  }

  // ─── Path resolution ────────────────────────────────────────────────────────

  resolveOutputPath(session: ConversationSession, opts: ExportOptions): string {
    const outDir = opts.outputDir || path.join(os.homedir(), 'claude-exports');
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

    const suffix = opts.exportFormat === 'compact' ? '_compact' : '';

    if (opts.groupByProject) {
      return path.join(outDir, safeName, `${filename}${suffix}.md`);
    }
    return path.join(outDir, `${filename}${suffix}.md`);
  }

  // ─── READABLE format (rich Markdown, for humans) ─────────────────────────────

  renderReadable(session: ConversationSession, opts: ExportOptions): string {
    const lines: string[] = [];

    lines.push(`# Claude Code Session`);
    lines.push('');
    lines.push(`| Field | Value |`);
    lines.push(`|---|---|`);
    lines.push(`| **Project** | \`${session.projectName}\` |`);
    lines.push(`| **Session ID** | \`${session.sessionId}\` |`);
    if (session.cwd) lines.push(`| **Working Dir** | \`${session.cwd}\` |`);
    if (session.startTime) lines.push(`| **Started** | ${formatDate(session.startTime)} |`);
    if (session.endTime && session.endTime !== session.startTime) {
      lines.push(`| **Last Updated** | ${formatDate(session.endTime)} |`);
    }
    lines.push(`| **Messages** | ${session.messages.length} |`);
    lines.push('');
    lines.push('---');
    lines.push('');

    for (const msg of session.messages) {
      const roleLabel = msg.role === 'user' ? '## 👤 User' : '## 🤖 Assistant';
      const ts = msg.timestamp ? ` <sup>${formatDate(msg.timestamp)}</sup>` : '';
      lines.push(`${roleLabel}${ts}`);
      lines.push('');

      for (const block of msg.blocks) {
        lines.push(...this.renderBlockReadable(block, opts));
      }

      lines.push('');
      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }

  private renderBlockReadable(block: ContentBlock, opts: ExportOptions): string[] {
    switch (block.type) {
      case 'text': {
        const t = (block as TextBlock).text?.trim();
        return t ? [t, ''] : [];
      }
      case 'thinking': {
        if (!opts.includeThinking) return [];
        const t = (block as ThinkingBlock).thinking?.trim();
        if (!t) return [];
        return ['<details>', '<summary>💭 Extended Thinking</summary>', '', '```', t, '```', '', '</details>', ''];
      }
      case 'tool_use': {
        const b = block as ToolUseBlock;
        if (!opts.includeToolDetails) return [`> 🔧 **Tool:** \`${b.name}\``, ''];
        const inputStr = JSON.stringify(b.input, null, 2);
        const display = inputStr.length > 2000 ? inputStr.slice(0, 2000) + '\n...(truncated)' : inputStr;
        return ['<details>', `<summary>🔧 Tool: <code>${b.name}</code></summary>`, '', '```json', display, '```', '', '</details>', ''];
      }
      case 'tool_result': {
        if (!opts.includeToolDetails) return [];
        const b = block as ToolResultBlock;
        const content = extractText(b.content);
        if (!content.trim()) return [];
        const display = content.length > 1000 ? content.slice(0, 1000) + '\n...(truncated)' : content;
        return ['<details>', '<summary>📤 Tool Result</summary>', '', '```', display.trim(), '```', '', '</details>', ''];
      }
      case 'image':
        return ['> 📷 *[Image]*', ''];
      default:
        return [];
    }
  }

  // ─── COMPACT format (clean text, for pasting back to Claude) ─────────────────

  renderCompact(session: ConversationSession, opts: ExportOptions): string {
    const lines: string[] = [];

    // Minimal header
    lines.push(`<!-- Claude Code Session | Project: ${session.projectName} | ${session.startTime ? new Date(session.startTime).toISOString().slice(0, 10) : ''} -->`);
    lines.push('');

    for (const msg of session.messages) {
      const roleLabel = msg.role === 'user' ? '**Human:**' : '**Claude:**';
      const textParts: string[] = [];

      for (const block of msg.blocks) {
        const text = this.blockToCompactText(block, opts);
        if (text) textParts.push(text);
      }

      if (textParts.length === 0) continue;

      lines.push(roleLabel);
      lines.push('');
      lines.push(textParts.join('\n\n'));
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }

  private blockToCompactText(block: ContentBlock, opts: ExportOptions): string {
    switch (block.type) {
      case 'text':
        return (block as TextBlock).text?.trim() ?? '';
      case 'thinking':
        if (!opts.includeThinking) return '';
        return `[Thinking: ${(block as ThinkingBlock).thinking?.slice(0, 200)}...]`;
      case 'tool_use': {
        const b = block as ToolUseBlock;
        // Just mention the tool name — no big JSON dump
        const desc = summarizeToolInput(b.name, b.input);
        return `[Tool: ${b.name}${desc ? ' — ' + desc : ''}]`;
      }
      case 'tool_result': {
        if (!opts.includeToolDetails) return '';
        const content = extractText((block as ToolResultBlock).content);
        if (!content.trim()) return '';
        const truncated = content.length > 500 ? content.slice(0, 500) + '...(truncated)' : content;
        return `[Tool result: ${truncated.trim()}]`;
      }
      default:
        return '';
    }
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function extractText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b.type === 'text')
    .map((b) => (b as TextBlock).text)
    .join('\n');
}

/** Produce a short human-readable description of what a tool call does */
function summarizeToolInput(name: string, input: Record<string, unknown>): string {
  const tryKey = (...keys: string[]) => {
    for (const k of keys) {
      if (typeof input[k] === 'string') return (input[k] as string).slice(0, 80);
    }
    return '';
  };
  switch (name) {
    case 'Read':      return tryKey('file_path');
    case 'Write':     return tryKey('file_path');
    case 'Edit':      return tryKey('file_path');
    case 'Bash':      return tryKey('command', 'description');
    case 'Grep':      return tryKey('pattern');
    case 'Glob':      return tryKey('pattern');
    case 'WebFetch':  return tryKey('url');
    case 'WebSearch': return tryKey('query');
    case 'Agent':     return tryKey('description', 'prompt');
    default:          return tryKey('prompt', 'description', 'query', 'path', 'command');
  }
}
