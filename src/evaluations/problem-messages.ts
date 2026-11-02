import type { LocalizedMessage } from '../common/http/messages.js';
import {
  isProductAttribute,
  MAX_LENGTHS,
  type ProblemAttribute,
  type ProblemCode,
  type RowProblem,
} from './engine/google-merchant.profile.js';

export const LANGUAGES = ['es', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Un problema del motor con su descripción y la corrección sugerida, en los dos idiomas. */
export type ProblemView = RowProblem &
  Readonly<{ problem: LocalizedMessage; suggestion: LocalizedMessage }>;

type ProblemText = Readonly<{
  problem: LocalizedMessage;
  suggestion: (attribute: ProblemAttribute) => LocalizedMessage;
}>;

/**
 * Textos del informe (D6, D10). El motor solo devuelve códigos para no depender
 * del idioma. Las sugerencias no repiten el valor del catálogo, para no copiar
 * datos ajenos en `errores.csv`.
 */
const PROBLEM_TEXTS: Record<ProblemCode, ProblemText> = {
  FIELD_MISSING: {
    problem: {
      es: 'Falta un valor obligatorio para Google.',
      en: 'A value required by Google is missing.',
    },
    suggestion: () => ({
      es: 'Completa el valor en el catálogo o mapea otra columna.',
      en: 'Fill in the value in the catalog or map another column.',
    }),
  },
  TEXT_TOO_LONG: {
    problem: {
      es: 'El texto supera el máximo de caracteres de Google.',
      en: 'The text exceeds the maximum length allowed by Google.',
    },
    suggestion: (attribute) => {
      const max = maxLengthOf(attribute);
      return {
        es: `Acórtalo a ${max} caracteres como máximo.`,
        en: `Shorten it to at most ${max} characters.`,
      };
    },
  },
  TEXT_HAS_LINE_BREAK: {
    problem: {
      es: 'El texto tiene un tabulador o un salto de línea, que no caben en el archivo para Google.',
      en: 'The text contains a tab or a line break, which the Google file cannot hold.',
    },
    suggestion: (attribute) => {
      // Ninguna regla cambia el id (invariante 2 de docs-diagrams/06).
      if (attribute === 'id') {
        return {
          es: 'Corrige el identificador en el catálogo y vuelve a importarlo.',
          en: 'Fix the identifier in the catalog and import it again.',
        };
      }
      // `clean_text` colapsa tabuladores y saltos de línea en un espacio.
      return {
        es: 'Aplica la regla clean_text a este atributo o quita los saltos de línea en el catálogo.',
        en: 'Apply the clean_text rule to this attribute or remove the line breaks in the catalog.',
      };
    },
  },
  TEXT_STARTS_WITH_QUOTE: {
    problem: {
      es: 'El texto empieza por comillas dobles, que Google puede leer como el inicio de un campo entre comillas.',
      en: 'The text starts with a double quote, which Google may read as the start of a quoted field.',
    },
    suggestion: () => ({
      es: 'Quita las comillas del principio del valor en el catálogo.',
      en: 'Remove the leading quote from the value in the catalog.',
    }),
  },
  URL_INVALID: {
    problem: {
      es: 'No es una URL http o https válida.',
      en: 'It is not a valid http or https URL.',
    },
    suggestion: () => ({
      es: 'Usa una URL completa que empiece por https:// y sin espacios.',
      en: 'Use a full URL that starts with https:// and has no spaces.',
    }),
  },
  AVAILABILITY_INVALID: {
    problem: {
      es: 'Valor de disponibilidad no admitido.',
      en: 'Unsupported availability value.',
    },
    suggestion: () => ({
      es: 'Usa in_stock u out_of_stock.',
      en: 'Use in_stock or out_of_stock.',
    }),
  },
  AVAILABILITY_DATE_REQUIRED: {
    problem: {
      es: 'preorder y backorder exigen una fecha de disponibilidad que esta versión no admite.',
      en: 'preorder and backorder require an availability date that this version does not support.',
    },
    suggestion: () => ({
      es: 'Usa in_stock u out_of_stock.',
      en: 'Use in_stock or out_of_stock.',
    }),
  },
  CONDITION_INVALID: {
    problem: {
      es: 'Estado del producto no admitido.',
      en: 'Unsupported product condition.',
    },
    suggestion: () => ({
      es: 'Usa new, refurbished o used, o deja el valor vacío.',
      en: 'Use new, refurbished or used, or leave it empty.',
    }),
  },
  PRICE_FORMAT_INVALID: {
    problem: {
      es: 'El precio no tiene un formato admitido.',
      en: 'The price format is not supported.',
    },
    suggestion: () => ({
      es: 'Escribe el precio con punto decimal y sin separador de miles ni símbolo, por ejemplo 1234.50.',
      en: 'Write the price with a decimal point and no thousands separator or symbol, for example 1234.50.',
    }),
  },
  PRICE_CURRENCY_MISMATCH: {
    problem: {
      es: 'La moneda del precio no es la del proyecto.',
      en: 'The price currency is not the project currency.',
    },
    suggestion: () => ({
      es: 'Quita la moneda del valor o usa la moneda del proyecto.',
      en: 'Remove the currency from the value or use the project currency.',
    }),
  },
  PRICE_ZERO: {
    problem: {
      es: 'El precio no puede ser cero.',
      en: 'The price cannot be zero.',
    },
    suggestion: () => ({
      es: 'Indica el precio real del producto.',
      en: 'Enter the actual product price.',
    }),
  },
};

/** Comprueba un problema leído de `jsonb` (F25): atributo y código conocidos. */
export function isRowProblem(value: unknown): value is RowProblem {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('attribute' in value) ||
    !('code' in value)
  ) {
    return false;
  }
  const { attribute, code } = value;
  return (
    typeof attribute === 'string' &&
    (attribute === 'id' || isProductAttribute(attribute)) &&
    typeof code === 'string' &&
    Object.hasOwn(PROBLEM_TEXTS, code)
  );
}

export function describeProblem(problem: RowProblem): ProblemView {
  const text = PROBLEM_TEXTS[problem.code];
  return {
    ...problem,
    problem: text.problem,
    suggestion: text.suggestion(problem.attribute),
  };
}

/** `TEXT_TOO_LONG` solo se da en los atributos con máximo (`MAX_LENGTHS`). */
function maxLengthOf(attribute: ProblemAttribute): number | string {
  switch (attribute) {
    case 'id':
    case 'title':
    case 'description':
    case 'brand':
      return MAX_LENGTHS[attribute];
    default:
      return '?';
  }
}
