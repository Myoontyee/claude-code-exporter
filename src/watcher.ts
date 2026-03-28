import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { MarkdownExporter } from './exporter';
import { SessionTreeProvider } from './treeProvider';

/** Watches ~/.claude/projects/**​/*.jsonl for changes and triggers auto-export */
export class FileWatcher implements vscode.Disposable {
  private watcher?: fs.FSWatcher;
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private disposed = false;

  constructor(
    private readonly projectsDir: string,
    private readonly exporter: MarkdownExporter,
    private readonly treeProvider: SessionTreeProvider
  ) {}

  start(): void {
    if (!fs.existsSync(this.projectsDir)) {
      console.log(
        `[claude-code-exporter] Projects dir not found: ${this.projectsDir}`
      );
      return;
    }

    // Watch the top-level projects directory recursively.
    // On Windows, fs.watch with recursive:true works natively.
    this.watcher = fs.watch(
      this.projectsDir,
      { recursive: true },
      (event, filename) => {
        if (!filename || !filename.endsWith('.jsonl')) return;

        // Debounce rapid writes (Claude Code writes frequently during a session)
        const fullPath = path.join(this.projectsDir, filename);
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
      console.error('[claude-code-exporter] Watcher error:', err);
    });

    console.log(
      `[claude-code-exporter] Watching ${this.projectsDir} for changes`
    );
  }

  private async handleChange(filePath: string): Promise<void> {
    if (this.disposed) return;
    if (!fs.existsSync(filePath)) return;

    const cfg = vscode.workspace.getConfiguration('claudeCodeExporter');
    if (!cfg.get<boolean>('autoExport')) return;

    try {
      const outPath = await this.exporter.exportSession(filePath);
      console.log(`[claude-code-exporter] Exported → ${outPath}`);
      this.treeProvider.refresh();
    } catch (err) {
      console.error(
        `[claude-code-exporter] Export failed for ${filePath}:`,
        err
      );
    }
  }

  dispose(): void {
    this.disposed = true;
    this.watcher?.close();
    for (const t of this.debounceTimers.values()) clearTimeout(t);
    this.debounceTimers.clear();
  }
}
