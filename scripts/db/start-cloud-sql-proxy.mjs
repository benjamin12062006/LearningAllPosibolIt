import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

const host = '127.0.0.1';
const port = 5432;
const proxy = '/opt/homebrew/bin/cloud-sql-proxy';
const instance = 'expo-city-bol:us-east4:expo-city-bol-instance';

function portIsOpen() {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });

    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });

    socket.once('error', () => resolve(false));
    socket.setTimeout(800, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

for (let attempt = 0; attempt < 20; attempt += 1) {
  if (await portIsOpen()) {
    console.log(`Ya hay un servicio escuchando en ${host}:${port}.`);
    process.exit(0);
  }

  if (attempt === 0) {
    const logsDir = join(homedir(), 'Library', 'Logs');
    mkdirSync(logsDir, { recursive: true });

    const log = openSync(
      join(logsDir, 'expo-city-bol-cloud-sql-proxy.log'),
      'a',
    );

    const processProxy = spawn(
      proxy,
      ['--address=127.0.0.1', '--port=5432', instance],
      {
        detached: true,
        stdio: ['ignore', log, log],
      },
    );

    processProxy.unref();
  }

  await new Promise((resolve) => setTimeout(resolve, 500));
}

console.error('El proxy no quedó disponible. Revisa el log:');
console.error('~/Library/Logs/expo-city-bol-cloud-sql-proxy.log');
process.exit(1);
