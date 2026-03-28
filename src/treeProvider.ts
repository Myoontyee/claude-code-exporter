import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { scanProjectsDir, groupByProject, parseSessionFile } from './parser';
import { MarkdownExporter } from './exporter';

// ─── Tree item types ──────────────────────────────────────────────────────────

export class ProjectItem extends vscode.TreeItem {
  constructor(
    public readonly projectDir: string,
    public readonly projectName: string,
    public readonly sessionFiles: string[]
  ) {
    super(projectName, vscode.TreeItemCollapsibleState.Collapsed);
    this.tooltip = projectDir;
    this.iconPath = new vscode.ThemeIcon('folder');
    this.contextValue = 'project';
    this.description = `${sessionFiles.length} session${sessionFiles.length !== 1 ? 's' : ''}`;
  }
}

export class SessionItem extends vscode.TreeItem {
  constructor(
    public readonly sessionFilePath: string,
    public readonly exportedPath: string | undefined,
    label: string,
    description: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.tooltip = sessionFilePath;
    this.description = description;
    this.contextValue = 'session';
    this.iconPath = new vscode.ThemeIcon(
      exportedPath && fs.existsSync(exportedPath)
        ? 'check'
        : 'circle-outline'
    );

    // Click to open the exported markdown (if it exists)
    if (exportedPath && fs.existsSync(exportedPath)) {
      this.command = {
        command: 'claudeCodeExporter.openSession',
        title: 'Open Session',
        arguments: [exportedPath],
      };
    }
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export class SessionTreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private projectGroups: Map<string, string[]> = new Map();

  constructor(
    private readonly projectsDir: string,
    private readonly exporter: MarkdownExporter
  ) {
    this.loadSessions();
  }

  refresh(): void {
    this.loadSessions();
    this._onDidChangeTreeData.fire();
  }

  private loadSessions(): void {
    const files = scanProjectsDir(this.projectsDir);
    this.projectGroups = groupByProject(files);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (!element) {
      // Root: list all projects
      const items: ProjectItem[] = [];
      for (const [dir, files] of this.projectGroups) {
        const name = path.basename(dir);
        const humanName = formatProjectName(name);
        items.push(new ProjectItem(dir, humanName, files));
      }
      // Sort by project name
      items.sort((a, b) => a.projectName.localeCompare(b.projectName));
      return items;
    }

    if (element instanceof ProjectItem) {
      return this.buildSessionItems(element.sessionFiles);
    }

    return [];
  }

  private buildSessionItems(files: string[]): SessionItem[] {
    const items: SessionItem[] = [];
    // opts not needed here; resolveOutputPath calls getOptions internally

    for (const file of files) {
      try {
        const stat = fs.statSync(file);
        const sessionId = path.basename(file, '.jsonl');
        const shortId = sessionId.split('-')[0];

        // Try to get the first user message as a label
        let label = `Session ${shortId}`;
        let startTime = '';
        try {
          const session = parseSessionFile(file);
          startTime = session.startTime
            ? formatShortDate(session.startTime)
            : '';
          // Find first non-empty user text
          for (const msg of session.messages) {
            if (msg.role === 'user') {
              for (const b of msg.blocks) {
                if (b.type === 'text' && (b as any).text?.trim()) {
                  label = truncate((b as any).text.trim(), 50);
                  break;
                }
              }
              break;
            }
          }

          // Check if export exists
          const exportedPath = this.exporter.resolveOutputPath(
            session,
            this.exporter.getOptions()
          );

          items.push(
            new SessionItem(file, exportedPath, label, startTime)
          );
        } catch {
          items.push(new SessionItem(file, undefined, label, startTime));
        }
      } catch {
        // skip unreadable
      }
    }

    // Sort by modification time (newest first)
    items.sort((a, b) => {
      try {
        const ta = fs.statSync(a.sessionFilePath).mtimeMs;
        const tb = fs.statSync(b.sessionFilePath).mtimeMs;
        return tb - ta;
      } catch {
        return 0;
      }
    });

    return items;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatProjectName(dirName: string): string {
  const match = dirName.match(/^([a-zA-Z])--(.+)$/);
  if (match) {
    return `${match[1]}:\\${match[2].replace(/-/g, '\\')}`;
  }
  return dirName;
}

function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return '';
  }
}

function truncate(str: string, maxLen: number): string {
  str = str.replace(/\s+/g, ' ').trim();
  return str.length <= maxLen ? str : str.slice(0, maxLen - 1) + '…';
}
