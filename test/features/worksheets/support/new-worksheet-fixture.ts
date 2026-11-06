import {
  planColumns,
  type ColumnRequest,
} from '../../../../src/worksheets/column-plan.js';
import { buildNewWorksheet } from '../../../../src/worksheets/new-worksheet.js';

/** Lo mismo que hace el servicio al crear una hoja: planificar y construir. */
export function newWorksheet(name: string, columns: readonly ColumnRequest[]) {
  const plan = planColumns(columns);
  if (!plan.ok) {
    throw new Error(
      `Columnas de prueba inválidas: ${JSON.stringify(plan.issues)}`,
    );
  }
  return buildNewWorksheet(name, plan.columns);
}
