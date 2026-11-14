import { Field, Int, ObjectType } from '@nestjs/graphql';

/** La misma página que REST: `hasMore` sin contar el total. */
@ObjectType('PageInfo')
export class PageInfoType {
  @Field(() => Int) limit!: number;
  @Field(() => Int) offset!: number;
  @Field() hasMore!: boolean;
}
