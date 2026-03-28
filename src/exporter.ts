import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
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
  exportFormat: 'readable' | 'compact';
}

export class MarkdownExporter {
  getOptions(): ExportOptions {
    // Deferred import to avoid top-level vscode dependency in tests
    const vscode = require('vscode');
    const cfg = vscode.workspace.getConfiguration('claudeCodeExporter');
    return {
      includeThinking: cfg.get<boolean>('includeThinking') ?? false,
      includeToolDetails: cfg.get<boolean>('includeToolDetails') ?? true,
      exportFormat: (cfg.get<string>('exportFormat') ?? 'readable') as 'readable' | 'compact',
    };
  }

  /**
   * Export a single session JSONL into the workspace's .cc-history/ folder.
   * Returns the output path.
   */
  exportSessionToWorkspace(
    sessionFilePath: string,
    workspaceRoot: string,
    opts?: Partial<ExportOptions>
  ): string {
    const options = { ...this.getOptions(), ...opts };
    const session = parseSessionFile(sessionFilePath);

    const markdown =
      options.exportFormat === 'compact'
        ? this.renderCompact(session, options)
        : this.renderReadable(session, options);

    const outDir = path.join(workspaceRoot, '.cc-history');
    const outPath = path.join(outDir, this.buildFilename(session, options));
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, markdown, 'utf8');
    return outPath;
  }

  /**
   * Export ALL sessions for a given Claude project dir into workspace .cc-history/.
   */
  exportAllToWorkspace(
    claudeProjectDir: string,
    workspaceRoot: string,
    opts?: Partial<ExportOptions>
  ): string[] {
    const options = { ...this.getOptions(), ...opts };
    const results: string[] = [];

    const files = fs
      .readdirSync(claudeProjectDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(claudeProjectDir, f));

    for (const file of files) {
      try {
        const out = this.exportSessionToWorkspace(file, workspaceRoot, options);
        results.push(out);
      } catch (err) {
        console.error(`[cc-exporter] Failed: ${file}`, err);
      }
    }
    return results;
  }

  // ─── Filename ─────────────────────────────────────────────────────────────

  private buildFilename(session: ConversationSession, opts: ExportOptions): string {
    const date = session.startTime
      ? fmtFileTimestamp(new Date(session.startTime))
      : 'unknown-date';

    // Use first user message as part of filename
    let preview = '';
    for (const msg of session.messages) {
      if (msg.role === 'user') {
        for (const b of msg.blocks) {
          if (b.type === 'text') {
            preview = (b as TextBlock).text?.trim().slice(0, 40) ?? '';
            break;
          }
        }
        if (preview) break;
      }
    }
    // Sanitize
    preview = preview
      .replace(/[\\/:*?"<>|\r\n]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 40);

    const shortId = session.sessionId.split('-')[0];
    const suffix = opts.exportFormat === 'compact' ? '_compact' : '';

    if (preview) {
      return `${date}_${preview}_${shortId}${suffix}.md`;
    }
    return `${date}_${shortId}${suffix}.md`;
  }

  // ─── READABLE format (rich Markdown) ──────────────────────────────────────

  renderReadable(session: ConversationSession, opts: ExportOptions): string {
    const lines: string[] = [];

    lines.push(`# Claude Code Session`);
    lines.push('');
    lines.push(`| Field | Value |`);
    lines.push(`|---|---|`);
    lines.push(`| **Project** | \`${session.projectName}\` |`);
    lines.push(`| **Session ID** | \`${session.sessionId}\` |`);
    if (session.cwd) lines.push(`| **Working Dir** | \`${session.cwd}\` |`);
    if (session.startTime) lines.push(`| **Started** | ${fmtDate(session.startTime)} |`);
    if (session.endTime && session.endTime !== session.startTime) {
      lines.push(`| **Last Updated** | ${fmtDate(session.endTime)} |`);
    }
    lines.push(`| **Messages** | ${session.messages.length} |`);
    lines.push('');
    lines.push('---');
    lines.push('');

    for (const msg of session.messages) {
      const role = msg.role === 'user' ? '## User' : '## Assistant';
      const ts = msg.timestamp ? ` <sup>${fmtDate(msg.timestamp)}</sup>` : '';
      lines.push(`${role}${ts}`);
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
        return ['<details>', '<summary>Thinking</summary>', '', '```', t, '```', '', '</details>', ''];
      }
      case 'tool_use': {
        const b = block as ToolUseBlock;
        if (!opts.includeToolDetails) return [`> Tool: \`${b.name}\``, ''];
        const inputStr = JSON.stringify(b.input, null, 2);
        const display = inputStr.length > 2000 ? inputStr.slice(0, 2000) + '\n...(truncated)' : inputStr;
        return ['<details>', `<summary>Tool: <code>${b.name}</code></summary>`, '', '```json', display, '```', '', '</details>', ''];
      }
      case 'tool_result': {
        if (!opts.includeToolDetails) return [];
        const content = extractText((block as ToolResultBlock).content);
        if (!content.trim()) return [];
        const display = content.length > 1000 ? content.slice(0, 1000) + '\n...(truncated)' : content;
        return ['<details>', '<summary>Tool Result</summary>', '', '```', display.trim(), '```', '', '</details>', ''];
      }
      case 'image':
        return ['> *[Image]*', ''];
      default:
        return [];
    }
  }

  // ─── COMPACT format (clean turns for pasting to Claude) ───────────────────

  renderCompact(session: ConversationSession, opts: ExportOptions): string {
    const lines: string[] = [];
    lines.push(`<!-- Claude Code | ${session.projectName} | ${session.startTime ? new Date(session.startTime).toISOString().slice(0, 10) : ''} -->`);
    lines.push('');

    for (const msg of session.messages) {
      const parts: string[] = [];
      for (const block of msg.blocks) {
        const text = this.blockToCompact(block, opts);
        if (text) parts.push(text);
      }
      if (parts.length === 0) continue;

      lines.push(msg.role === 'user' ? '**Human:**' : '**Claude:**');
      lines.push('');
      lines.push(parts.join('\n\n'));
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }

  private blockToCompact(block: ContentBlock, opts: ExportOptions): string {
    switch (block.type) {
      case 'text':
        return (block as TextBlock).text?.trim() ?? '';
      case 'thinking':
        if (!opts.includeThinking) return '';
        return `[Thinking: ${(block as ThinkingBlock).thinking?.slice(0, 200)}...]`;
      case 'tool_use': {
        const b = block as ToolUseBlock;
        return `[Tool: ${b.name}${summarize(b.name, b.input)}]`;
      }
      case 'tool_result': {
        if (!opts.includeToolDetails) return '';
        const text = extractText((block as ToolResultBlock).content);
        if (!text.trim()) return '';
        return `[Result: ${text.trim().slice(0, 500)}${text.length > 500 ? '...' : ''}]`;
      }
      default:
        return '';
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

/** Format a Date as YYYY-MM-DD_HHmmss for filenames (local time, no colons). */
function fmtFileTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function extractText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b.type === 'text').map((b) => (b as TextBlock).text).join('\n');
}

function summarize(name: string, input: Record<string, unknown>): string {
  const get = (...keys: string[]) => {
    for (const k of keys) if (typeof input[k] === 'string') return ` — ${(input[k] as string).slice(0, 80)}`;
    return '';
  };
  switch (name) {
    case 'Read':     case 'Write':    case 'Edit':      return get('file_path');
    case 'Bash':     return get('command', 'description');
    case 'Grep':     return get('pattern');
    case 'Glob':     return get('pattern');
    case 'WebFetch': return get('url');
    case 'WebSearch': return get('query');
    case 'Agent':    return get('description', 'prompt');
    default:         return get('prompt', 'description', 'query', 'path', 'command');
  }
}
