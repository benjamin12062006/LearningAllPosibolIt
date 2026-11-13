import { describe, expect, it } from '@jest/globals';
import type {
  CurrentSource,
  SyncedSource,
} from '../../../src/knowledge/knowledge.types.js';
import { planSync } from '../../../src/knowledge/sync-plan.js';

const ORG = 'org-1';

function current(
  projectId: string,
  sourceType: CurrentSource['sourceType'],
  fingerprint: string,
): CurrentSource {
  return {
    organizationId: ORG,
    projectId,
    sourceType,
    sourceId: projectId,
    fingerprint,
  };
}

function synced(source: CurrentSource): SyncedSource {
  return { ...source, syncedAt: '2026-11-09T10:00:00.000Z' };
}

describe('planSync', () => {
  it('sin nada mandado, manda todo', () => {
    const sources = [
      current('p1', 'project', 'a'),
      current('p1', 'catalog', 'b'),
    ];

    expect(planSync(sources, [])).toEqual({
      changed: sources,
      removed: [],
      removedProjects: [],
    });
  });

  it('solo manda lo que cambió de huella', () => {
    const project = current('p1', 'project', 'a');
    const catalog = current('p1', 'catalog', 'b');

    const plan = planSync(
      [project, { ...catalog, fingerprint: 'b2' }],
      [synced(project), synced(catalog)],
    );

    expect(plan.changed).toEqual([{ ...catalog, fingerprint: 'b2' }]);
    expect(plan.removed).toEqual([]);
  });

  it('una fuente que desaparece de un proyecto que sigue se borra sola', () => {
    const project = current('p1', 'project', 'a');
    const feed = current('p1', 'feed', 'f');

    const plan = planSync([project], [synced(project), synced(feed)]);

    expect(plan.removed).toEqual([synced(feed)]);
    expect(plan.removedProjects).toEqual([]);
  });

  it('un proyecto sin ninguna fuente actual está borrado: se quita entero, una vez', () => {
    const p1 = current('p1', 'project', 'a');
    const gone = [current('p2', 'project', 'x'), current('p2', 'catalog', 'y')];

    const plan = planSync([p1], [synced(p1), ...gone.map(synced)]);

    expect(plan.removedProjects).toEqual([
      { organizationId: ORG, projectId: 'p2' },
    ]);
    expect(plan.removed).toEqual([]);
    expect(plan.changed).toEqual([]);
  });

  it('distingue el mismo tipo en proyectos distintos', () => {
    const plan = planSync(
      [current('p1', 'catalog', 'same'), current('p2', 'catalog', 'same')],
      [synced(current('p1', 'catalog', 'same'))],
    );

    expect(plan.changed.map((source) => source.projectId)).toEqual(['p2']);
  });
});
