import {
  GraphQLError,
  Kind,
  type FragmentDefinitionNode,
  type SelectionSetNode,
  type ValidationRule,
} from 'graphql';

/** Rechaza consultas más profundas que `max`; resuelve fragmentos y omite `__*`. */
export function maxQueryDepth(max: number): ValidationRule {
  return (context) => {
    const fragments = new Map<string, FragmentDefinitionNode>();
    for (const definition of context.getDocument().definitions) {
      if (definition.kind === Kind.FRAGMENT_DEFINITION) {
        fragments.set(definition.name.value, definition);
      }
    }

    const depthOf = (
      selectionSet: SelectionSetNode | undefined,
      seen: ReadonlySet<string>,
    ): number => {
      if (!selectionSet) return 0;
      let deepest = 0;
      for (const selection of selectionSet.selections) {
        if (selection.kind === Kind.FIELD) {
          if (selection.name.value.startsWith('__')) continue;
          deepest = Math.max(
            deepest,
            1 + depthOf(selection.selectionSet, seen),
          );
        } else if (selection.kind === Kind.INLINE_FRAGMENT) {
          deepest = Math.max(deepest, depthOf(selection.selectionSet, seen));
        } else {
          const name = selection.name.value;
          const fragment = fragments.get(name);
          if (fragment && !seen.has(name)) {
            deepest = Math.max(
              deepest,
              depthOf(fragment.selectionSet, new Set([...seen, name])),
            );
          }
        }
      }
      return deepest;
    };

    return {
      OperationDefinition(node) {
        if (depthOf(node.selectionSet, new Set()) > max) {
          context.reportError(
            new GraphQLError(
              `La consulta supera la profundidad máxima (${max}).`,
              {
                nodes: node,
              },
            ),
          );
        }
      },
    };
  };
}
