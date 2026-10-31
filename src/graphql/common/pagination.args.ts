import { ArgsType, Field, Int } from '@nestjs/graphql';
import { Max, Min } from 'class-validator';
import { PAGINATION } from '../../common/http/pagination.js';

@ArgsType()
export class PaginationArgs {
  @Field(() => Int, { defaultValue: PAGINATION.defaultLimit })
  @Min(1)
  @Max(PAGINATION.maxLimit)
  limit: number = PAGINATION.defaultLimit;

  @Field(() => Int, { defaultValue: 0 })
  @Min(0)
  offset: number = 0;
}
