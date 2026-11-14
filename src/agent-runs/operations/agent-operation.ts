import type { AuthenticatedIdentity } from '../../auth/authenticated-request.js';
import type { OrganizationPermission } from '../../organizations/organization-roles.js';
import type { ProjectScope } from '../../worksheets/worksheets.types.js';
import type { RunContext } from '../agent-runs.types.js';

/** Un objeto JSON Schema (draft 2020-12), como lo valida el servicio de IA. */
export type JsonSchema = Readonly<Record<string, unknown>>;

/**
 * Con quién y dónde actúa una operación: la persona que inició la ejecución
 * (o la dueña de la credencial), su proyecto y el contexto de la conversación.
 * Cada operación llama a los servicios de siempre con esa identidad: los
 * permisos, los 404 y los errores son los de REST.
 */
export type OperationContext = Readonly<{
  identity: AuthenticatedIdentity;
  actorId: string;
  scope: ProjectScope;
  context: RunContext;
}>;

/** Lo que deja preparada una escritura para que la persona la confirme. */
export type PreparedEffect = Readonly<{
  summary: string;
  plan: Record<string, unknown>;
  target: Record<string, unknown> | null;
}>;

type OperationBase<Input> = Readonly<{
  name: string;
  description: string;
  /** El permiso que necesita la persona para que la operación se le ofrezca. */
  permission: OrganizationPermission;
  inputSchema: JsonSchema;
  /** Valida los argumentos del modelo con un DTO, como REST (400 si no). */
  parse(input: Record<string, unknown>): Promise<Input>;
  /** Qué toca la operación, para los eventos en vivo (E6.4). */
  targetOf(context: OperationContext, input: Input): Record<string, unknown>;
}>;

/** Una lectura: se ejecuta en el momento (`execute`). */
export type ReadOperation<Input = unknown> = OperationBase<Input> &
  Readonly<{
    level: 'read';
    execute(context: OperationContext, input: Input): Promise<unknown>;
  }>;

/**
 * Una escritura: se prepara (`prepare`) y solo la persona la confirma. El plan
 * guardado es lo que se ejecuta al confirmar, nunca lo que diga el modelo.
 */
export type WriteOperation<Input = unknown> = OperationBase<Input> &
  Readonly<{
    level: 'write';
    prepare(context: OperationContext, input: Input): Promise<PreparedEffect>;
    confirm(
      context: OperationContext,
      plan: Record<string, unknown>,
      proposalId: string,
    ): Promise<unknown>;
  }>;

export type AgentOperation = ReadOperation | WriteOperation;

/** Lo que se le cuenta al agente de cada operación. */
export type OperationDescription = Readonly<{
  name: string;
  description: string;
  inputSchema: JsonSchema;
  level: 'read' | 'write';
}>;
