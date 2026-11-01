import type { AttributeMapping, Rule } from '../evaluations/engine/ruleset.js';

/** Versión guardada: no se modifica; corregir reglas crea la revisión siguiente. */
export type RulesetVersion = Readonly<{
  id: string;
  revision: number;
  mapping: readonly AttributeMapping[];
  rules: readonly Rule[];
  createdAt: string;
}>;
