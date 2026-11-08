import { describe, expect, it } from '@jest/globals';
import type {
  CellLiteral,
  ValueRules,
} from '../../../src/worksheets/cell-values.js';
import { convertValue } from '../../../src/worksheets/cell-conversion.js';

const TEXT: ValueRules = { type: 'text' };
const INTEGER: ValueRules = { type: 'integer' };
const DECIMAL: ValueRules = { type: 'decimal' };
const DATE: ValueRules = { type: 'date' };
const BOOLEAN: ValueRules = { type: 'boolean' };
const STATE: ValueRules = {
  type: 'selection',
  options: [
    { id: '00000000-0000-4000-8000-0000000000a1', label: 'Nuevo' },
    { id: '00000000-0000-4000-8000-0000000000a2', label: '12' },
    { id: '00000000-0000-4000-8000-0000000000a3', label: 'true' },
  ],
};
const NEW = '00000000-0000-4000-8000-0000000000a1';
const TWELVE = '00000000-0000-4000-8000-0000000000a2';
const TRUE_OPTION = '00000000-0000-4000-8000-0000000000a3';

const value = (converted: CellLiteral) => ({ kind: 'value', value: converted });
const INCOMPATIBLE = { kind: 'incompatible' };

describe('convertValue: cambiar el tipo sin truncar, redondear ni borrar (C5, ficha 02)', () => {
  it.each([
    ['texto → entero', TEXT, INTEGER, '007', value('007')],
    ['texto → entero con espacios', TEXT, INTEGER, ' 7', INCOMPATIBLE],
    ['texto → decimal', TEXT, DECIMAL, '-10.50', value('-10.50')],
    ['texto → decimal con coma', TEXT, DECIMAL, '10,50', INCOMPATIBLE],
    ['texto → fecha', TEXT, DATE, '2026-02-28', value('2026-02-28')],
    ['texto → fecha que no existe', TEXT, DATE, '2026-02-30', INCOMPATIBLE],
    ['texto → booleano', TEXT, BOOLEAN, 'false', value(false)],
    ['texto → booleano en otro idioma', TEXT, BOOLEAN, 'sí', INCOMPATIBLE],
    ['texto → selección por etiqueta', TEXT, STATE, 'Nuevo', value(NEW)],
    ['texto → selección sin esa etiqueta', TEXT, STATE, 'nuevo', INCOMPATIBLE],
    ['texto vacío → entero', TEXT, INTEGER, '', INCOMPATIBLE],
    ['entero → decimal', INTEGER, DECIMAL, '-5', value('-5')],
    ['entero → texto', INTEGER, TEXT, '-5', value('-5')],
    ['entero → selección', INTEGER, STATE, '12', value(TWELVE)],
    ['entero → fecha', INTEGER, DATE, '20260101', INCOMPATIBLE],
    ['entero → booleano', INTEGER, BOOLEAN, '1', INCOMPATIBLE],
    ['decimal sin decimales → entero', DECIMAL, INTEGER, '10.00', value('10')],
    ['decimal → entero no redondea', DECIMAL, INTEGER, '10.50', INCOMPATIBLE],
    ['decimal entero → entero', DECIMAL, INTEGER, '10', value('10')],
    ['fecha → texto', DATE, TEXT, '1899-12-31', value('1899-12-31')],
    ['fecha → entero', DATE, INTEGER, '2026-01-01', INCOMPATIBLE],
    ['booleano → texto', BOOLEAN, TEXT, true, value('true')],
    ['booleano → selección', BOOLEAN, STATE, true, value(TRUE_OPTION)],
    ['booleano → entero', BOOLEAN, INTEGER, true, INCOMPATIBLE],
    ['selección → texto', STATE, TEXT, NEW, value('Nuevo')],
    ['selección → entero', STATE, INTEGER, TWELVE, value('12')],
    ['selección → booleano', STATE, BOOLEAN, TRUE_OPTION, value(true)],
    ['selección → decimal no numérico', STATE, DECIMAL, NEW, INCOMPATIBLE],
  ])('%s', (_case, from, to, stored, expected) => {
    expect(convertValue(from, to, stored)).toEqual(expected);
  });

  it('un valor guardado que no tenía la forma de su columna es incompatible', () => {
    expect(convertValue(INTEGER, TEXT, '1.5')).toEqual(INCOMPATIBLE);
    expect(convertValue(STATE, TEXT, 'opción-borrada')).toEqual(INCOMPATIBLE);
  });

  it('un texto de más de 8 KiB no cabe en ninguna columna de texto', () => {
    expect(convertValue({ type: 'integer' }, TEXT, '1'.repeat(8193))).toEqual(
      INCOMPATIBLE,
    );
  });
});
