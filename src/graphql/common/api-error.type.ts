import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('LocalizedMessage')
export class LocalizedMessageType {
  @Field() es!: string;
  @Field() en!: string;
}

/** Error público guardado en importaciones; mismo contrato que REST. */
@ObjectType('ApiError')
export class ApiErrorType {
  @Field() code!: string;
  @Field(() => LocalizedMessageType) message!: LocalizedMessageType;
  @Field(() => Int, { nullable: true }) sourceRow?: number;
  @Field(() => String, { nullable: true }) field?: string;
  @Field(() => String, { nullable: true }) requestId?: string;
}
