import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parseSessionFile, TextBlock } from './parser';
import { MarkdownExporter, ExportOptions } from './exporter';

// ─── Tree items ─────────────────────────────────────────────────────────────

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
      exportedPath && fs.existsSync(exportedPath) ? 'check' : 'circle-outline'
    );
    if (exportedPath && fs.existsSync(exportedPath)) {
      this.command = {
        command: 'claudeCodeExporter.openSession',
        title: 'Open',
        arguments: [exportedPath],
      };
    }
  }
}

// ─── Provider ───────────────────────────────────────────────────────────────

export class SessionTreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private _onChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onChange.event;

  constructor(
    private claudeProjectDir: string,
    private workspaceRoot: string,
    private readonly exporter: MarkdownExporter
  ) {}

  /** Update dirs if workspace or mapping changes */
  setDirs(claudeProjectDir: string, workspaceRoot: string): void {
    this.claudeProjectDir = claudeProjectDir;
    this.workspaceRoot = workspaceRoot;
    this._onChange.fire();
  }

  refresh(): void {
    this._onChange.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    if (!this.claudeProjectDir || !fs.existsSync(this.claudeProjectDir)) {
      return [
        new vscode.TreeItem('No Claude sessions found for this workspace'),
      ];
    }

    const files = fs
      .readdirSync(this.claudeProjectDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(this.claudeProjectDir, f));

    if (files.length === 0) {
      return [new vscode.TreeItem('No sessions yet')];
    }

    const items: SessionItem[] = [];
    const ccHistory = path.join(this.workspaceRoot, '.cc-history');

    for (const file of files) {
      try {
        const session = parseSessionFile(file);
        const shortId = session.sessionId.split('-')[0];

        // Find first user text as label
        let label = `Session ${shortId}`;
        for (const msg of session.messages) {
          if (msg.role === 'user') {
            for (const b of msg.blocks) {
              if (b.type === 'text' && (b as TextBlock).text?.trim()) {
                label = truncate((b as TextBlock).text.trim(), 50);
                break;
              }
            }
            break;
          }
        }

        const date = session.startTime
          ? new Date(session.startTime).toLocaleDateString()
          : '';

        // Check if already exported
        let exportedPath: string | undefined;
        if (fs.existsSync(ccHistory)) {
          const existing = fs
            .readdirSync(ccHistory)
            .find((f) => f.includes(shortId) && f.endsWith('.md'));
          if (existing) exportedPath = path.join(ccHistory, existing);
        }

        items.push(new SessionItem(file, exportedPath, label, date));
      } catch {
        // skip unreadable
      }
    }

    // Sort newest first
    items.sort((a, b) => {
      try {
        return (
          fs.statSync(b.sessionFilePath).mtimeMs -
          fs.statSync(a.sessionFilePath).mtimeMs
        );
      } catch {
        return 0;
      }
    });

    return items;
  }
}

function truncate(str: string, max: number): string {
  str = str.replace(/\s+/g, ' ').trim();
  return str.length <= max ? str : str.slice(0, max - 1) + '…';
}
