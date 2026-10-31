import { Field, ID, InputType, ObjectType } from '@nestjs/graphql';
import { UpdateProfileDto } from '../../users/users.dto.js';

@ObjectType('User')
export class UserType {
  @Field(() => ID) id!: string;
  @Field(() => String, { nullable: true }) email!: string | null;
  @Field(() => String, { nullable: true }) displayName!: string | null;
  @Field() createdAt!: string;
  @Field() updatedAt!: string;
}

/** Hereda las validaciones del DTO REST para no duplicar reglas. */
@InputType('UpdateMeInput')
export class UpdateMeInput extends UpdateProfileDto {
  @Field(() => String, { nullable: true })
  declare displayName: string | null;
}
