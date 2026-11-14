import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType('KnowledgeSource')
export class KnowledgeSourceType {
  @Field() sourceType!: string;
  @Field(() => ID) sourceId!: string;
  /** Nulo si todavía no se mandó al servicio de IA. */
  @Field(() => String, { nullable: true }) syncedAt!: string | null;
  /** Cambió desde la última vez y espera a la pasada siguiente. */
  @Field() pending!: boolean;
}

/** Qué sabe el asistente del proyecto, como `GET …/knowledge`. */
@ObjectType('KnowledgeStatus')
export class KnowledgeStatusType {
  @Field() enabled!: boolean;
  @Field(() => [KnowledgeSourceType]) sources!: KnowledgeSourceType[];
}

/** La pasada siguiente del reconciliador manda el proyecto entero. */
@ObjectType('KnowledgeReindex')
export class KnowledgeReindexType {
  @Field() status!: string;
}
