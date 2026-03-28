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
    vscode.StatusBarAlignment.Right, 100
  );
  statusBar.command = 'claudeCodeExporter.exportMenu';
  statusBar.tooltip = 'Claude Code Exporter — click to export';
  updateStatusBar(statusBar, claudeProjectsDir);
  statusBar.show();

  // ─── Commands ─────────────────────────────────────────────────────────────
  context.subscriptions.push(
    // Refresh
    vscode.commands.registerCommand('claudeCodeExporter.refresh', () => {
      treeProvider.refresh();
      updateStatusBar(statusBar, claudeProjectsDir);
    }),

    // 【新】导出菜单 — 点一个按钮选单个还是批量
    vscode.commands.registerCommand('claudeCodeExporter.exportMenu', async () => {
      const choice = await vscode.window.showQuickPick(
        [
          {
            label: '$(cloud-download)  Export All Sessions',
            description: 'Export every conversation across all projects',
            value: 'all',
          },
          {
            label: '$(export)  Export Current Project Only',
            description: 'Export sessions for the currently open workspace project',
            value: 'current',
          },
          {
            label: '$(list-selection)  Choose Format Before Exporting',
            description: 'Pick readable (archive) or compact (paste to Claude) format',
            value: 'format',
          },
        ],
        { placeHolder: 'What do you want to export?' }
      );

      if (!choice) return;

      if (choice.value === 'format') {
        await pickFormatThenExport(exporter, claudeProjectsDir, treeProvider, statusBar);
        return;
      }

      let targetDir = claudeProjectsDir;
      if (choice.value === 'current') {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!cwd) {
          vscode.window.showWarningMessage('No workspace folder open.');
          return;
        }
        // Find matching project dir
        const encoded = encodePath(cwd);
        const candidate = path.join(claudeProjectsDir, encoded);
        if (!fs.existsSync(candidate)) {
          vscode.window.showWarningMessage(
            `No Claude sessions found for this workspace.\nExpected: ${candidate}`
          );
          return;
        }
        targetDir = candidate;
      }

      await runExportAll(exporter, targetDir, treeProvider, statusBar);
    }),

    // 【新】选择输出文件夹
    vscode.commands.registerCommand(
      'claudeCodeExporter.setOutputDirectory',
      async () => {
        const picked = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          title: 'Choose folder to save exported conversations',
          openLabel: 'Set as Export Folder',
        });
        if (!picked || picked.length === 0) return;
        const chosen = picked[0].fsPath;
        await vscode.workspace
          .getConfiguration('claudeCodeExporter')
          .update('outputDirectory', chosen, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Export folder set to: ${chosen}`);
        treeProvider.refresh();
      }
    ),

    // Open export folder in OS
    vscode.commands.registerCommand('claudeCodeExporter.openExportFolder', () => {
      openOutputFolder(exporter);
    }),

    // Export single session (from tree item)
    vscode.commands.registerCommand(
      'claudeCodeExporter.exportSession',
      async (item: SessionItem | string) => {
        const filePath = typeof item === 'string' ? item : item.sessionFilePath;

        // Ask format
        const fmt = await vscode.window.showQuickPick(
          [
            { label: '$(book)  Readable', description: 'Rich Markdown — good for archiving and human reading', value: 'readable' },
            { label: '$(comment)  Compact', description: 'Clean Human/Claude format — good for pasting back into Claude', value: 'compact' },
          ],
          { placeHolder: 'Export format?' }
        );
        if (!fmt) return;

        try {
          const outPath = await exporter.exportSession(filePath, {
            exportFormat: fmt.value as 'readable' | 'compact',
          });
          treeProvider.refresh();
          vscode.window
            .showInformationMessage(`Exported → ${outPath}`, 'Open')
            .then((c) => { if (c === 'Open') openMarkdownFile(outPath); });
        } catch (err) {
          vscode.window.showErrorMessage(`Export failed: ${err}`);
        }
      }
    ),

    // Open exported markdown
    vscode.commands.registerCommand(
      'claudeCodeExporter.openSession',
      (pathOrItem: string | SessionItem) => {
        const mdPath = typeof pathOrItem === 'string' ? pathOrItem : pathOrItem.exportedPath;
        if (mdPath) openMarkdownFile(mdPath);
      }
    ),

    // Scan entire computer
    vscode.commands.registerCommand('claudeCodeExporter.scanComputer', async () => {
      const choice = await vscode.window.showWarningMessage(
        'Scan your entire home directory for Claude Code conversation files?',
        'Scan Home Directory', 'Cancel'
      );
      if (choice !== 'Scan Home Directory') return;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Scanning…', cancellable: true },
        async (progress, token) => {
          const found = await scanForClaudeProjects(os.homedir(), progress, token);
          if (token.isCancellationRequested) return;
          const count = found.reduce((acc, dir) => acc + countJsonl(dir), 0);
          const c = await vscode.window.showInformationMessage(
            `Found ${found.length} Claude project(s) with ${count} sessions.`,
            'Export All', 'Dismiss'
          );
          if (c === 'Export All') {
            for (const dir of found) await exporter.exportAll(dir);
            treeProvider.refresh();
            vscode.window.showInformationMessage('Export complete!');
          }
        }
      );
    }),

    treeView,
    watcher,
    statusBar
  );

  // ─── Auto-export on activation ────────────────────────────────────────────
  const cfg = vscode.workspace.getConfiguration('claudeCodeExporter');
  // Only auto-export if a directory is already configured (don't prompt on startup)
  if (cfg.get<boolean>('autoExport') && cfg.get<string>('outputDirectory')) {
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

async function runExportAll(
  exporter: MarkdownExporter,
  projectsDir: string,
  treeProvider: SessionTreeProvider,
  statusBar: vscode.StatusBarItem
): Promise<void> {
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Exporting conversations…', cancellable: false },
    async () => {
      const paths = await exporter.exportAll(projectsDir);
      treeProvider.refresh();
      updateStatusBar(statusBar, projectsDir);
      vscode.window
        .showInformationMessage(`Exported ${paths.length} session(s).`, 'Open Folder')
        .then((c) => { if (c === 'Open Folder') openOutputFolder(exporter); });
    }
  );
}

async function pickFormatThenExport(
  exporter: MarkdownExporter,
  claudeProjectsDir: string,
  treeProvider: SessionTreeProvider,
  statusBar: vscode.StatusBarItem
): Promise<void> {
  const fmt = await vscode.window.showQuickPick(
    [
      { label: '$(book)  Readable', description: 'Rich Markdown with metadata and tool details — best for archiving', value: 'readable' },
      { label: '$(comment)  Compact', description: 'Clean Human/Claude turns only — best for pasting back into Claude as context', value: 'compact' },
    ],
    { placeHolder: 'Choose export format' }
  );
  if (!fmt) return;

  // Persist the chosen format
  await vscode.workspace
    .getConfiguration('claudeCodeExporter')
    .update('exportFormat', fmt.value, vscode.ConfigurationTarget.Global);

  await runExportAll(exporter, claudeProjectsDir, treeProvider, statusBar);
}

function openOutputFolder(exporter: MarkdownExporter): void {
  const cfg = vscode.workspace.getConfiguration('claudeCodeExporter');
  const outputDir = cfg.get<string>('outputDirectory') || path.join(os.homedir(), 'claude-exports');
  if (!fs.existsSync(outputDir)) {
    vscode.window.showWarningMessage(`Export folder not found: ${outputDir}`);
    return;
  }
  vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outputDir));
}

function openMarkdownFile(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    vscode.window.showWarningMessage(`File not found: ${filePath}`);
    return;
  }
  vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(filePath));
}

function updateStatusBar(item: vscode.StatusBarItem, projectsDir: string): void {
  try {
    let count = 0;
    if (fs.existsSync(projectsDir)) {
      for (const d of fs.readdirSync(projectsDir)) {
        const full = path.join(projectsDir, d);
        if (fs.statSync(full).isDirectory()) {
          count += fs.readdirSync(full).filter((f) => f.endsWith('.jsonl')).length;
        }
      }
    }
    item.text = `$(comment-discussion) ${count} Claude sessions`;
  } catch {
    item.text = `$(comment-discussion) Claude Exporter`;
  }
}

/** Encode a filesystem path to the ~/.claude/projects/ directory name format */
function encodePath(fsPath: string): string {
  // e.g. E:\001Code\Jupyter\Trading → e--001Code-Jupyter-Trading
  return fsPath
    .replace(/^([a-zA-Z]):/, '$1')          // remove colon after drive letter
    .replace(/[/\\]/g, '-')                 // slashes → dashes
    .replace(/^-/, '')                      // remove leading dash
    .replace(/([a-z])([A-Z0-9])/, '$1--$2') // drive letter pattern
    .toLowerCase()
    .replace(/^([a-z])/, (m) => m.toLowerCase())
    + '';
  // Note: actual encoding is Claude's own scheme; this is a best-effort match
}

async function scanForClaudeProjects(
  rootDir: string,
  progress: vscode.Progress<{ message?: string }>,
  token: vscode.CancellationToken
): Promise<string[]> {
  const results: string[] = [];
  const commonPaths = [
    path.join(rootDir, '.claude', 'projects'),
    path.join(rootDir, 'AppData', 'Local', '.claude', 'projects'),
    path.join(rootDir, 'AppData', 'Roaming', '.claude', 'projects'),
  ];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) results.push(p);
  }
  if (results.length > 0) return results;

  progress.report({ message: 'Deep scanning…' });
  await deepScan(rootDir, results, token, 0, 4);
  return results;
}

async function deepScan(
  dir: string, results: string[], token: vscode.CancellationToken,
  depth: number, maxDepth: number
): Promise<void> {
  if (depth > maxDepth || token.isCancellationRequested) return;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

  for (const entry of entries) {
    if (token.isCancellationRequested) return;
    if (!entry.isDirectory()) continue;
    const skip = ['node_modules', '.git', 'Library', 'System', 'Windows', 'Program Files'];
    if (skip.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.name === 'projects' && dir.endsWith('.claude')) { results.push(full); continue; }
    await deepScan(full, results, token, depth + 1, maxDepth);
  }
}

function countJsonl(projectsDir: string): number {
  let count = 0;
  try {
    for (const d of fs.readdirSync(projectsDir)) {
      const full = path.join(projectsDir, d);
      if (fs.statSync(full).isDirectory()) {
        count += fs.readdirSync(full).filter((f) => f.endsWith('.jsonl')).length;
      }
    }
  } catch {}
  return count;
}
