import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { MarkdownExporter } from './exporter';
import { SessionTreeProvider, SessionItem } from './treeProvider';
import { FileWatcher } from './watcher';

export function activate(context: vscode.ExtensionContext): void {
  const claudeProjectsBase = getClaudeProjectsBase();
  const exporter = new MarkdownExporter();

  // ─── Match current workspace to its Claude project dir ────────────────────
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const claudeProjectDir = workspaceRoot
    ? findClaudeProjectDir(claudeProjectsBase, workspaceRoot)
    : '';

  // ─── Tree view (shows this workspace's sessions) ─────────────────────────
  const treeProvider = new SessionTreeProvider(
    claudeProjectDir, workspaceRoot, exporter
  );
  const treeView = vscode.window.createTreeView('claudeCodeExporterSessions', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  // ─── File watcher (auto-export on JSONL change) ───────────────────────────
  let watcher: FileWatcher | undefined;
  if (claudeProjectDir && workspaceRoot) {
    watcher = new FileWatcher(claudeProjectDir, workspaceRoot, exporter, treeProvider);
    watcher.start();
  }

  // ─── Status bar ───────────────────────────────────────────────────────────
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right, 100
  );
  statusBar.command = 'claudeCodeExporter.exportMenu';
  statusBar.tooltip = 'Claude Code Exporter';
  updateStatusBar(statusBar, claudeProjectDir);
  statusBar.show();

  // ─── Re-match when workspace folders change ───────────────────────────────
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      const newRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
      const newDir = newRoot ? findClaudeProjectDir(claudeProjectsBase, newRoot) : '';
      treeProvider.setDirs(newDir, newRoot);

      watcher?.dispose();
      if (newDir && newRoot) {
        watcher = new FileWatcher(newDir, newRoot, exporter, treeProvider);
        watcher.start();
      }
      updateStatusBar(statusBar, newDir);
    })
  );

  // ─── Commands ─────────────────────────────────────────────────────────────
  context.subscriptions.push(
    // Refresh
    vscode.commands.registerCommand('claudeCodeExporter.refresh', () => {
      treeProvider.refresh();
      updateStatusBar(statusBar, claudeProjectDir);
    }),

    // Export menu — single vs batch, format choice
    vscode.commands.registerCommand('claudeCodeExporter.exportMenu', async () => {
      if (!claudeProjectDir || !workspaceRoot) {
        vscode.window.showWarningMessage(
          'No Claude Code sessions found for the current workspace.'
        );
        return;
      }

      const choice = await vscode.window.showQuickPick([
        {
          label: '$(cloud-download)  Export All Sessions',
          description: `Export all sessions to ${workspaceRoot}/.cc-history/`,
          value: 'all',
        },
        {
          label: '$(settings-gear)  Change Format, Then Export All',
          description: 'Pick readable or compact format first',
          value: 'format',
        },
        {
          label: '$(folder-opened)  Open .cc-history/ Folder',
          description: 'Reveal the export folder in the file explorer',
          value: 'open',
        },
        {
          label: '$(tools)  Tidy .cc-history/',
          description: 'Merge duplicates & fix timestamps',
          value: 'tidy',
        },
      ], { placeHolder: 'Claude Code Exporter' });

      if (!choice) return;

      if (choice.value === 'open') {
        openCcHistory(workspaceRoot);
        return;
      }

      if (choice.value === 'tidy') {
        const ccHistory = path.join(workspaceRoot, '.cc-history');
        const result = exporter.tidyHistory(ccHistory, claudeProjectDir || undefined);
        treeProvider.refresh();
        vscode.window.showInformationMessage(
          `Tidy done: ${result.merged} duplicates merged, ${result.renamed} files renamed` +
          (result.errors > 0 ? `, ${result.errors} errors` : '')
        );
        return;
      }

      if (choice.value === 'format') {
        const fmt = await pickFormat();
        if (!fmt) return;
        await vscode.workspace.getConfiguration('claudeCodeExporter')
          .update('exportFormat', fmt, vscode.ConfigurationTarget.Global);
      }

      await doExportAll(exporter, claudeProjectDir, workspaceRoot, treeProvider);
    }),

    // Set output directory (for global/custom export, secondary feature)
    vscode.commands.registerCommand('claudeCodeExporter.setOutputDirectory', async () => {
      vscode.window.showInformationMessage(
        'Exports are saved to .cc-history/ inside your workspace by default. ' +
        'To override, set "claudeCodeExporter.outputDirectory" in settings.'
      );
    }),

    // Open export folder
    vscode.commands.registerCommand('claudeCodeExporter.openExportFolder', () => {
      if (workspaceRoot) openCcHistory(workspaceRoot);
    }),

    // Tidy history — merge duplicates, fix timestamps
    vscode.commands.registerCommand('claudeCodeExporter.tidyHistory', () => {
      if (!workspaceRoot) {
        vscode.window.showWarningMessage('No workspace open.');
        return;
      }
      const ccHistory = path.join(workspaceRoot, '.cc-history');
      const result = exporter.tidyHistory(ccHistory, claudeProjectDir || undefined);
      treeProvider.refresh();
      vscode.window.showInformationMessage(
        `Tidy done: ${result.merged} duplicates merged, ${result.renamed} files renamed` +
        (result.errors > 0 ? `, ${result.errors} errors` : '')
      );
    }),

    // Export single session (from tree item context menu)
    vscode.commands.registerCommand('claudeCodeExporter.exportSession',
      async (item: SessionItem | string) => {
        const filePath = typeof item === 'string' ? item : item.sessionFilePath;
        if (!workspaceRoot) {
          vscode.window.showWarningMessage('No workspace open.');
          return;
        }

        const fmt = await pickFormat();
        if (!fmt) return;

        try {
          const outPath = exporter.exportSessionToWorkspace(
            filePath, workspaceRoot, { exportFormat: fmt }
          );
          treeProvider.refresh();
          vscode.window
            .showInformationMessage(`Exported → .cc-history/${path.basename(outPath)}`, 'Open')
            .then((c) => { if (c === 'Open') openMarkdown(outPath); });
        } catch (err) {
          vscode.window.showErrorMessage(`Export failed: ${err}`);
        }
      }
    ),

    // Open exported markdown file
    vscode.commands.registerCommand('claudeCodeExporter.openSession',
      (pathOrItem: string | SessionItem) => {
        const mdPath = typeof pathOrItem === 'string' ? pathOrItem : pathOrItem.exportedPath;
        if (mdPath) openMarkdown(mdPath);
      }
    ),

    // Scan whole computer
    vscode.commands.registerCommand('claudeCodeExporter.scanComputer', async () => {
      const ok = await vscode.window.showWarningMessage(
        'Export ALL Claude Code conversations from every project on this computer into each project\'s .cc-history/ folder?',
        'Export All Projects', 'Cancel'
      );
      if (ok !== 'Export All Projects') return;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Exporting…', cancellable: false },
        async () => {
          let count = 0;
          for (const dir of fs.readdirSync(claudeProjectsBase)) {
            const projDir = path.join(claudeProjectsBase, dir);
            if (!fs.statSync(projDir).isDirectory()) continue;

            const cwd = getProjectCwd(projDir);
            if (!cwd || !fs.existsSync(cwd)) continue;

            const results = exporter.exportAllToWorkspace(projDir, cwd);
            count += results.length;
          }
          treeProvider.refresh();
          vscode.window.showInformationMessage(
            `Done! Exported ${count} session(s) across all projects.`
          );
        }
      );
    }),

    treeView,
    statusBar
  );

  if (watcher) context.subscriptions.push(watcher);

  // ─── Auto-export on activation ────────────────────────────────────────────
  const cfg = vscode.workspace.getConfiguration('claudeCodeExporter');
  if (cfg.get<boolean>('autoExport') && claudeProjectDir && workspaceRoot) {
    exporter.exportAllToWorkspace(claudeProjectDir, workspaceRoot);
    treeProvider.refresh();
  }

  console.log('[cc-exporter] Activated.',
    claudeProjectDir ? `Watching ${claudeProjectDir}` : 'No matching project found.');
}

export function deactivate(): void {}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getClaudeProjectsBase(): string {
  const cfg = vscode.workspace.getConfiguration('claudeCodeExporter');
  return cfg.get<string>('claudeProjectsDir') || path.join(os.homedir(), '.claude', 'projects');
}

/**
 * Find the Claude project directory that corresponds to a workspace path.
 * We read the first JSONL in each project dir and match its `cwd` field.
 */
function findClaudeProjectDir(projectsBase: string, workspacePath: string): string {
  if (!fs.existsSync(projectsBase)) return '';

  // Normalize for comparison (lowercase, forward slashes)
  const normalWs = normalizePath(workspacePath);

  for (const dir of fs.readdirSync(projectsBase)) {
    const projDir = path.join(projectsBase, dir);
    if (!fs.statSync(projDir).isDirectory()) continue;

    const cwd = getProjectCwd(projDir);
    if (cwd && normalizePath(cwd) === normalWs) return projDir;
  }
  return '';
}

/** Read the cwd from the first JSONL in a Claude project directory */
function getProjectCwd(projDir: string): string {
  const jsonls = fs.readdirSync(projDir).filter((f) => f.endsWith('.jsonl'));
  if (jsonls.length === 0) return '';

  const firstFile = path.join(projDir, jsonls[0]);
  const raw = fs.readFileSync(firstFile, 'utf8');
  const lines = raw.split('\n');

  for (const line of lines.slice(0, 15)) {
    try {
      const obj = JSON.parse(line);
      if (obj.cwd) return obj.cwd;
    } catch {}
  }
  return '';
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
}

async function doExportAll(
  exporter: MarkdownExporter,
  claudeDir: string,
  wsRoot: string,
  treeProvider: SessionTreeProvider
): Promise<void> {
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Exporting…' },
    async () => {
      const results = exporter.exportAllToWorkspace(claudeDir, wsRoot);
      treeProvider.refresh();
      vscode.window
        .showInformationMessage(
          `Exported ${results.length} session(s) to .cc-history/`,
          'Open Folder'
        )
        .then((c) => { if (c === 'Open Folder') openCcHistory(wsRoot); });
    }
  );
}

function openCcHistory(wsRoot: string): void {
  const dir = path.join(wsRoot, '.cc-history');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dir));
}

function openMarkdown(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(filePath));
}

async function pickFormat(): Promise<'readable' | 'compact' | undefined> {
  const fmt = await vscode.window.showQuickPick([
    { label: '$(book)  Readable', description: 'Rich Markdown with tool details — for archiving', value: 'readable' as const },
    { label: '$(comment)  Compact', description: 'Clean Human/Claude turns — for pasting back to Claude', value: 'compact' as const },
  ], { placeHolder: 'Export format?' });
  return fmt?.value;
}

function updateStatusBar(item: vscode.StatusBarItem, claudeDir: string): void {
  try {
    if (claudeDir && fs.existsSync(claudeDir)) {
      const count = fs.readdirSync(claudeDir).filter((f) => f.endsWith('.jsonl')).length;
      item.text = `$(comment-discussion) ${count} CC sessions`;
    } else {
      item.text = `$(comment-discussion) CC Exporter`;
    }
  } catch {
    item.text = `$(comment-discussion) CC Exporter`;
  }
}
