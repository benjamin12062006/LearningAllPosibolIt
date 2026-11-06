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
  [ErrorCodes.FEED_NOT_FOUND]: entry(
    404,
    'No se encontró el feed.',
    'The feed was not found.',
  ),
  [ErrorCodes.FEED_ALREADY_EXISTS]: entry(
    409,
    'Este proyecto ya tiene un feed.',
    'This project already has a feed.',
  ),
  [ErrorCodes.FEED_GENERATION_CONFLICT]: entry(
    409,
    'El feed cambió desde que lo consultaste: alguien publicó otra versión. Vuelve a consultarlo antes de publicar.',
    'The feed changed since you fetched it: someone published another version. Fetch it again before publishing.',
  ),
  [ErrorCodes.FEED_FILE_UNAVAILABLE]: entry(
    503,
    'El archivo del feed no está disponible en este momento.',
    'The feed file is not available right now.',
  ),
  [ErrorCodes.SOURCE_URL_NOT_ALLOWED]: entry(
    422,
    'La URL de la fuente no está permitida: debe ser https, sin usuario ni contraseña, y apuntar a un servidor público.',
    'The source URL is not allowed: it must use https, have no user or password, and point to a public server.',
  ),
  [ErrorCodes.SOURCE_REDIRECT_NOT_ALLOWED]: entry(
    422,
    'La URL de la fuente redirige a otra dirección. Configura la URL final del archivo.',
    'The source URL redirects to another address. Configure the final URL of the file.',
  ),
  [ErrorCodes.SOURCE_HTTP_ERROR]: entry(
    502,
    'El servidor de la fuente respondió con un error.',
    'The source server responded with an error.',
  ),
  [ErrorCodes.SOURCE_UNREACHABLE]: entry(
    502,
    'No se pudo conectar con el servidor de la fuente.',
    'Could not connect to the source server.',
  ),
  [ErrorCodes.SOURCE_TIMEOUT]: entry(
    504,
    'El servidor de la fuente tardó demasiado en enviar el archivo.',
    'The source server took too long to send the file.',
  ),
  [ErrorCodes.SOURCE_TOO_LARGE]: entry(
    413,
    'El archivo de la fuente supera el tamaño máximo permitido.',
    'The source file exceeds the maximum allowed size.',
  ),
  [ErrorCodes.FEED_SOURCE_NOT_CONFIGURED]: entry(
    409,
    'El feed no tiene fuente: configura antes la URL del CSV.',
    'The feed has no source: configure the CSV URL first.',
  ),
  [ErrorCodes.FEED_REFRESH_ALREADY_ACTIVE]: entry(
    409,
    'El feed ya tiene una actualización en curso.',
    'The feed already has an update in progress.',
  ),
  [ErrorCodes.FEED_REFRESH_NOT_FOUND]: entry(
    404,
    'No se encontró la actualización.',
    'The update was not found.',
  ),
  [ErrorCodes.REFRESH_LEASE_EXPIRED]: entry(
    503,
    'La actualización se interrumpió y se reintentará.',
    'The update was interrupted and will be retried.',
  ),
  [ErrorCodes.REFRESH_SOURCE_MISSING]: entry(
    409,
    'El feed se quedó sin fuente durante la actualización.',
    'The feed lost its source during the update.',
  ),
  [ErrorCodes.REFRESH_POLICY_MISSING]: entry(
    409,
    'El feed se quedó sin política aprobada durante la actualización.',
    'The feed lost its approved policy during the update.',
  ),
  [ErrorCodes.REFRESH_POLICY_VERSIONS_CHANGED]: entry(
    409,
    'Las comprobaciones de Google cambiaron desde que aprobaste la política. Revisa el resultado y vuelve a aprobarla.',
    'The Google checks changed since you approved the policy. Review the result and approve it again.',
  ),
  [ErrorCodes.REFRESH_POLICY_NO_VALID_PRODUCTS]: entry(
    409,
    'La evaluación no tiene productos válidos: no se publica.',
    'The evaluation has no valid products: nothing is published.',
  ),
  [ErrorCodes.REFRESH_POLICY_TOO_MANY_INVALID]: entry(
    409,
    'Hay más productos inválidos de los que permite la política.',
    'There are more invalid products than the policy allows.',
  ),
  [ErrorCodes.REFRESH_POLICY_TOO_MANY_EXCLUDED]: entry(
    409,
    'Hay más productos excluidos de los que permite la política.',
    'There are more excluded products than the policy allows.',
  ),
  [ErrorCodes.REFRESH_POLICY_PRODUCT_DROP]: entry(
    409,
    'El número de productos válidos cayó más de lo que permite la política.',
    'The number of valid products dropped more than the policy allows.',
  ),
  [ErrorCodes.REFRESH_PUBLICATION_CONFLICT]: entry(
    409,
    'Alguien publicó otra versión durante la actualización: no se ha publicado esta.',
    'Someone published another version during the update: this one was not published.',
  ),
  [ErrorCodes.FEED_POLICY_NOT_APPROVED]: entry(
    409,
    'El feed no tiene política aprobada: apruébala antes de actualizarlo.',
    'The feed has no approved policy: approve it before updating.',
  ),
  [ErrorCodes.REFRESH_IMPORT_MISSING]: entry(
    409,
    'La importación de la actualización ya no existe; se volverá a descargar.',
    'The update import no longer exists; it will be downloaded again.',
  ),
  [ErrorCodes.ORGANIZATION_NOT_FOUND]: entry(
    404,
    'Organización no encontrada.',
    'Organization not found.',
  ),
  [ErrorCodes.ORGANIZATION_LAST_OWNER]: entry(
    409,
    'La organización necesita al menos un owner. Da el rol owner a otra persona antes.',
    'The organization needs at least one owner. Give the owner role to someone else first.',
  ),
  [ErrorCodes.ORGANIZATION_PERSONAL_OWNER]: entry(
    409,
    'La persona dueña de una organización personal no puede salir ni perder el rol owner.',
    'The owner of a personal organization cannot leave it or lose the owner role.',
  ),
  [ErrorCodes.MEMBER_NOT_FOUND]: entry(
    404,
    'Esa persona no es miembro de la organización.',
    'That person is not a member of the organization.',
  ),
  [ErrorCodes.MEMBER_ALREADY_EXISTS]: entry(
    409,
    'Esa persona ya es miembro de la organización.',
    'That person is already a member of the organization.',
  ),
  [ErrorCodes.INVITATION_NOT_FOUND]: entry(
    404,
    'La invitación no existe, caducó o ya se usó. Pide una nueva.',
    'The invitation does not exist, has expired, or was already used. Ask for a new one.',
  ),
  [ErrorCodes.INVITATION_EMAIL_MISMATCH]: entry(
    403,
    'La invitación es para otro correo. Entra con el correo invitado.',
    'The invitation is for a different email. Sign in with the invited email.',
  ),
  [ErrorCodes.ORGANIZATION_ARCHIVED]: entry(
    409,
    'La organización está archivada: se puede consultar, pero no cambiar. Restáurala primero.',
    'The organization is archived: it can be viewed but not changed. Restore it first.',
  ),
  [ErrorCodes.ORGANIZATION_PERSONAL_NOT_ARCHIVABLE]: entry(
    409,
    'Una organización personal no se puede archivar.',
    'A personal organization cannot be archived.',
  ),
  [ErrorCodes.TEAM_ORGANIZATIONS_LIMIT]: entry(
    409,
    'Ya eres owner de 10 organizaciones de equipo, el máximo permitido.',
    'You are already the owner of 10 team organizations, the maximum allowed.',
  ),
  [ErrorCodes.ORGANIZATION_SEATS_LIMIT]: entry(
    409,
    'La organización llegó al máximo de 50 personas entre miembros e invitaciones pendientes.',
    'The organization reached the maximum of 50 people between members and pending invitations.',
  ),
  [ErrorCodes.WORKBOOK_NOT_FOUND]: entry(
    404,
    'No se encontró el libro.',
    'The workbook was not found.',
  ),
  [ErrorCodes.WORKSHEET_NOT_FOUND]: entry(
    404,
    'No se encontró la hoja.',
    'The worksheet was not found.',
  ),
  [ErrorCodes.WORKBOOK_NAME_TAKEN]: entry(
    409,
    'Ya hay un libro con ese nombre en el proyecto.',
    'There is already a workbook with that name in the project.',
  ),
  [ErrorCodes.WORKSHEET_NAME_TAKEN]: entry(
    409,
    'Ya hay una hoja con ese nombre en el libro.',
    'There is already a worksheet with that name in the workbook.',
  ),
  [ErrorCodes.WORKSHEET_COLUMN_DUPLICATE]: entry(
    400,
    'Cada columna necesita un nombre distinto. El campo indica cuál se repite.',
    'Each column needs a different name. The field shows which one is repeated.',
  ),
  [ErrorCodes.PROJECT_HAS_WORKBOOKS]: entry(
    409,
    'El proyecto tiene libros con hojas y su historial no se borra. Elimina el proyecto cuando no tenga libros.',
    'The project has workbooks with worksheets, and their history is not deleted. Delete the project once it has no workbooks.',
  ),
  [ErrorCodes.WORKSHEET_REVISION_NOT_FOUND]: entry(
    404,
    'No se encontró esa revisión de la hoja.',
    'That worksheet revision was not found.',
  ),
  [ErrorCodes.WORKSHEET_CURSOR_INVALID]: entry(
    400,
    'El cursor no es válido para esta consulta. Vuelve a pedir la primera página.',
    'The cursor is not valid for this query. Request the first page again.',
  ),
  [ErrorCodes.ROW_FILTER_INVALID]: entry(
    400,
    'El filtro no tiene una forma válida o supera los límites (3 niveles, 20 condiciones). El campo indica dónde.',
    'The filter has an invalid shape or exceeds the limits (3 levels, 20 conditions). The field shows where.',
  ),
  [ErrorCodes.ROW_FILTER_COLUMN_UNKNOWN]: entry(
    400,
    'La columna no existe en esta revisión de la hoja. El campo indica cuál.',
    'The column does not exist in this worksheet revision. The field shows which one.',
  ),
  [ErrorCodes.ROW_FILTER_OPERATOR_INVALID]: entry(
    400,
    'Ese operador no se puede usar con el tipo de la columna. El campo indica dónde.',
    'That operator cannot be used with the column type. The field shows where.',
  ),
  [ErrorCodes.ROW_FILTER_VALUE_INVALID]: entry(
    400,
    'El valor no tiene el formato del tipo de la columna. El campo indica cuál.',
    'The value does not have the format of the column type. The field shows which one.',
  ),
  [ErrorCodes.COLUMN_OPTIONS_INVALID]: entry(
    400,
    'Una columna de selección necesita entre 1 y 100 opciones con etiquetas distintas, y solo ella lleva opciones. El campo indica cuál.',
    'A selection column needs between 1 and 100 options with different labels, and only it can have options. The field shows which one.',
  ),
  [ErrorCodes.COLUMN_FORMULA_INVALID]: entry(
    400,
    'La fórmula no es válida o supera los límites (5 niveles, 25 elementos, escala de 0 a 6), o la columna no es calculada. El campo indica dónde.',
    'The formula is invalid or exceeds the limits (5 levels, 25 elements, scale 0 to 6), or the column is not calculated. The field shows where.',
  ),
  [ErrorCodes.COLUMN_FORMULA_REFERENCE_INVALID]: entry(
    400,
    'La fórmula nombra una columna que no existe o que no es numérica. El campo indica cuál.',
    'The formula names a column that does not exist or is not numeric. The field shows which one.',
  ),
  [ErrorCodes.COLUMN_FORMULA_CYCLE]: entry(
    400,
    'Las fórmulas se usan entre sí en círculo. El campo indica cada columna del ciclo.',
    'The formulas use each other in a loop. The field shows each column in the loop.',
  ),
  [ErrorCodes.CELL_REQUIRED]: entry(
    400,
    'La columna es obligatoria y la celda está vacía.',
    'The column is required and the cell is empty.',
  ),
  [ErrorCodes.CELL_VALUE_INVALID]: entry(
    400,
    'El valor de la celda no tiene el formato de su columna.',
    'The cell value does not have the format of its column.',
  ),
  [ErrorCodes.CALC_DIVISION_BY_ZERO]: entry(
    400,
    'El cálculo divide entre cero: no tiene resultado.',
    'The calculation divides by zero: it has no result.',
  ),
  [ErrorCodes.CALC_INPUT_INVALID]: entry(
    400,
    'El cálculo usa una celda que no tiene un número válido.',
    'The calculation uses a cell that does not have a valid number.',
  ),
  [ErrorCodes.ROW_SORT_UNSUPPORTED]: entry(
    400,
    'Todavía no se puede ordenar por una columna calculada.',
    'Sorting by a calculated column is not available yet.',
  ),
} satisfies Record<ErrorCode, { status: number; message: LocalizedMessage }>;
