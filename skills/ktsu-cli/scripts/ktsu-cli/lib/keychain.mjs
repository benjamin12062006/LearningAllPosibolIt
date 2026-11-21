import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { CliError } from './http.mjs';

const SERVICE = 'ktsu-cli-oauth';

export function keychainFor(base, project) {
  const account = createHash('sha256')
    .update(`${base}\n${project}`)
    .digest('hex');
  if (process.platform === 'darwin') return macKeychain(account);
  if (process.platform === 'linux') return linuxKeychain(account);
  throw new CliError(
    'Para OAuth usa el llavero de macOS o Secret Service en Linux. Para scripts usa KTSU_TOKEN o --token-stdin.',
  );
}

const MAC_CHUNK_SIZE = 3000;
const MAC_MAX_CHUNKS = 10;

function macKeychain(account) {
  const security = '/usr/bin/security';
  const recordArgs = (item) => ['-s', SERVICE, '-a', item];
  const chunkAccount = (revision, index) => `${account}-${revision}-${index}`;

  async function find(item) {
    const result = await run(security, [
      'find-generic-password',
      ...recordArgs(item),
      '-w',
    ]);
    if (result.code === 44) return null;
    return requireSuccess(result).stdout;
  }

  async function save(item, value) {
    // security -i lee comandos por stdin y limita su longitud a 4 KiB.
    const command = `add-generic-password -U -s ${SERVICE} -a ${item} -w ${value}\n`;
    requireSuccess(await run(security, ['-i'], command));
    if ((await find(item)) !== value) throw keychainError();
  }

  async function removeItem(item) {
    const result = await run(security, [
      'delete-generic-password',
      ...recordArgs(item),
    ]);
    if (result.code !== 44) requireSuccess(result);
  }

  function chunkAccounts(index) {
    return Array.from({ length: index.count }, (_, offset) =>
      chunkAccount(index.revision, offset),
    );
  }

  async function clearChunks(index) {
    if (index) await Promise.allSettled(chunkAccounts(index).map(removeItem));
  }

  return {
    async read() {
      for (let attempt = 0; attempt < 3; attempt++) {
        const entry = await find(account);
        if (!entry) return null;
        const index = macIndex(entry);
        const chunks = await Promise.all(chunkAccounts(index).map(find));
        if (chunks.every((chunk) => chunk !== null))
          return decode(chunks.join(''));
        if ((await find(account)) === entry) break;
      }
      throw keychainError();
    },
    async write(session) {
      const previousEntry = await find(account);
      const previous = previousEntry ? macIndex(previousEntry) : null;
      const encoded = encode(session);
      const chunks =
        encoded.match(new RegExp(`.{1,${MAC_CHUNK_SIZE}}`, 'gu')) ?? [];
      const index = { revision: randomUUID(), count: chunks.length };
      if (chunks.length < 1 || chunks.length > MAC_MAX_CHUNKS)
        throw keychainError();
      try {
        const accounts = chunkAccounts(index);
        // Publicar el índice al final conserva la sesión anterior si falla la escritura.
        for (let offset = 0; offset < chunks.length; offset++) {
          await save(accounts[offset], chunks[offset]);
        }
        await save(account, encode(index));
      } catch (error) {
        if ((await find(account)) !== encode(index)) await clearChunks(index);
        throw error;
      }
      await clearChunks(previous);
    },
    async remove() {
      const entry = await find(account);
      if (!entry) return;
      const index = macIndex(entry);
      await removeItem(account);
      await clearChunks(index);
    },
  };
}

function macIndex(entry) {
  const index = decode(entry);
  if (
    !index ||
    typeof index.revision !== 'string' ||
    !/^[a-f0-9-]{36}$/u.test(index.revision) ||
    !Number.isSafeInteger(index.count) ||
    index.count < 1 ||
    index.count > MAC_MAX_CHUNKS
  ) {
    throw keychainError();
  }
  return index;
}

function linuxKeychain(account) {
  const args = ['service', SERVICE, 'account', account];
  return {
    async read() {
      const result = await run('secret-tool', ['lookup', ...args]);
      if (result.code === 1 && !result.stderr) return null;
      return decode(requireSuccess(result).stdout);
    },
    async write(session) {
      requireSuccess(
        await run(
          'secret-tool',
          ['store', '--label=KTSU CLI', ...args],
          encode(session),
        ),
      );
    },
    async remove() {
      const result = await run('secret-tool', ['clear', ...args]);
      if (result.code !== 1 || result.stderr) requireSuccess(result);
    },
  };
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decode(value) {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw keychainError();
  }
}

function requireSuccess(result) {
  if (result.code !== 0) throw keychainError();
  return result;
}

function keychainError() {
  return new CliError(
    'No se pudo usar el llavero del sistema. Desbloquéalo o usa una credencial de proyecto.',
  );
}

function run(command, args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: process.platform === 'darwin',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 45_000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (piece) => {
      stdout += piece;
    });
    child.stderr.setEncoding('utf8').on('data', (piece) => {
      stderr += piece;
    });
    child.on('error', () => reject(keychainError()));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    child.on('close', (code) =>
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }),
    );
  });
}
