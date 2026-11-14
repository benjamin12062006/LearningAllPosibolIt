import { Field, ID, InputType, ObjectType } from '@nestjs/graphql';
import {
  SaveViewDto,
  type SavedViewQueryDto,
  type ViewVisibility,
} from '../../worksheets/worksheets.dto.js';
import { JsonObjectScalar } from '../common/json-object.scalar.js';
import { JsonScalar } from '../common/json.scalar.js';
import { PageInfoType } from '../common/page-info.type.js';

/** Filtros, orden y columnas con nombre; no cambia ningún valor de la hoja. */
@ObjectType('SavedView')
export class SavedViewType {
  @Field(() => ID) id!: string;
  @Field(() => ID) worksheetId!: string;
  @Field(() => ID) ownerId!: string;
  @Field() name!: string;
  /** `personal` o `team`. */
  @Field() visibility!: string;
  /** `{ filter, sort, columns }`, como el cuerpo de `rows/query`. */
  @Field(() => JsonScalar) query!: unknown;
  @Field() createdAt!: string;
  @Field() updatedAt!: string;
  /** Si quien pregunta puede cambiarla o borrarla. */
  @Field() canEdit!: boolean;
}

@ObjectType('SavedViewPage')
export class SavedViewPageType {
  @Field(() => [SavedViewType]) items!: SavedViewType[];
  @Field(() => PageInfoType) page!: PageInfoType;
}

/**
 * La consulta de la vista es un `JSONObject` y se valida como en REST: el
 * DTO la convierte en `SavedViewQueryDto` y valida su orden y sus columnas.
 */
@InputType('SaveViewInput')
export class SaveViewInput extends SaveViewDto {
  @Field() declare name: string;
  /** `personal` (cualquier miembro) o `team` (Editor). */
  @Field() declare visibility: ViewVisibility;
  @Field(() => JsonObjectScalar) declare query: SavedViewQueryDto;
}
