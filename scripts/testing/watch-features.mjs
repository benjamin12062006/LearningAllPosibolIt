import { spawn } from 'node:child_process';

const children = [
  spawn(
    process.execPath,
    [
      'node_modules/typescript/bin/tsc',
      '-p',
      'tsconfig.features.json',
      '--watch',
    ],
    { stdio: 'inherit' },
  ),
  spawn(
    process.execPath,
    [
      '--experimental-vm-modules',
      'node_modules/jest/bin/jest.js',
      '--config',
      'jest.features.config.mjs',
      '--runInBand',
      '--watchAll',
    ],
    { stdio: 'inherit' },
  ),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
for (const child of children) {
  child.on('error', (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on('exit', (code) => {
    if (!stopping) stop(code ?? 1);
  });
}
