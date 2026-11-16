import {
  getNamedType,
  getNullableType,
  isCompositeType,
  isListType,
  isObjectType,
  Kind,
  type FieldNode,
  type FragmentDefinitionNode,
  type GraphQLCompositeType,
  type GraphQLField,
  type GraphQLSchema,
  type OperationDefinitionNode,
  type SelectionSetNode,
} from 'graphql';
import { PAGINATION } from '../../common/http/pagination.js';

/** Coste máximo de una operación (plan C7, G3). */
export const MAX_QUERY_COST = 1000;

/**
 * Campos que leen un archivo o recorren un catálogo: cuestan más que un campo
 * normal aunque devuelvan poco. El nombre es `Tipo.campo`.
 */
export const HEAVY_FIELDS: ReadonlyMap<string, number> = new Map([
  ['Worksheet.rows', 10],
  ['Evaluation.rows', 10],
  ['Evaluation.attention', 10],
  ['Feed.comparison', 10],
  ['Export.products', 10],
  ['Export.product', 10],
  ['FeedVersion.products', 10],
  ['FeedVersion.product', 10],
  ['Changeset.diff', 10],
  ['Query.rulesPreview', 10],
]);

type CostContext = Readonly<{
  schema: GraphQLSchema;
  fragments: ReadonlyMap<string, FragmentDefinitionNode>;
  variables: Readonly<Record<string, unknown>>;
}>;

/**
 * Coste de una operación con sus variables. Cada campo cuesta 1 (o su peso de
 * `HEAVY_FIELDS`). Una lista cuesta lo de dentro tantas veces como elementos
 * puede traer: el `limit` del propio campo o, si es la lista de una página
 * (`changes` dentro de `comparison(limit: 50)`), el de la página. Una lista
 * sin límite cuenta una vez: son listas acotadas por el dominio (columnas,
 * grupos de problemas).
 */
export function operationCost(
  schema: GraphQLSchema,
  operation: OperationDefinitionNode,
  fragments: ReadonlyMap<string, FragmentDefinitionNode>,
  variables: Readonly<Record<string, unknown>> = {},
): number {
  const root = schema.getRootType(operation.operation);
  if (!root) {
    return 0;
  }
  const context = { schema, fragments, variables };
  return selectionCost(operation.selectionSet, root, context, undefined);
}

function selectionCost(
  selectionSet: SelectionSetNode,
  parent: GraphQLCompositeType,
  context: CostContext,
  pageSize: number | undefined,
): number {
  let cost = 0;
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      cost += fieldCost(selection, parent, context, pageSize);
      continue;
    }
    const fragment =
      selection.kind === Kind.INLINE_FRAGMENT
        ? selection
        : context.fragments.get(selection.name.value);
    if (!fragment) {
      continue;
    }
    const condition = fragment.typeCondition?.name.value;
    const type = condition ? compositeType(context.schema, condition) : parent;
    if (type) {
      cost += selectionCost(fragment.selectionSet, type, context, pageSize);
    }
  }
  return cost;
}

function fieldCost(
  node: FieldNode,
  parent: GraphQLCompositeType,
  context: CostContext,
  pageSize: number | undefined,
): number {
  const name = node.name.value;
  // Introspección y `__typename`: no leen datos.
  if (name.startsWith('__') || !isObjectType(parent)) {
    return 0;
  }
  const field = parent.getFields()[name];
  if (!field) {
    return 0;
  }

  const weight = HEAVY_FIELDS.get(`${parent.name}.${name}`) ?? 1;
  const childType = getNamedType(field.type);
  if (!node.selectionSet || !isCompositeType(childType)) {
    return weight;
  }

  // Una página (`comparison(limit)`) pasa su límite a sus listas; una lista
  // con límite propio (`projects(limit)`) lo gasta ella misma.
  const limit = requestedLimit(field, node, context.variables);
  const isList = isListType(getNullableType(field.type));
  const childCost = selectionCost(
    node.selectionSet,
    childType,
    context,
    isList ? undefined : limit,
  );
  const items = isList ? (limit ?? pageSize ?? 1) : 1;
  return weight + items * childCost;
}

/** El `limit` pedido o el de por defecto; `undefined` si el campo no pagina. */
function requestedLimit(
  field: GraphQLField<unknown, unknown>,
  node: FieldNode,
  variables: Readonly<Record<string, unknown>>,
): number | undefined {
  const argument = field.args.find((arg) => arg.name === 'limit');
  if (!argument) {
    return undefined;
  }
  const given = node.arguments?.find((arg) => arg.name.value === 'limit');
  let value: unknown = argument.defaultValue ?? PAGINATION.defaultLimit;
  if (given?.value.kind === Kind.INT) {
    value = Number(given.value.value);
  } else if (given?.value.kind === Kind.VARIABLE) {
    value = variables[given.value.name.value] ?? value;
  }
  return typeof value === 'number' && value >= 1 ? value : 1;
}

function compositeType(schema: GraphQLSchema, name: string) {
  const type = schema.getType(name);
  return type && isCompositeType(type) ? type : undefined;
}
