import * as fs from 'fs';
import * as path from 'path';

// ─── Raw JSONL line shapes ───────────────────────────────────────────────────

export interface RawLine {
  type: string;
  subtype?: string;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  customTitle?: string;
  compactMetadata?: { trigger?: string; preTokens?: number };
  message?: {
    role: string;
    content: string | ContentBlock[];
  };
}

export type ContentBlock =
  | TextBlock
  | ThinkingBlock
  | ToolUseBlock
  | ToolResultBlock
  | ImageBlock;

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | ContentBlock[];
}

export interface ImageBlock {
  type: 'image';
  source?: { type: string; url?: string; data?: string; media_type?: string };
}

// ─── Parsed conversation model ────────────────────────────────────────────────

export interface ConversationMessage {
  role: 'user' | 'assistant';
  timestamp: string;
  blocks: ContentBlock[];
  uuid: string;
}

export interface ConversationSession {
  sessionId: string;
  projectDir: string;
  projectName: string;
  filePath: string;
  startTime: string;
  endTime: string;
  cwd: string;
  customTitle: string;
  messages: ConversationMessage[];
}

// ─── Parser ───────────────────────────────────────────────────────────────────

export function parseSessionFile(filePath: string): ConversationSession {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim());

  const messages: ConversationMessage[] = [];
  let sessionId = path.basename(filePath, '.jsonl');
  let cwd = '';
  let customTitle = '';
  let firstTimestamp = '';
  let lastTimestamp = '';

  for (const line of lines) {
    let obj: RawLine;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    // Capture custom title (user rename)
    if (obj.type === 'custom-title' && obj.customTitle) {
      customTitle = obj.customTitle;
      continue;
    }

    // Skip infrastructure lines (but handle compact_boundary)
    if (obj.type === 'queue-operation') {
      continue;
    }

    // Handle compact boundary marker
    if (obj.type === 'system' && obj.subtype === 'compact_boundary') {
      const trigger = obj.compactMetadata?.trigger ?? 'auto';
      const tokens = obj.compactMetadata?.preTokens;
      let label = `⟫ Conversation compacted (${trigger})`;
      if (tokens) label += ` — ${tokens.toLocaleString()} tokens before compact`;
      messages.push({
        role: 'assistant',
        timestamp: obj.timestamp ?? '',
        blocks: [{ type: 'text', text: `---\n\n**${label}**\n\n---` }],
        uuid: obj.uuid ?? '',
      });
      if (obj.timestamp) lastTimestamp = obj.timestamp;
      continue;
    }

    // Skip other system lines
    if (obj.type === 'system') {
      continue;
    }

    // Capture session metadata
    if (obj.sessionId) sessionId = obj.sessionId;
    if (obj.cwd && !cwd) cwd = obj.cwd;
    if (obj.timestamp) {
      if (!firstTimestamp) firstTimestamp = obj.timestamp;
      lastTimestamp = obj.timestamp;
    }

    // Skip meta messages (system injections)
    if (obj.isMeta) continue;

    // Only process user/assistant turns
    if (obj.type !== 'user' && obj.type !== 'assistant') continue;
    if (!obj.message) continue;

    const role = obj.message.role as 'user' | 'assistant';
    const rawContent = obj.message.content;

    // Handle compact summary — wrap it distinctly
    if (obj.isCompactSummary) {
      const summaryText = typeof rawContent === 'string' ? rawContent :
        (rawContent ?? []).filter((b) => b.type === 'text').map((b) => (b as TextBlock).text).join('\n');
      if (summaryText.trim()) {
        messages.push({
          role: 'user',
          timestamp: obj.timestamp ?? '',
          blocks: [{ type: 'text', text: `<details>\n<summary><b>Compact Summary (auto-generated context from previous conversation)</b></summary>\n\n${summaryText.trim()}\n\n</details>` }],
          uuid: obj.uuid ?? '',
        });
      }
      continue;
    }

    const blocks = normalizeContent(rawContent);

    // Skip messages that are ONLY tool_result (internal plumbing) or empty
    const meaningfulBlocks = blocks.filter(
      (b) =>
        b.type === 'text' ||
        b.type === 'thinking' ||
        b.type === 'tool_use' ||
        b.type === 'tool_result' ||
        b.type === 'image'
    );
    if (meaningfulBlocks.length === 0) continue;

    messages.push({
      role,
      timestamp: obj.timestamp ?? '',
      blocks: meaningfulBlocks,
      uuid: obj.uuid ?? '',
    });
  }

  const projectDir = path.dirname(filePath);
  const projectName = formatProjectName(path.basename(projectDir));

  return {
    sessionId,
    projectDir,
    projectName,
    filePath,
    startTime: firstTimestamp,
    endTime: lastTimestamp,
    cwd,
    customTitle,
    messages,
  };
}

function normalizeContent(content: string | ContentBlock[]): ContentBlock[] {
  if (typeof content === 'string') {
    return content.trim() ? [{ type: 'text', text: content }] : [];
  }
  return content ?? [];
}

/** Convert encoded dir name like "C--Projects-MyApp" → "C:\Projects\MyApp" */
function formatProjectName(dirName: string): string {
  // Heuristic: drive letter + '--' + path segments joined by '-'
  // e.g. C--Users-Code-MyApp → C:\Users\Code\MyApp
  const match = dirName.match(/^([a-zA-Z])--(.+)$/);
  if (match) {
    const drive = match[1];
    const rest = match[2].replace(/-(?=[A-Z0-9])/g, '\\').replace(/-/g, '-');
    return `${drive}:\\${rest}`;
  }
  return dirName;
}

/** Scan a projects directory and return all .jsonl session file paths */
export function scanProjectsDir(projectsDir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(projectsDir)) return results;

  for (const project of fs.readdirSync(projectsDir)) {
    const projectPath = path.join(projectsDir, project);
    if (!fs.statSync(projectPath).isDirectory()) continue;

    for (const file of fs.readdirSync(projectPath)) {
      if (file.endsWith('.jsonl')) {
        results.push(path.join(projectPath, file));
      }
    }
  }
  return results;
}

/** Group session file paths by project directory */
export function groupByProject(
  filePaths: string[]
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const fp of filePaths) {
    const dir = path.dirname(fp);
    if (!map.has(dir)) map.set(dir, []);
    map.get(dir)!.push(fp);
  }
  return map;
}
