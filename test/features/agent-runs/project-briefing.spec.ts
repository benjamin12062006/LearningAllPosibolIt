import { describe, expect, it } from '@jest/globals';
import { ProjectBriefing } from '../../../src/agent-runs/project-briefing.js';
import type { RunningRun } from '../../../src/agent-runs/agent-runs.types.js';

describe('E3: la ficha del proyecto', () => {
  it('si no se puede armar, la ejecución sigue sin ella', async () => {
    const briefing = new ProjectBriefing(
      {} as never,
      {} as never,
      { find: () => undefined } as never,
    );

    const result = await briefing.of({ id: 'run-1' } as RunningRun);

    expect(result).toBeNull();
  });
});
