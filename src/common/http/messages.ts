import { ErrorCodes, type ErrorCode } from './error-codes.js';

// Conserva los imports anteriores; error-codes es el origen canónico.
export { isErrorCode, type ErrorCode } from './error-codes.js';

export type LocalizedMessage = { es: string; en: string };
const entry = (status: number, es: string, en: string) => ({
  status,
  message: { es, en },
});

/** Códigos estables y texto público; nunca contiene causas de proveedores. */
export const API_MESSAGES = {
  [ErrorCodes.BAD_REQUEST]: entry(
    400,
    'La solicitud no es válida.',
    'The request is invalid.',
  ),
  [ErrorCodes.INVALID_JSON]: entry(
    400,
    'El cuerpo debe contener JSON válido.',
    'The body must contain valid JSON.',
  ),
  [ErrorCodes.INVALID_UUID]: entry(
    400,
    'El identificador debe ser un UUID válido.',
    'The identifier must be a valid UUID.',
  ),
  [ErrorCodes.VALIDATION_FAILED]: entry(
    400,
    'Revisa los datos enviados.',
    'Review the submitted data.',
  ),
  [ErrorCodes.BODY_INVALID]: entry(
    400,
    'El cuerpo de la solicitud no es válido.',
    'The request body is invalid.',
  ),
  [ErrorCodes.FIELD_REQUIRED]: entry(
    400,
    'El campo es obligatorio y no puede estar vacío.',
    'The field is required and cannot be empty.',
  ),
  [ErrorCodes.FIELD_NOT_STRING]: entry(
    400,
    'El campo debe ser texto.',
    'The field must be a string.',
  ),
  [ErrorCodes.FIELD_TOO_LONG]: entry(
    400,
    'El campo supera la longitud permitida.',
    'The field exceeds the allowed length.',
  ),
  [ErrorCodes.FIELD_NOT_ALLOWED]: entry(
    400,
    'Este campo no está permitido.',
    'This field is not allowed.',
  ),
  [ErrorCodes.FIELD_UNSUPPORTED]: entry(
    400,
    'El campo contiene un valor no admitido.',
    'The field contains an unsupported value.',
  ),
  [ErrorCodes.FIELD_INVALID]: entry(
    400,
    'El campo no tiene un formato válido.',
    'The field has an invalid format.',
  ),
  [ErrorCodes.COUNTRY_INVALID]: entry(
    400,
    'Selecciona un código de país válido.',
    'Select a valid country code.',
  ),
  [ErrorCodes.CURRENCY_INVALID]: entry(
    400,
    'Selecciona un código de moneda válido.',
    'Select a valid currency code.',
  ),
  [ErrorCodes.CHANNEL_PROFILE_INVALID]: entry(
    400,
    'Selecciona un perfil de canal admitido.',
    'Select a supported channel profile.',
  ),
  [ErrorCodes.DELIMITER_INVALID]: entry(
    400,
    'El delimitador debe ser comma o semicolon.',
    'The delimiter must be comma or semicolon.',
  ),
  [ErrorCodes.ID_COLUMN_INVALID]: entry(
    400,
    'Indica una columna identificadora no vacía.',
    'Provide a non-empty identifier column.',
  ),
  [ErrorCodes.AUTH_SESSION_REQUIRED]: entry(
    401,
    'Se requiere una sesión Bearer válida.',
    'A valid Bearer session is required.',
  ),
  [ErrorCodes.AUTH_SESSION_INVALID]: entry(
    401,
    'La sesión es inválida o ha expirado.',
    'The session is invalid or has expired.',
  ),
  [ErrorCodes.FORBIDDEN]: entry(
    403,
    'No tienes permiso para realizar esta operación.',
    'You do not have permission to perform this operation.',
  ),
  [ErrorCodes.ROUTE_NOT_FOUND]: entry(
    404,
    'La ruta solicitada no existe.',
    'The requested route does not exist.',
  ),
  [ErrorCodes.PROFILE_NOT_FOUND]: entry(
    404,
    'Tu perfil local no existe. Aprovisiónalo primero.',
    'Your local profile does not exist. Provision it first.',
  ),
  [ErrorCodes.PROJECT_NOT_FOUND]: entry(
    404,
    'Proyecto no encontrado.',
    'Project not found.',
  ),
  [ErrorCodes.PROJECT_CONFIGURATION_REQUIRED]: entry(
    409,
    'Completa el país, la moneda y el canal antes de importar.',
    'Complete the country, currency, and channel before importing.',
  ),
  [ErrorCodes.PROJECT_CONFIGURATION_LOCKED]: entry(
    409,
    'La configuración no puede cambiar después de aceptar un snapshot.',
    'Configuration cannot change after a snapshot has been accepted.',
  ),
  [ErrorCodes.PROJECT_CONFIGURATION_INCOMPLETE]: entry(
    400,
    'Envía país, moneda y perfil de canal juntos.',
    'Submit country, currency, and channel profile together.',
  ),
  [ErrorCodes.PROJECT_UPDATE_EMPTY]: entry(
    400,
    'Envía al menos un cambio.',
    'Submit at least one change.',
  ),
  [ErrorCodes.INTERNAL_ERROR]: entry(
    500,
    'Ocurrió un error interno. Inténtalo de nuevo más tarde.',
    'An internal error occurred. Please try again later.',
  ),
  [ErrorCodes.HTTP_ERROR]: entry(
    500,
    'No se pudo completar la solicitud.',
    'The request could not be completed.',
  ),
  [ErrorCodes.PAYLOAD_TOO_LARGE]: entry(
    413,
    'El contenido supera el tamaño permitido.',
    'The content exceeds the allowed size.',
  ),
  [ErrorCodes.UNSUPPORTED_MEDIA_TYPE]: entry(
    415,
    'El tipo de contenido no está admitido.',
    'The content type is not supported.',
  ),
  [ErrorCodes.RATE_LIMITED]: entry(
    429,
    'Se recibieron demasiadas solicitudes. Inténtalo más tarde.',
    'Too many requests were received. Please try again later.',
  ),
  [ErrorCodes.REQUEST_TIMEOUT]: entry(
    408,
    'La solicitud superó el tiempo permitido.',
    'The request exceeded the allowed time.',
  ),
  [ErrorCodes.SERVICE_UNAVAILABLE]: entry(
    503,
    'El servicio no está disponible temporalmente.',
    'The service is temporarily unavailable.',
  ),
  [ErrorCodes.IMPORT_NOT_FOUND]: entry(
    404,
    'No se encontró el recurso de importación.',
    'The import resource was not found.',
  ),
  [ErrorCodes.IMPORT_ALREADY_ACTIVE]: entry(
    409,
    'El proyecto ya tiene una importación en curso. Espera a que termine.',
    'The project already has an import in progress. Wait for it to finish.',
  ),
  [ErrorCodes.IMPORT_IN_PROGRESS]: entry(
    409,
    'No se puede eliminar mientras hay una importación en curso. Espera a que termine.',
    'It cannot be deleted while an import is in progress. Wait for it to finish.',
  ),
  [ErrorCodes.IMPORT_FILE_REQUIRED]: entry(
    400,
    'Envía un único archivo en el campo file.',
    'Submit one file in the file field.',
  ),
  [ErrorCodes.IMPORT_INPUT_INVALID]: entry(
    400,
    'Los campos multipart deben ser escalares, únicos y conocidos.',
    'Multipart fields must be scalar, unique, and recognized.',
  ),
  [ErrorCodes.IMPORT_MULTIPART_INVALID]: entry(
    400,
    'La carga multipart está incompleta o no respeta los campos y límites admitidos.',
    'The multipart upload is incomplete or violates the allowed fields and limits.',
  ),
  [ErrorCodes.IMPORT_FILE_TOO_LARGE]: entry(
    413,
    'El archivo supera 10 MiB.',
    'The file exceeds 10 MiB.',
  ),
  [ErrorCodes.IMPORT_STORAGE_UNAVAILABLE]: entry(
    503,
    'El almacenamiento privado no está disponible temporalmente.',
    'Private storage is temporarily unavailable.',
  ),
  [ErrorCodes.IMPORT_DATABASE_UNAVAILABLE]: entry(
    503,
    'No se pudo aceptar la importación. Inténtalo más tarde.',
    'The import could not be accepted. Please try again later.',
  ),
  [ErrorCodes.IMPORT_ACCEPTANCE_UNCERTAIN]: entry(
    503,
    'No se pudo confirmar la aceptación. Consulta de nuevo más tarde.',
    'Acceptance could not be confirmed. Check again later.',
  ),
  [ErrorCodes.IMPORT_PROCESSING_FAILED]: entry(
    400,
    'La importación no pudo completarse.',
    'The import could not be completed.',
  ),
  [ErrorCodes.IMPORT_INTERRUPTED]: entry(
    400,
    'La importación fue interrumpida antes de terminar.',
    'The import was interrupted before completion.',
  ),
  [ErrorCodes.IMPORT_INTEGRITY_FAILED]: entry(
    400,
    'La importación no pudo confirmar su integridad.',
    'The integrity of the import could not be verified.',
  ),
  [ErrorCodes.IMPORT_ARTIFACT_MISSING]: entry(
    400,
    'El archivo de la importación no está disponible.',
    'The import file is not available.',
  ),
  [ErrorCodes.IMPORT_ARTIFACT_UNAVAILABLE]: entry(
    400,
    'No se pudo leer el archivo privado de la importación.',
    'The private import file could not be read.',
  ),
  [ErrorCodes.IMPORT_ROW_LIMIT]: entry(
    400,
    'El CSV supera 5.000 registros de datos.',
    'The CSV exceeds 5,000 data records.',
  ),
  [ErrorCodes.CSV_INVALID]: entry(
    400,
    'No se pudo interpretar la estructura del CSV.',
    'The CSV structure could not be parsed.',
  ),
  [ErrorCodes.CSV_INVALID_ENCODING]: entry(
    400,
    'El CSV debe estar codificado en UTF-8 válido.',
    'The CSV must use valid UTF-8 encoding.',
  ),
  [ErrorCodes.CSV_HEADERS_INVALID]: entry(
    400,
    'Las cabeceras deben ser únicas, no vacías y respetar los límites.',
    'Headers must be unique, non-empty, and within the allowed limits.',
  ),
  [ErrorCodes.CSV_COLUMN_MISSING]: entry(
    400,
    'La columna identificadora no existe en el CSV.',
    'The identifier column does not exist in the CSV.',
  ),
  [ErrorCodes.CSV_ID_MISSING]: entry(
    400,
    'Una fila no tiene identificador.',
    'A row has no identifier.',
  ),
  [ErrorCodes.CSV_DUPLICATE_ID]: entry(
    400,
    'El CSV contiene un identificador repetido.',
    'The CSV contains a duplicate identifier.',
  ),
  [ErrorCodes.CSV_EMPTY]: entry(
    400,
    'El CSV debe incluir cabeceras y al menos un registro.',
    'The CSV must include headers and at least one data record.',
  ),
  [ErrorCodes.RULESET_NOT_FOUND]: entry(
    404,
    'No se encontró la versión de reglas.',
    'The ruleset version was not found.',
  ),
  [ErrorCodes.RULESET_MAPPING_DUPLICATE]: entry(
    400,
    'Cada atributo del canal solo puede mapearse una vez. El campo indica cuál se repite.',
    'Each channel attribute can be mapped only once. The field shows which one is repeated.',
  ),
  [ErrorCodes.RULESET_REQUIRED_ATTRIBUTE_MISSING]: entry(
    400,
    'Falta un atributo obligatorio del canal: mapéalo o genéralo con una regla. El campo indica cuál.',
    'A required channel attribute is missing: map it or produce it with a rule. The field shows which one.',
  ),
  [ErrorCodes.RULESET_REFERENCE_INVALID]: entry(
    400,
    'La regla usa un atributo que no está mapeado ni lo produce una regla anterior. El campo indica la regla y el atributo.',
    'The rule uses an attribute that is neither mapped nor produced by an earlier rule. The field shows the rule and the attribute.',
  ),
  [ErrorCodes.RULESET_REVISION_CONFLICT]: entry(
    409,
    'Otra versión de reglas se guardó al mismo tiempo. Vuelve a intentarlo.',
    'Another ruleset version was saved at the same time. Try again.',
  ),
  [ErrorCodes.EVALUATION_NOT_FOUND]: entry(
    404,
    'No se encontró la evaluación.',
    'The evaluation was not found.',
  ),
  [ErrorCodes.EVALUATION_SNAPSHOT_NOT_READY]: entry(
    409,
    'La importación todavía no está lista para evaluarse.',
    'The import is not ready to be evaluated yet.',
  ),
  [ErrorCodes.EVALUATION_COLUMN_MISSING]: entry(
    409,
    'El mapeo usa columnas que no existen en esta importación. Los campos indican qué atributos están afectados.',
    'The mapping uses columns that do not exist in this import. The fields show which attributes are affected.',
  ),
  [ErrorCodes.EVALUATION_ALREADY_ACTIVE]: entry(
    409,
    'El proyecto ya tiene una evaluación en curso. Espera a que termine.',
    'The project already has an evaluation in progress. Wait for it to finish.',
  ),
  [ErrorCodes.EVALUATION_IN_PROGRESS]: entry(
    409,
    'No se puede eliminar mientras hay una evaluación en curso. Espera a que termine.',
    'It cannot be deleted while an evaluation is in progress. Wait for it to finish.',
  ),
  [ErrorCodes.EVALUATION_PROCESSING_FAILED]: entry(
    400,
    'La evaluación no pudo completarse.',
    'The evaluation could not be completed.',
  ),
  [ErrorCodes.EVALUATION_INTERRUPTED]: entry(
    400,
    'La evaluación fue interrumpida antes de terminar.',
    'The evaluation was interrupted before completion.',
  ),
  [ErrorCodes.EVALUATION_INTEGRITY_FAILED]: entry(
    400,
    'La evaluación no pudo confirmar que sus resultados estén completos.',
    'The evaluation could not verify that its results are complete.',
  ),
  [ErrorCodes.EVALUATION_RESULTS_UNAVAILABLE]: entry(
    409,
    'La evaluación no tiene resultados: todavía no terminó o falló.',
    'The evaluation has no results: it has not finished yet or it failed.',
  ),
  [ErrorCodes.EXPORT_NOT_FOUND]: entry(
    404,
    'No se encontró la exportación.',
    'The export was not found.',
  ),
  [ErrorCodes.EXPORT_NO_VALID_PRODUCTS]: entry(
    409,
    'La evaluación no tiene productos válidos: corrige el catálogo o las reglas y vuelve a evaluar.',
    'The evaluation has no valid products: fix the catalog or the rules and evaluate again.',
  ),
  [ErrorCodes.EXPORT_APPROVAL_MISMATCH]: entry(
    409,
    'La aprobación no coincide con la evaluación guardada. Vuelve a consultar la evaluación y revisa sus resultados.',
    'The approval does not match the stored evaluation. Fetch the evaluation again and review its results.',
  ),
  [ErrorCodes.EXPORT_EVALUATION_OUTDATED]: entry(
    409,
    'La evaluación se hizo con una versión anterior de las comprobaciones de Google. Vuelve a evaluar el catálogo.',
    'The evaluation used an earlier version of the Google checks. Evaluate the catalog again.',
  ),
  [ErrorCodes.EXPORT_EVALUATION_SUPERSEDED]: entry(
    409,
    'Hay una evaluación más reciente en este proyecto. Revisa y exporta esa.',
    'There is a more recent evaluation in this project. Review and export that one.',
  ),
  [ErrorCodes.EXPORT_FILE_UNAVAILABLE]: entry(
    503,
    'El archivo de la exportación no está disponible en este momento.',
    'The export file is not available right now.',
  ),
} satisfies Record<ErrorCode, { status: number; message: LocalizedMessage }>;
