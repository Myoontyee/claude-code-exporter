#!/usr/bin/env node
/**
 * Fetches download counts from Open VSX & VS Code Marketplace,
 * appends to stats/downloads.json, and generates stats/downloads-chart.svg.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const STATS_FILE = path.join(__dirname, '..', 'stats', 'downloads.json');
const CHART_FILE = path.join(__dirname, '..', 'stats', 'downloads-chart.svg');
const EXT_ID = 'myoontyee.claude-code-exporter';

// ── Fetch helpers ────────────────────────────────────────────────────────────

function get(url) {
  const mod = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    mod.get(url, { headers: { 'User-Agent': 'claude-code-exporter-stats' } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

async function fetchOpenVSX() {
  try {
    const r = await get('https://open-vsx.org/api/myoontyee/claude-code-exporter');
    const j = JSON.parse(r.body);
    return j.downloadCount ?? 0;
  } catch { return 0; }
}

async function fetchVSCodeMarketplace() {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      filters: [{ criteria: [{ filterType: 7, value: EXT_ID }] }],
      assetTypes: [],
      flags: 914,
    });
    const req = https.request(
      {
        hostname: 'marketplace.visualstudio.com',
        path: '/_apis/public/gallery/extensionquery',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json;api-version=6.0-preview.1',
          'User-Agent': 'claude-code-exporter-stats',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(data);
            const ext = j.results?.[0]?.extensions?.[0];
            if (!ext) return resolve(0);
            const stats = ext.statistics || [];
            const install = stats.find((s) => s.statisticName === 'install');
            resolve(install ? Math.round(install.value) : 0);
          } catch { resolve(0); }
        });
      },
    );
    req.on('error', () => resolve(0));
    req.write(body);
    req.end();
  });
}

// ── SVG chart generator ─────────────────────────────────────────────────────

function generateChart(records) {
  const W = 720, H = 320;
  const pad = { top: 40, right: 30, bottom: 60, left: 60 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  if (records.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect width="100%" height="100%" fill="#0d1117"/>
      <text x="${W/2}" y="${H/2}" fill="#8b949e" text-anchor="middle" font-family="sans-serif" font-size="14">No data yet — check back tomorrow</text>
    </svg>`;
  }

  const maxOVSX = Math.max(...records.map((r) => r.openvsx), 1);
  const maxVSC  = Math.max(...records.map((r) => r.vscode), 1);
  const maxY = Math.max(maxOVSX, maxVSC);
  // Nice round ceiling
  const ceil = maxY <= 10 ? 10 : Math.ceil(maxY / (10 ** Math.floor(Math.log10(maxY)))) * (10 ** Math.floor(Math.log10(maxY)));

  const xStep = records.length > 1 ? plotW / (records.length - 1) : plotW / 2;
  const toX = (i) => pad.left + i * xStep;
  const toY = (v) => pad.top + plotH - (v / ceil) * plotH;

  function polyline(data, key, color) {
    const pts = data.map((r, i) => `${toX(i).toFixed(1)},${toY(r[key]).toFixed(1)}`).join(' ');
    // area fill
    const area = `${toX(0).toFixed(1)},${toY(0).toFixed(1)} ${pts} ${toX(data.length - 1).toFixed(1)},${toY(0).toFixed(1)}`;
    return `<polygon points="${area}" fill="${color}" opacity="0.1"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${data.map((r, i) => `<circle cx="${toX(i).toFixed(1)}" cy="${toY(r[key]).toFixed(1)}" r="3" fill="${color}"/>`).join('\n    ')}`;
  }

  // Grid lines
  const gridLines = [];
  const gridCount = 5;
  for (let i = 0; i <= gridCount; i++) {
    const y = pad.top + (plotH / gridCount) * i;
    const val = Math.round(ceil - (ceil / gridCount) * i);
    gridLines.push(`<line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" stroke="#21262d" stroke-width="1"/>`);
    gridLines.push(`<text x="${pad.left - 8}" y="${y + 4}" fill="#8b949e" text-anchor="end" font-family="sans-serif" font-size="11">${val}</text>`);
  }

  // X-axis labels (show up to 10 labels)
  const xLabels = [];
  const step = Math.max(1, Math.floor(records.length / 10));
  for (let i = 0; i < records.length; i += step) {
    const d = records[i].date.slice(5); // MM-DD
    xLabels.push(`<text x="${toX(i).toFixed(1)}" y="${pad.top + plotH + 20}" fill="#8b949e" text-anchor="middle" font-family="sans-serif" font-size="10" transform="rotate(-30 ${toX(i).toFixed(1)} ${pad.top + plotH + 20})">${d}</text>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="100%" height="100%" rx="8" fill="#0d1117"/>
  <text x="${W/2}" y="24" fill="#e6edf3" text-anchor="middle" font-family="sans-serif" font-size="15" font-weight="600">Downloads Trend</text>
  ${gridLines.join('\n  ')}
  ${xLabels.join('\n  ')}
  ${polyline(records, 'vscode', '#4493f8')}
  ${polyline(records, 'openvsx', '#3fb950')}
  <!-- Legend -->
  <circle cx="${pad.left + 10}" cy="${H - 12}" r="4" fill="#4493f8"/>
  <text x="${pad.left + 18}" y="${H - 8}" fill="#8b949e" font-family="sans-serif" font-size="11">VS Code Marketplace</text>
  <circle cx="${pad.left + 170}" cy="${H - 12}" r="4" fill="#3fb950"/>
  <text x="${pad.left + 178}" y="${H - 8}" fill="#8b949e" font-family="sans-serif" font-size="11">Open VSX (Cursor)</text>
</svg>`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  const [openvsx, vscode] = await Promise.all([fetchOpenVSX(), fetchVSCodeMarketplace()]);
  console.log(`${today} — VS Code: ${vscode}, Open VSX: ${openvsx}`);

  let records = [];
  try { records = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); } catch {}

  // Upsert today's entry
  const existing = records.findIndex((r) => r.date === today);
  const entry = { date: today, vscode, openvsx };
  if (existing >= 0) records[existing] = entry;
  else records.push(entry);

  // Keep last 365 days
  records = records.slice(-365);

  fs.writeFileSync(STATS_FILE, JSON.stringify(records, null, 2) + '\n', 'utf8');
  fs.writeFileSync(CHART_FILE, generateChart(records), 'utf8');
  console.log('Updated stats/downloads.json and stats/downloads-chart.svg');
}

main().catch((e) => { console.error(e); process.exit(1); });
