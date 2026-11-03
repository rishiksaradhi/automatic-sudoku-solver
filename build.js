const path = require('node:path');
const { spawnSync } = require('node:child_process');

const output = path.join(__dirname, process.platform === 'win32' ? 'solver.exe' : 'solver');
const result = spawnSync(process.env.CC || 'gcc', [
  '-std=c11', '-O0', '-Wall', '-Wextra', '-Wpedantic',
  path.join(__dirname, 'solver.c'), '-o', output
], { stdio: 'inherit', windowsHide: true });

if (result.error) {
  console.error(`Could not run GCC: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  process.exit(result.status || 1);
}
console.log(`Built C solver: ${output}`);
