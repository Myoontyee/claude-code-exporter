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
   * If a file for this session already exists (matched by shortId):
   *   - If session has a customTitle, rename the file to match the new title
   *   - Otherwise, overwrite content but keep the existing filename
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
    fs.mkdirSync(outDir, { recursive: true });

    // Try to find an existing file for this session (by shortId)
    const shortId = session.sessionId.split('-')[0];
    const suffix = options.exportFormat === 'compact' ? '_compact' : '';
    const existingFile = this.findExistingFile(outDir, shortId, suffix);

    // Build the ideal filename (uses customTitle if available)
    const idealName = this.buildFilename(session, options);

    let outPath: string;
    if (existingFile) {
      if (session.customTitle && existingFile !== idealName) {
        // Title changed — rename the file
        const oldPath = path.join(outDir, existingFile);
        const newPath = path.join(outDir, idealName);
        if (!fs.existsSync(newPath)) {
          fs.renameSync(oldPath, newPath);
        }
        outPath = newPath;
      } else {
        // No title change — overwrite in place
        outPath = path.join(outDir, existingFile);
      }
    } else {
      outPath = path.join(outDir, idealName);
    }

    fs.writeFileSync(outPath, markdown, 'utf8');
    return outPath;
  }

  /**
   * Find an existing .md file in outDir that matches the given shortId.
   * Returns the filename (not full path) if found, or null.
   */
  private findExistingFile(outDir: string, shortId: string, suffix: string): string | null {
    try {
      const files = fs.readdirSync(outDir);
      const pattern = suffix
        ? new RegExp(`_${shortId}${suffix}\\.md$`)
        : new RegExp(`_${shortId}\\.md$`);
      return files.find((f) => pattern.test(f)) ?? null;
    } catch {
      return null;
    }
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

  buildFilename(session: ConversationSession, opts: ExportOptions): string {
    const date = session.startTime
      ? fmtFileTimestamp(new Date(session.startTime))
      : 'unknown-date';

    // Prefer customTitle (user rename), fall back to first user message
    let preview = '';
    if (session.customTitle) {
      preview = session.customTitle.trim().slice(0, 40);
    } else {
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
    if (session.customTitle) lines.push(`| **Title** | ${session.customTitle} |`);
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

  // ─── Tidy History ───────────────────────────────────────────────────────────

  /**
   * Tidy up .cc-history/ folder:
   * 1. Merge duplicate files with same shortId (keep the larger/newer one)
   * 2. Rename old files missing timestamps to include full timestamp
   * Returns { renamed, merged, errors } counts.
   */
  tidyHistory(
    ccHistoryDir: string,
    claudeProjectDir?: string
  ): { renamed: number; merged: number; errors: number } {
    if (!fs.existsSync(ccHistoryDir)) return { renamed: 0, merged: 0, errors: 0 };

    let renamed = 0;
    let merged = 0;
    let errors = 0;

    const files = fs.readdirSync(ccHistoryDir).filter((f) => f.endsWith('.md'));

    // Group files by shortId
    const byShortId = new Map<string, string[]>();
    const shortIdPattern = /_([a-f0-9]{8})(?:_compact)?\.md$/;

    for (const f of files) {
      const m = f.match(shortIdPattern);
      if (!m) continue;
      const sid = m[1];
      if (!byShortId.has(sid)) byShortId.set(sid, []);
      byShortId.get(sid)!.push(f);
    }

    // Phase 1: Merge duplicates — keep the largest file, delete the rest
    for (const [sid, group] of byShortId) {
      if (group.length <= 1) continue;

      // Sort by file size descending (largest = most complete)
      group.sort((a, b) => {
        try {
          return fs.statSync(path.join(ccHistoryDir, b)).size -
                 fs.statSync(path.join(ccHistoryDir, a)).size;
        } catch { return 0; }
      });

      const keeper = group[0]; // largest
      for (let i = 1; i < group.length; i++) {
        try {
          fs.unlinkSync(path.join(ccHistoryDir, group[i]));
          merged++;
        } catch {
          errors++;
        }
      }

      // Update the group to only contain the keeper
      byShortId.set(sid, [keeper]);
    }

    // Phase 2: Rename files missing full timestamp (YYYY-MM-DD_HHmmss)
    // Old format: 2026-03-28_preview_shortid.md (no time)
    // New format: 2026-03-28_HHmmss_preview_shortid.md
    const hasFullTimestamp = /^\d{4}-\d{2}-\d{2}_\d{6}_/;
    const hasDateOnly = /^(\d{4}-\d{2}-\d{2})_(?!\d{6}_)/;

    const currentFiles = fs.readdirSync(ccHistoryDir).filter((f) => f.endsWith('.md'));
    for (const f of currentFiles) {
      if (hasFullTimestamp.test(f)) continue; // already good
      const dateMatch = f.match(hasDateOnly);
      if (!dateMatch) continue;

      // Try to get the actual timestamp from the JSONL source
      const sidMatch = f.match(shortIdPattern);
      if (!sidMatch) continue;
      const sid = sidMatch[1];

      let timestamp = '';

      // Try to find the JSONL source and read startTime
      if (claudeProjectDir) {
        try {
          const jsonls = fs.readdirSync(claudeProjectDir).filter((j) => j.endsWith('.jsonl'));
          const match = jsonls.find((j) => j.startsWith(sid));
          if (match) {
            const session = parseSessionFile(path.join(claudeProjectDir, match));
            if (session.startTime) {
              timestamp = fmtFileTimestamp(new Date(session.startTime));
            }
          }
        } catch { /* fallback below */ }
      }

      // Fallback: read file mtime
      if (!timestamp) {
        try {
          const stat = fs.statSync(path.join(ccHistoryDir, f));
          timestamp = fmtFileTimestamp(stat.mtime);
        } catch { continue; }
      }

      // Build new name: replace "2026-03-28_" with "2026-03-28_HHmmss_"
      const datePart = dateMatch[1];
      const rest = f.slice(datePart.length + 1); // everything after "2026-03-28_"
      const newName = `${timestamp}_${rest}`;

      if (newName === f) continue;
      // Avoid collision
      if (fs.existsSync(path.join(ccHistoryDir, newName))) continue;

      try {
        fs.renameSync(
          path.join(ccHistoryDir, f),
          path.join(ccHistoryDir, newName)
        );
        renamed++;
      } catch {
        errors++;
      }
    }

    return { renamed, merged, errors };
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
