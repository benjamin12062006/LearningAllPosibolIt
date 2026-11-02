import { describe, expect, it } from '@jest/globals';
import type { StoredArtifact } from '../../../src/artifacts/artifact.store.js';
import {
  ORPHAN_MIN_AGE_MS,
  removeOrphans,
} from '../../../src/artifacts/remove-orphans.js';

const NOW = 1_000_000_000_000;
const OLD = NOW - ORPHAN_MIN_AGE_MS;
const RECENT = NOW - ORPHAN_MIN_AGE_MS + 1;

/** Carpeta simulada que registra cada llamada en orden. */
function folderWith(stored: StoredArtifact[], referenced: string[]) {
  const calls: unknown[] = [];
  const source = {
    list: async () => {
      calls.push(['list']);
      return stored;
    },
    findReferenced: async (keys: string[]) => {
      calls.push(['findReferenced', keys]);
      return new Set(keys.filter((key) => referenced.includes(key)));
    },
    remove: async (key: string) => {
      calls.push(['remove', key]);
    },
  };
  return { source, calls };
}

describe('removeOrphans', () => {
  it('borra solo los antiguos sin referencia y devuelve cuántos', async () => {
    const { source, calls } = folderWith(
      [
        { key: 'a', modifiedAt: OLD },
        { key: 'b', modifiedAt: OLD - 1 },
        { key: 'c', modifiedAt: RECENT },
        { key: 'd', modifiedAt: OLD },
      ],
      ['a'],
    );

    await expect(removeOrphans(source, NOW)).resolves.toBe(2);
    expect(calls).toEqual([
      ['list'],
      ['findReferenced', ['a', 'b', 'd']],
      ['remove', 'b'],
      ['remove', 'd'],
    ]);
  });

  it('justo en el margen ya cuenta como antiguo', async () => {
    const { source } = folderWith([{ key: 'a', modifiedAt: OLD }], []);

    await expect(removeOrphans(source, NOW)).resolves.toBe(1);
  });

  it('consulta las referencias aunque no haya ninguno antiguo', async () => {
    const { source, calls } = folderWith(
      [{ key: 'c', modifiedAt: RECENT }],
      [],
    );

    await expect(removeOrphans(source, NOW)).resolves.toBe(0);
    expect(calls).toEqual([['list'], ['findReferenced', []]]);
  });

  it('si borrar falla, el error sale y no sigue borrando', async () => {
    const { source, calls } = folderWith(
      [
        { key: 'a', modifiedAt: OLD },
        { key: 'b', modifiedAt: OLD },
      ],
      [],
    );
    const failing = {
      ...source,
      remove: async (key: string) => {
        calls.push(['remove', key]);
        throw new Error('EIO');
      },
    };

    await expect(removeOrphans(failing, NOW)).rejects.toThrow('EIO');
    expect(calls.at(-1)).toEqual(['remove', 'a']);
  });
});
