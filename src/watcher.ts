import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { MarkdownExporter } from './exporter';
import { SessionTreeProvider } from './treeProvider';

/**
 * Watches a specific Claude project directory for JSONL changes
 * and auto-exports into the corresponding workspace's .cc-history/.
 */
export class FileWatcher implements vscode.Disposable {
  private watcher?: fs.FSWatcher;
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private disposed = false;

  constructor(
    /** The ~/.claude/projects/<encoded>/ directory to watch */
    private readonly claudeProjectDir: string,
    /** The workspace root where .cc-history/ lives */
    private readonly workspaceRoot: string,
    private readonly exporter: MarkdownExporter,
    private readonly treeProvider: SessionTreeProvider
  ) {}

  start(): void {
    if (!fs.existsSync(this.claudeProjectDir)) {
      console.log(`[cc-exporter] Dir not found: ${this.claudeProjectDir}`);
      return;
    }

    this.watcher = fs.watch(
      this.claudeProjectDir,
      { recursive: false },
      (_event, filename) => {
        if (!filename || !filename.endsWith('.jsonl')) return;

        const fullPath = path.join(this.claudeProjectDir, filename);
        const existing = this.debounceTimers.get(fullPath);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(() => {
          this.debounceTimers.delete(fullPath);
          this.handleChange(fullPath);
        }, 500);

        this.debounceTimers.set(fullPath, timer);
      }
    );

    this.watcher.on('error', (err) => {
      console.error('[cc-exporter] Watcher error:', err);
    });

    console.log(
      `[cc-exporter] Watching ${this.claudeProjectDir} → ${this.workspaceRoot}/.cc-history/`
    );
  }

  private handleChange(filePath: string): void {
    if (this.disposed || !fs.existsSync(filePath)) return;

    const cfg = require('vscode').workspace.getConfiguration('claudeCodeExporter');
    if (!cfg.get<boolean>('autoExport')) return;

    try {
      const outPath = this.exporter.exportSessionToWorkspace(
        filePath,
        this.workspaceRoot
      );
      console.log(`[cc-exporter] Auto-exported → ${outPath}`);
      this.treeProvider.refresh();
    } catch (err) {
      console.error(`[cc-exporter] Export failed: ${filePath}`, err);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.watcher?.close();
    for (const t of this.debounceTimers.values()) clearTimeout(t);
    this.debounceTimers.clear();
  }
}
