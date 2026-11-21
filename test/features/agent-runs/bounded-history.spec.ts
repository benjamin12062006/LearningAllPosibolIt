import { describe, expect, it } from '@jest/globals';
import {
  boundedHistory,
  type HistoryMessage,
} from '../../../src/agent-runs/agent-runs.repository.js';
import { AGENT_RUN_LIMITS } from '../../../src/agent-runs/agent-runs.types.js';

const QUARTER = AGENT_RUN_LIMITS.historyBytes / 4;

describe('E2: el historial se recorta por bytes', () => {
  it('cuenta la actividad de cada respuesta y deja fuera lo más viejo', () => {
    const activity = {
      calls: [
        {
          operation: 'query_rows',
          status: 'succeeded',
          target: { note: 'a'.repeat(QUARTER) },
        },
      ],
      proposal: null,
    };
    const messages: HistoryMessage[] = [
      { role: 'user', content: 'viejo' },
      { role: 'assistant', content: 'b'.repeat(QUARTER), activity },
      { role: 'user', content: 'c'.repeat(QUARTER) },
      { role: 'assistant', content: 'nuevo', activity },
    ];

    const kept = boundedHistory(messages);

    // Sin contar la actividad cabrían los cuatro (unos 3/4 del límite).
    expect(kept.map((message) => message.content.slice(0, 5))).toEqual([
      'ccccc',
      'nuevo',
    ]);
    expect(kept[1].activity).toBe(activity);
  });
});
