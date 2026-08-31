'use strict';

// Captures a route at all four breakpoints using headless Chrome.
// Usage: node scripts/ui-shots.js <outdir> <route...>
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const WIDTHS = [480, 768, 1200, 1800];

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
].filter(Boolean);

function findChrome() {
  const found = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`Chrome not found. Set CHROME_PATH. Tried:\n  ${CHROME_CANDIDATES.join('\n  ')}`);
  }
  return found;
}

function slug(route) {
  return route.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-') || 'root';
}

function main() {
  const [outDir, ...routes] = process.argv.slice(2);
  if (!outDir || !routes.length) {
    console.error('Usage: ui-shots.js <outdir> <route...>');
    process.exit(2);
  }
  const chrome = findChrome();
  fs.mkdirSync(outDir, { recursive: true });

  for (const route of routes) {
    for (const width of WIDTHS) {
      const out = path.join(outDir, `${slug(route)}@${width}.png`);
      execFileSync(chrome, [
        '--headless',
        '--disable-gpu',
        '--hide-scrollbars',
        `--screenshot=${out}`,
        `--window-size=${width},1400`,
        `${BASE}${route}`,
      ], { stdio: 'ignore' });
      console.log(`shot  ${route}  ${width}px  ->  ${out}`);
    }
  }
  console.log(`\n${routes.length * WIDTHS.length} screenshots written to ${outDir}`);
}

main();
