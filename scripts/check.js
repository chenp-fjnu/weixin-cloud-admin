/* 语法检查：node --check 全部 10 个 JS（ESM 文件按 .mjs 校验，避免 import/export 误报）
   用法：node scripts/check.js */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const files = [
  'server.js',
  'scripts/mock-cloudbase.js',
  'scripts/e2e.js',
  'public/js/common.js',
  'public/js/overview.js',
  'public/js/db.js',
  'public/js/storage.js',
  'public/js/functions.js',
  'public/js/settings.js',
  'public/js/main.js'
];

let fail = 0;
for (const rel of files) {
  const abs = path.join(root, rel);
  const tmp = path.join(os.tmpdir(), 'check-' + process.pid + '-' + rel.replace(/[\\/]/g, '_') + '.mjs');
  fs.copyFileSync(abs, tmp);
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    console.log('OK   ' + rel);
  } catch (e) {
    fail++;
    console.error('FAIL ' + rel);
    console.error(String(e.stderr || e.message));
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
  }
}
if (fail) { console.error(fail + ' 个文件语法检查未通过'); process.exit(1); }
console.log('全部通过（' + files.length + ' 个文件）');
