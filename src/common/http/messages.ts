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
  [ErrorCodes.OPERATION_INVALID]: entry(
    400,
    'La operación no tiene una forma válida o no se puede hacer en esta fila. El campo indica cuál.',
    'The operation has an invalid shape or cannot be done on this row. The field shows which one.',
  ),
  [ErrorCodes.OPERATION_ROW_UNKNOWN]: entry(
    400,
    'La fila no existe en la revisión base del borrador. El campo indica cuál.',
    'The row does not exist in the base revision of the draft. The field shows which one.',
  ),
  [ErrorCodes.OPERATION_ROW_EXISTS]: entry(
    400,
    'Ya existe una fila con ese ID. El campo indica cuál.',
    'A row with that ID already exists. The field shows which one.',
  ),
  [ErrorCodes.OPERATION_COLUMN_UNKNOWN]: entry(
    400,
    'La columna no existe en la hoja. El campo indica cuál.',
    'The column does not exist in the worksheet. The field shows which one.',
  ),
  [ErrorCodes.OPERATION_VALUE_INVALID]: entry(
    400,
    'El valor no tiene el formato de su columna o la columna es calculada. El campo indica cuál.',
    'The value does not have the format of its column, or the column is calculated. The field shows which one.',
  ),
  [ErrorCodes.CHANGESET_NOT_FOUND]: entry(
    404,
    'No se encontró el borrador.',
    'The draft was not found.',
  ),
  [ErrorCodes.CHANGESET_VERSION_REQUIRED]: entry(
    428,
    'Envía la versión del borrador que estás editando en la cabecera If-Match.',
    'Send the version of the draft you are editing in the If-Match header.',
  ),
  [ErrorCodes.CHANGESET_VERSION_MISMATCH]: entry(
    412,
    'El borrador cambió desde que lo abriste. Vuelve a cargarlo antes de guardar.',
    'The draft changed since you opened it. Reload it before saving.',
  ),
  [ErrorCodes.CHANGESET_STATE_INVALID]: entry(
    409,
    'El borrador no está en un estado que permita esta acción.',
    'The draft is not in a state that allows this action.',
  ),
  [ErrorCodes.CHANGESET_BASE_OUTDATED]: entry(
    409,
    'La hoja cambió desde que empezó el borrador. Actualízalo sobre la revisión actual (rebase).',
    'The worksheet changed since the draft started. Update it onto the current revision (rebase).',
  ),
  [ErrorCodes.CHANGESET_STALE]: entry(
    409,
    'Lo que revisaste ya no coincide con el borrador o con la hoja. Vuelve a revisarlo.',
    'What you reviewed no longer matches the draft or the worksheet. Review it again.',
  ),
  [ErrorCodes.CHANGESET_SELF_APPROVAL]: entry(
    403,
    'No puedes aprobar tu propio borrador: hace falta otra persona con permiso.',
    'You cannot approve your own draft: another person with permission is needed.',
  ),
  [ErrorCodes.CHANGESET_CONFLICTS]: entry(
    409,
    'Hay conflictos sin resolver. Elige qué valor se queda en cada uno.',
    'There are unresolved conflicts. Choose which value stays in each one.',
  ),
  [ErrorCodes.WORKSHEET_HEAD_CHANGED]: entry(
    409,
    'La hoja cambió después de aprobar el borrador. No se aplicó nada; resuelve el conflicto y vuelve a revisarlo.',
    'The worksheet changed after the draft was approved. Nothing was applied; resolve the conflict and review it again.',
  ),
  [ErrorCodes.IDEMPOTENCY_KEY_REQUIRED]: entry(
    400,
    'Envía una cabecera Idempotency-Key para poder reintentar sin repetir el cambio.',
    'Send an Idempotency-Key header so the request can be retried without repeating the change.',
  ),
  [ErrorCodes.IDEMPOTENCY_KEY_REUSED]: entry(
    422,
    'Esa Idempotency-Key ya se usó con otra petición. Usa una clave nueva.',
    'That Idempotency-Key was already used with a different request. Use a new key.',
  ),
  [ErrorCodes.REVERT_NOTHING_TO_UNDO]: entry(
    409,
    'No hay nada que deshacer: la hoja ya no tiene los cambios de esa revisión.',
    'There is nothing to undo: the worksheet no longer has the changes from that revision.',
  ),
  [ErrorCodes.OPERATION_COLUMN_EXISTS]: entry(
    400,
    'Ya existe una columna con ese ID. El campo indica cuál.',
    'A column with that ID already exists. The field shows which one.',
  ),
  [ErrorCodes.COLUMN_IN_USE]: entry(
    400,
    'Una columna calculada usa esta columna: cambia o borra antes esa fórmula. El campo indica cuál.',
    'A calculated column uses this column: change or delete that formula first. The field shows which one.',
  ),
  [ErrorCodes.WORKSHEET_IMPORT_NOT_FOUND]: entry(
    404,
    'No se encontró la importación.',
    'The import was not found.',
  ),
  [ErrorCodes.IMPORT_OPTIONS_INVALID]: entry(
    400,
    'Las opciones de la importación no son válidas. El campo indica cuál.',
    'The import options are not valid. The field shows which one.',
  ),
  [ErrorCodes.IMPORT_MAPPING_INVALID]: entry(
    400,
    'El mapeo de columnas no es válido: revisa cabeceras y columnas. El campo indica cuál.',
    'The column mapping is not valid: check headers and columns. The field shows which one.',
  ),
  [ErrorCodes.IMPORT_ROWS_INVALID]: entry(
    422,
    'Hay filas con problemas. Corrígelas en el archivo o exclúyelas de forma explícita.',
    'Some rows have problems. Fix them in the file or exclude them explicitly.',
  ),
  [ErrorCodes.IMPORT_KEY_MISSING]: entry(
    400,
    'La fila no tiene valor en la columna clave.',
    'The row has no value in the key column.',
  ),
  [ErrorCodes.IMPORT_KEY_DUPLICATE]: entry(
    400,
    'La clave se repite en el archivo.',
    'The key appears more than once in the file.',
  ),
  [ErrorCodes.IMPORT_KEY_AMBIGUOUS]: entry(
    400,
    'La clave coincide con varias filas de la hoja.',
    'The key matches more than one row in the worksheet.',
  ),
  [ErrorCodes.IMPORT_NOTHING_TO_CHANGE]: entry(
    409,
    'El archivo no cambia nada en la hoja: no se creó ningún borrador.',
    'The file changes nothing in the worksheet: no draft was created.',
  ),
  [ErrorCodes.WORKSHEET_ROW_LIMIT_EXCEEDED]: entry(
    409,
    'La hoja pasaría de 5.000 filas, el máximo permitido. Borra filas o reparte los datos en otra hoja.',
    'The worksheet would exceed 5,000 rows, the maximum allowed. Delete rows or split the data into another worksheet.',
  ),
  [ErrorCodes.XLSX_ENCRYPTED]: entry(
    400,
    'El archivo está cifrado o es un .xls antiguo. Guárdalo como .xlsx sin contraseña.',
    'The file is encrypted or is a legacy .xls. Save it as .xlsx without a password.',
  ),
  [ErrorCodes.XLSX_ACTIVE_CONTENT]: entry(
    400,
    'El libro tiene macros, enlaces externos u objetos incrustados. Guárdalo como .xlsx sin ellos.',
    'The workbook has macros, external links or embedded objects. Save it as .xlsx without them.',
  ),
  [ErrorCodes.XLSX_LIMITS_EXCEEDED]: entry(
    413,
    'El libro descomprimido supera los límites de tamaño, de partes o de tiempo de lectura.',
    'The uncompressed workbook exceeds the size, part count or reading time limits.',
  ),
  [ErrorCodes.XLSX_INVALID]: entry(
    400,
    'No se pudo leer el libro: el archivo está dañado o no es un .xlsx válido.',
    'The workbook could not be read: the file is damaged or is not a valid .xlsx.',
  ),
  [ErrorCodes.XLSX_SHEET_REQUIRED]: entry(
    400,
    'El libro tiene varias hojas: elige cuál importar.',
    'The workbook has several sheets: choose which one to import.',
  ),
  [ErrorCodes.XLSX_SHEET_NOT_FOUND]: entry(
    400,
    'El libro no tiene una hoja con ese nombre.',
    'The workbook has no sheet with that name.',
  ),
  [ErrorCodes.XLSX_EMPTY]: entry(
    400,
    'La hoja debe tener la fila de cabecera y al menos una fila de datos debajo.',
    'The sheet must have the header row and at least one data row below it.',
  ),
  [ErrorCodes.XLSX_ROW_LIMIT]: entry(
    400,
    'La hoja supera 5.000 filas de datos.',
    'The sheet exceeds 5,000 data rows.',
  ),
  [ErrorCodes.XLSX_CELL_ERROR]: entry(
    400,
    'La celda tiene un error de fórmula (por ejemplo, #DIV/0!).',
    'The cell has a formula error (for example, #DIV/0!).',
  ),
  [ErrorCodes.XLSX_FORMULA_NOT_CALCULATED]: entry(
    400,
    'La celda tiene una fórmula sin valor calculado. Abre y guarda el libro en Excel antes de importarlo.',
    'The cell has a formula without a calculated value. Open and save the workbook in Excel before importing it.',
  ),
  [ErrorCodes.WORKSHEET_EXPORT_NOT_FOUND]: entry(
    404,
    'No se encontró la exportación de la hoja.',
    'The worksheet export was not found.',
  ),
  [ErrorCodes.WORKSHEET_EXPORT_TOO_LARGE]: entry(
    413,
    'La exportación supera 50 MiB. Elige menos columnas o filtra las filas.',
    'The export exceeds 50 MiB. Choose fewer columns or filter the rows.',
  ),
  [ErrorCodes.WORKSHEET_CATALOG_OWNER_REQUIRED]: entry(
    403,
    'Solo el propietario del proyecto puede llevar una hoja a su catálogo: el catálogo y el feed siguen siendo suyos.',
    'Only the project owner can send a worksheet to its catalog: the catalog and the feed still belong to them.',
  ),
  [ErrorCodes.CATALOG_ID_COLUMN_INVALID]: entry(
    400,
    'La columna identificadora debe existir en la revisión y estar entre las columnas elegidas.',
    'The identifier column must exist in the revision and be one of the chosen columns.',
  ),
  [ErrorCodes.WORKSHEET_CATALOG_ROWS_INVALID]: entry(
    422,
    'Hay filas que el catálogo no admitiría. Corrígelas en la hoja o déjalas fuera con un filtro.',
    'Some rows would not be accepted by the catalog. Fix them in the worksheet or leave them out with a filter.',
  ),
  [ErrorCodes.CATALOG_ID_MISSING]: entry(
    400,
    'La fila no tiene valor en la columna identificadora.',
    'The row has no value in the identifier column.',
  ),
  [ErrorCodes.CATALOG_ID_DUPLICATE]: entry(
    400,
    'El identificador ya aparece en otra fila.',
    'The identifier already appears in another row.',
  ),
  [ErrorCodes.CATALOG_RECORD_TOO_LARGE]: entry(
    400,
    'La fila ocupa más de 1 MiB en el CSV del catálogo.',
    'The row takes more than 1 MiB in the catalog CSV.',
  ),
  [ErrorCodes.WORKSHEET_CATALOG_EMPTY]: entry(
    422,
    'No hay filas que llevar al catálogo. Revisa el filtro.',
    'There are no rows to send to the catalog. Check the filter.',
  ),
  [ErrorCodes.WORKSHEET_CATALOG_TOO_LARGE]: entry(
    413,
    'El CSV del catálogo superaría 10 MiB. Elige menos columnas o filtra las filas.',
    'The catalog CSV would exceed 10 MiB. Choose fewer columns or filter the rows.',
  ),
  [ErrorCodes.WORKSHEET_CATALOG_SNAPSHOT_NOT_FOUND]: entry(
    404,
    'No se encontró el snapshot de catálogo de la hoja.',
    'The worksheet catalog snapshot was not found.',
  ),
  [ErrorCodes.FEED_VERSION_NOT_FOUND]: entry(
    404,
    'No se encontró la versión del feed.',
    'The feed version was not found.',
  ),
  [ErrorCodes.FEED_VERSION_FILE_RETIRED]: entry(
    410,
    'El archivo de esta versión ya se retiró: solo se conservan las últimas versiones del feed.',
    'This version file was already retired: only the latest feed versions are kept.',
  ),
  [ErrorCodes.KNOWLEDGE_DISABLED]: entry(
    503,
    'El asistente de IA no está activado en este servidor.',
    'The AI assistant is not enabled on this server.',
  ),
  [ErrorCodes.PRODUCT_NOT_FOUND]: entry(
    404,
    'Ese producto no está en este archivo.',
    'That product is not in this file.',
  ),
  [ErrorCodes.FEED_NOT_PUBLISHED]: entry(
    409,
    'El feed todavía no tiene una versión publicada con la que comparar.',
    'The feed has no published version to compare with yet.',
  ),
  [ErrorCodes.WORKBOOK_ARCHIVED]: entry(
    409,
    'El libro está archivado: se puede consultar, pero no cambiar. Restáuralo primero.',
    'The workbook is archived: it can be read but not changed. Restore it first.',
  ),
  [ErrorCodes.WORKSHEET_ARCHIVED]: entry(
    409,
    'La hoja o su libro están archivados: se puede consultar, pero no cambiar. Restáurala primero.',
    'The worksheet or its workbook is archived: it can be read but not changed. Restore it first.',
  ),
  [ErrorCodes.IMPORT_MAPPING_NOT_FOUND]: entry(
    404,
    'No se encontró la plantilla de mapeo de esta hoja.',
    'The import mapping template for this worksheet was not found.',
  ),
  [ErrorCodes.IMPORT_MAPPING_NAME_TAKEN]: entry(
    409,
    'Ya hay una plantilla de mapeo con ese nombre en la hoja.',
    'There is already an import mapping template with that name in the worksheet.',
  ),
  [ErrorCodes.SAVED_VIEW_NOT_FOUND]: entry(
    404,
    'No se encontró la vista guardada de esta hoja.',
    'The saved view for this worksheet was not found.',
  ),
  [ErrorCodes.SAVED_VIEW_NAME_TAKEN]: entry(
    409,
    'Ya tienes una vista con ese nombre en la hoja.',
    'You already have a view with that name in the worksheet.',
  ),
  [ErrorCodes.CATALOG_SNAPSHOT_NOT_READY]: entry(
    409,
    'El catálogo todavía no terminó de importarse o falló: no se puede abrir como hoja.',
    'The catalog has not finished importing or it failed: it cannot be opened as a worksheet.',
  ),
  [ErrorCodes.GRAPHQL_QUERY_TOO_COSTLY]: entry(
    400,
    'La consulta pide demasiado de una vez: reduce los límites o divídela.',
    'The query asks for too much at once: lower the limits or split it.',
  ),
  [ErrorCodes.CONVERSATION_NOT_FOUND]: entry(
    404,
    'No se encontró la conversación.',
    'The conversation was not found.',
  ),
  [ErrorCodes.CONVERSATION_CURSOR_INVALID]: entry(
    400,
    'El cursor no corresponde a esta consulta de conversación.',
    'The cursor does not belong to this conversation query.',
  ),
  [ErrorCodes.AI_SHEET_SELECTION_NOT_FOUND]: entry(
    404,
    'No se encontró la selección de esta hoja.',
    'The selection was not found for this worksheet.',
  ),
  [ErrorCodes.AI_SHEET_SELECTION_EXPIRED]: entry(
    409,
    'La selección caducó. Selecciona las filas de nuevo.',
    'The selection expired. Select the rows again.',
  ),
  [ErrorCodes.AI_SHEET_SELECTION_ROW_NOT_FOUND]: entry(
    404,
    'No se encontró una fila de la selección en esta revisión.',
    'A selected row was not found in this revision.',
  ),
  [ErrorCodes.AI_SHEET_SELECTION_COLUMN_NOT_FOUND]: entry(
    404,
    'No se encontró una columna entre las admitidas para la selección.',
    'A column was not found among those allowed for the selection.',
  ),
  [ErrorCodes.AI_SHEET_PREVIEW_NOT_FOUND]: entry(
    404,
    'No se encontró la vista previa de esta hoja.',
    'The transform preview was not found for this worksheet.',
  ),
  [ErrorCodes.AI_SHEET_PREVIEW_EXPIRED]: entry(
    409,
    'La vista previa caducó. Calcula una nueva.',
    'The transform preview expired. Calculate a new one.',
  ),
  [ErrorCodes.AI_SHEET_PREVIEW_STALE]: entry(
    409,
    'La revisión de la hoja cambió. Calcula una nueva vista previa.',
    'The worksheet revision changed. Calculate a new transform preview.',
  ),
  [ErrorCodes.AI_SHEET_PREVIEW_ALREADY_USED]: entry(
    409,
    'La vista previa ya produjo un borrador.',
    'The transform preview already produced a draft.',
  ),
  [ErrorCodes.AI_SHEET_TRANSFORM_LIMIT]: entry(
    422,
    'La transformación supera los límites de la hoja. Reduce la selección.',
    'The transform exceeds the worksheet limits. Reduce the selection.',
  ),
  [ErrorCodes.AI_SHEET_PREVIEW_INVALID]: entry(
    422,
    'La vista previa debe contener cambios válidos para crear un borrador.',
    'The transform preview must contain valid changes to create a draft.',
  ),
  [ErrorCodes.AGENT_UNAVAILABLE]: entry(
    503,
    'El asistente no está disponible ahora. Inténtalo más tarde.',
    'The assistant is not available right now. Try again later.',
  ),
  [ErrorCodes.AGENT_RUN_NOT_FOUND]: entry(
    404,
    'No se encontró la ejecución del asistente.',
    'The assistant run was not found.',
  ),
  [ErrorCodes.AGENT_RUN_ACTIVE]: entry(
    409,
    'El asistente ya está respondiendo en esta conversación.',
    'The assistant is already answering in this conversation.',
  ),
  [ErrorCodes.AGENT_RUN_CONTEXT_CHANGED]: entry(
    409,
    'Ese mensaje ya se envió al asistente con otro contexto.',
    'That message was already sent to the assistant with a different context.',
  ),
  [ErrorCodes.AGENT_MESSAGE_NOT_FOUND]: entry(
    404,
    'No se encontró ese mensaje en la conversación.',
    'That message was not found in the conversation.',
  ),
  [ErrorCodes.AGENT_CREDENTIAL_INVALID]: entry(
    401,
    'La credencial de la ejecución no es válida o ya caducó.',
    'The run credential is not valid or has expired.',
  ),
  [ErrorCodes.AGENT_OPERATION_NOT_FOUND]: entry(
    404,
    'Esa operación no está disponible para el asistente.',
    'That operation is not available to the assistant.',
  ),
  [ErrorCodes.AGENT_OPERATION_MODE_INVALID]: entry(
    400,
    'La operación no admite ese modo: las lecturas se ejecutan y las escrituras se preparan.',
    'The operation does not accept that mode: reads are executed and writes are prepared.',
  ),
  [ErrorCodes.AGENT_RUN_CALL_LIMIT]: entry(
    409,
    'La ejecución alcanzó el límite de llamadas a operaciones.',
    'The run reached its operation call limit.',
  ),
  [ErrorCodes.AGENT_PROPOSAL_EXISTS]: entry(
    409,
    'Esta ejecución ya preparó una propuesta.',
    'This run already prepared a proposal.',
  ),
  [ErrorCodes.AGENT_PROPOSAL_NOT_FOUND]: entry(
    404,
    'No se encontró la propuesta.',
    'The proposal was not found.',
  ),
  [ErrorCodes.AGENT_PROPOSAL_STALE]: entry(
    409,
    'La propuesta cambió desde que la viste. Revísala de nuevo.',
    'The proposal changed since you saw it. Review it again.',
  ),
  [ErrorCodes.AGENT_PROPOSAL_DECIDED]: entry(
    409,
    'La propuesta ya se confirmó o se rechazó.',
    'The proposal was already confirmed or rejected.',
  ),
  [ErrorCodes.AGENT_PROPOSAL_EXPIRED]: entry(
    409,
    'La propuesta caducó. Pide al asistente que la prepare de nuevo.',
    'The proposal expired. Ask the assistant to prepare it again.',
  ),
  [ErrorCodes.AGENT_PROPOSAL_IN_PROGRESS]: entry(
    409,
    'La propuesta se está confirmando. Espera un momento.',
    'The proposal is being confirmed. Wait a moment.',
  ),
  [ErrorCodes.AGENT_RUN_FAILED]: entry(
    502,
    'El asistente no pudo terminar la respuesta.',
    'The assistant could not finish its answer.',
  ),
  [ErrorCodes.AGENT_MODEL_RATE_LIMITED]: entry(
    429,
    'Gemini está limitando las solicitudes. Vuelve a intentarlo en unos minutos.',
    'Gemini is rate-limiting requests. Try again in a few minutes.',
  ),
  [ErrorCodes.AGENT_RESULT_TOO_LARGE]: entry(
    422,
    'El resultado es demasiado grande para el asistente. Pide menos filas o columnas.',
    'The result is too large for the assistant. Ask for fewer rows or columns.',
  ),
  [ErrorCodes.AGENT_QUOTA_EXCEEDED]: entry(
    429,
    'Alcanzaste el límite de respuestas del asistente. Espera a que terminen las que tienes en curso o inténtalo más tarde.',
    'You reached the assistant limit. Wait for the running answers to finish or try again later.',
  ),
  [ErrorCodes.AGENT_RUN_FINISHED]: entry(
    409,
    'La ejecución ya terminó: no se puede cancelar.',
    'The run already finished: it cannot be cancelled.',
  ),
  [ErrorCodes.INTEGRATION_CREDENTIAL_NOT_FOUND]: entry(
    404,
    'No encontramos esa credencial de integración.',
    'We could not find that integration credential.',
  ),
  [ErrorCodes.INTEGRATION_CREDENTIAL_LIMIT]: entry(
    409,
    'Ya tienes el máximo de credenciales activas en este proyecto. Revoca alguna antes de crear otra.',
    'You already have the maximum number of active credentials in this project. Revoke one before creating another.',
  ),
  [ErrorCodes.INTEGRATION_CREDENTIAL_INVALID]: entry(
    401,
    'La credencial de integración no es válida, caducó o fue revocada.',
    'The integration credential is not valid, has expired or was revoked.',
  ),
  [ErrorCodes.INTEGRATION_CAPABILITY_REQUIRED]: entry(
    403,
    'Esta credencial solo puede leer: no puede preparar cambios.',
    'This credential is read-only: it cannot prepare changes.',
  ),
  [ErrorCodes.INTEGRATION_ADAPTER_INVALID]: entry(
    401,
    'El adaptador de integraciones no está autorizado.',
    'The integrations adapter is not authorized.',
  ),
  [ErrorCodes.INTEGRATIONS_UNAVAILABLE]: entry(
    503,
    'Las integraciones externas no están configuradas en este entorno.',
    'External integrations are not configured in this environment.',
  ),
  [ErrorCodes.INTEGRATION_CREDENTIAL_ALREADY_ISSUED]: entry(
    409,
    'Ya se emitió una credencial con esa clave. Si perdiste el secreto, revoca la credencial y crea otra.',
    'A credential was already issued with that key. If you lost the secret, revoke the credential and create another.',
  ),
  [ErrorCodes.INTEGRATION_EXPIRY_INVALID]: entry(
    400,
    'La credencial debe vencer después de ahora y en un plazo de hasta 7 días.',
    'The credential must expire in the future and within 7 days.',
  ),
  [ErrorCodes.INTEGRATION_QUOTA_EXCEEDED]: entry(
    429,
    'Alcanzaste el límite de integraciones de este proyecto. Inténtalo más tarde.',
    'You reached this project’s integration limit. Try again later.',
  ),
  [ErrorCodes.INTEGRATION_CURSOR_INVALID]: entry(
    400,
    'El cursor de credenciales no es válido para este listado.',
    'The credential cursor is not valid for this list.',
  ),
  [ErrorCodes.INTEGRATION_OAUTH_SCOPE_REQUIRED]: entry(
    403,
    'Autoriza el permiso de lectura en Descope.',
    'Authorize the read scope in Descope.',
  ),
  [ErrorCodes.INTEGRATION_OAUTH_GRANT_REQUIRED]: entry(
    403,
    'Activa el acceso MCP OAuth desde Integraciones.',
    'Enable MCP OAuth access in Integrations.',
  ),
  [ErrorCodes.INTEGRATION_OAUTH_GRANT_EXISTS]: entry(
    409,
    'Ya tienes acceso MCP OAuth activo para este recurso.',
    'You already have active MCP OAuth access to this resource.',
  ),
} satisfies Record<ErrorCode, { status: number; message: LocalizedMessage }>;
