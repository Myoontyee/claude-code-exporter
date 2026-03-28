import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { MarkdownExporter } from './exporter';
import { SessionTreeProvider, SessionItem } from './treeProvider';
import { FileWatcher } from './watcher';

export function activate(context: vscode.ExtensionContext): void {
  const claudeProjectsDir = getClaudeProjectsDir();
  const exporter = new MarkdownExporter(context);
  const treeProvider = new SessionTreeProvider(claudeProjectsDir, exporter);

  // ─── Sidebar tree view ────────────────────────────────────────────────────
  const treeView = vscode.window.createTreeView('claudeCodeExporterSessions', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  // ─── File watcher ─────────────────────────────────────────────────────────
  const watcher = new FileWatcher(claudeProjectsDir, exporter, treeProvider);
  watcher.start();

  // ─── Status bar ───────────────────────────────────────────────────────────
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBar.command = 'claudeCodeExporter.openExportFolder';
  statusBar.tooltip = 'Claude Code Exporter — click to open export folder';
  updateStatusBar(statusBar, claudeProjectsDir);
  statusBar.show();

  // ─── Commands ─────────────────────────────────────────────────────────────
  context.subscriptions.push(
    // Refresh tree view
    vscode.commands.registerCommand('claudeCodeExporter.refresh', () => {
      treeProvider.refresh();
      updateStatusBar(statusBar, claudeProjectsDir);
    }),

    // Export all conversations
    vscode.commands.registerCommand(
      'claudeCodeExporter.exportAll',
      async () => {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Exporting all Claude Code conversations…',
            cancellable: false,
          },
          async () => {
            const paths = await exporter.exportAll(claudeProjectsDir);
            treeProvider.refresh();
            updateStatusBar(statusBar, claudeProjectsDir);
            vscode.window
              .showInformationMessage(
                `Exported ${paths.length} session(s).`,
                'Open Folder'
              )
              .then((choice) => {
                if (choice === 'Open Folder') {
                  openOutputFolder();
                }
              });
          }
        );
      }
    ),

    // Open export folder in OS
    vscode.commands.registerCommand(
      'claudeCodeExporter.openExportFolder',
      () => openOutputFolder()
    ),

    // Export a single session (called from tree item context menu)
    vscode.commands.registerCommand(
      'claudeCodeExporter.exportSession',
      async (item: SessionItem | string) => {
        const filePath =
          typeof item === 'string' ? item : item.sessionFilePath;
        try {
          const outPath = await exporter.exportSession(filePath);
          treeProvider.refresh();
          vscode.window
            .showInformationMessage(`Exported to ${outPath}`, 'Open')
            .then((c) => {
              if (c === 'Open') openMarkdownFile(outPath);
            });
        } catch (err) {
          vscode.window.showErrorMessage(`Export failed: ${err}`);
        }
      }
    ),

    // Open exported markdown
    vscode.commands.registerCommand(
      'claudeCodeExporter.openSession',
      (pathOrItem: string | SessionItem) => {
        const mdPath =
          typeof pathOrItem === 'string' ? pathOrItem : pathOrItem.exportedPath;
        if (mdPath) openMarkdownFile(mdPath);
      }
    ),

    // Scan entire computer for Claude conversations
    vscode.commands.registerCommand(
      'claudeCodeExporter.scanComputer',
      async () => {
        const choice = await vscode.window.showWarningMessage(
          'This will scan your entire home directory for Claude Code conversation files. It may take a while.',
          'Scan Home Directory',
          'Cancel'
        );
        if (choice !== 'Scan Home Directory') return;

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Scanning for Claude Code conversations…',
            cancellable: true,
          },
          async (progress, token) => {
            const found = await scanForClaudeProjects(
              os.homedir(),
              progress,
              token
            );
            if (token.isCancellationRequested) return;

            const count = found.reduce(
              (acc, dir) => acc + countJsonl(dir),
              0
            );
            const choice2 = await vscode.window.showInformationMessage(
              `Found ${found.length} Claude projects with ${count} sessions.`,
              'Export All',
              'Dismiss'
            );
            if (choice2 === 'Export All') {
              for (const dir of found) {
                await exporter.exportAll(dir);
              }
              treeProvider.refresh();
              vscode.window.showInformationMessage('Export complete!');
            }
          }
        );
      }
    ),

    treeView,
    watcher,
    statusBar
  );

  // ─── Auto-export on activation ────────────────────────────────────────────
  const cfg = vscode.workspace.getConfiguration('claudeCodeExporter');
  if (cfg.get<boolean>('autoExport')) {
    // Run initial export in background
    exporter.exportAll(claudeProjectsDir).then(() => {
      treeProvider.refresh();
      updateStatusBar(statusBar, claudeProjectsDir);
    });
  }

  console.log('[claude-code-exporter] Extension activated.');
}

export function deactivate(): void {}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getClaudeProjectsDir(): string {
  const cfg = vscode.workspace.getConfiguration('claudeCodeExporter');
  const custom = cfg.get<string>('claudeProjectsDir');
  if (custom) return custom;
  return path.join(os.homedir(), '.claude', 'projects');
}

function openOutputFolder(): void {
  const cfg = vscode.workspace.getConfiguration('claudeCodeExporter');
  const outputDir =
    cfg.get<string>('outputDirectory') ||
    path.join(os.homedir(), 'claude-exports');
  vscode.commands.executeCommand(
    'revealFileInOS',
    vscode.Uri.file(outputDir)
  );
}

function openMarkdownFile(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    vscode.window.showWarningMessage(`File not found: ${filePath}`);
    return;
  }
  vscode.commands.executeCommand(
    'markdown.showPreview',
    vscode.Uri.file(filePath)
  );
}

function updateStatusBar(
  item: vscode.StatusBarItem,
  projectsDir: string
): void {
  try {
    let sessionCount = 0;
    if (fs.existsSync(projectsDir)) {
      for (const d of fs.readdirSync(projectsDir)) {
        const full = path.join(projectsDir, d);
        if (fs.statSync(full).isDirectory()) {
          sessionCount += fs
            .readdirSync(full)
            .filter((f) => f.endsWith('.jsonl')).length;
        }
      }
    }
    item.text = `$(comment-discussion) ${sessionCount} Claude sessions`;
  } catch {
    item.text = `$(comment-discussion) Claude Exporter`;
  }
}

/** Recursively scan for .claude/projects directories */
async function scanForClaudeProjects(
  rootDir: string,
  progress: vscode.Progress<{ message?: string }>,
  token: vscode.CancellationToken
): Promise<string[]> {
  const results: string[] = [];

  // Common locations to check first (fast path)
  const commonPaths = [
    path.join(rootDir, '.claude', 'projects'),
    path.join(rootDir, 'AppData', 'Local', '.claude', 'projects'),
    path.join(rootDir, 'AppData', 'Roaming', '.claude', 'projects'),
  ];

  for (const p of commonPaths) {
    if (fs.existsSync(p)) results.push(p);
  }

  if (results.length > 0) return results;

  // Deep scan (slower)
  progress.report({ message: 'Deep scanning home directory…' });
  await deepScan(rootDir, results, token, 0, 4);
  return results;
}

async function deepScan(
  dir: string,
  results: string[],
  token: vscode.CancellationToken,
  depth: number,
  maxDepth: number
): Promise<void> {
  if (depth > maxDepth || token.isCancellationRequested) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (token.isCancellationRequested) return;
    if (!entry.isDirectory()) continue;

    // Skip heavy system dirs
    const skip = [
      'node_modules',
      '.git',
      'Library',
      'System',
      'Windows',
      'Program Files',
    ];
    if (skip.includes(entry.name)) continue;

    const full = path.join(dir, entry.name);

    if (entry.name === 'projects' && dir.endsWith('.claude')) {
      results.push(full);
      continue;
    }

    await deepScan(full, results, token, depth + 1, maxDepth);
  }
}

function countJsonl(projectsDir: string): number {
  let count = 0;
  try {
    for (const d of fs.readdirSync(projectsDir)) {
      const full = path.join(projectsDir, d);
      if (fs.statSync(full).isDirectory()) {
        count += fs
          .readdirSync(full)
          .filter((f) => f.endsWith('.jsonl')).length;
      }
    }
  } catch {}
  return count;
}
