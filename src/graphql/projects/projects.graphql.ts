import {
  ArgsType,
  Field,
  ID,
  InputType,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import { Allow } from 'class-validator';
import {
  CreateProjectDto,
  UpdateProjectDto,
} from '../../projects/projects.dto.js';
import { PaginationArgs } from '../common/pagination.args.js';
import { PageInfoType } from '../common/page-info.type.js';

export enum ChannelProfile {
  google_merchant = 'google_merchant',
}
export enum ConfigurationStatus {
  required = 'required',
  ready = 'ready',
}
registerEnumType(ChannelProfile, { name: 'ChannelProfile' });
registerEnumType(ConfigurationStatus, { name: 'ConfigurationStatus' });

@ObjectType('Project')
export class ProjectType {
  @Field(() => ID) id!: string;
  @Field() name!: string;
  @Field(() => String, { nullable: true }) country!: string | null;
  @Field(() => String, { nullable: true }) currency!: string | null;
  @Field(() => ChannelProfile, { nullable: true })
  channelProfile!: ChannelProfile | null;
  @Field(() => ConfigurationStatus)
  configurationStatus!: ConfigurationStatus;
  @Field() createdAt!: string;
}

/** Heredan las validaciones de los DTO REST para no duplicar reglas. */
@InputType('CreateProjectInput')
export class CreateProjectInput extends CreateProjectDto {
  @Field() declare name: string;
  @Field() declare country: string;
  @Field() declare currency: string;
  @Field(() => ChannelProfile) declare channelProfile: 'google_merchant';
}

@InputType('UpdateProjectInput')
export class UpdateProjectInput extends UpdateProjectDto {
  @Field(() => String, { nullable: true }) declare name?: string;
  @Field(() => String, { nullable: true }) declare country?: string;
  @Field(() => String, { nullable: true }) declare currency?: string;
  @Field(() => ChannelProfile, { nullable: true })
  declare channelProfile?: 'google_merchant';
}

@ObjectType('ProjectPage')
export class ProjectPageType {
  @Field(() => [ProjectType]) items!: ProjectType[];
  @Field(() => PageInfoType) page!: PageInfoType;
}

/** Qué puede hacer quien pregunta en el proyecto, como `GET /projects/:id/access`. */
@ObjectType('ProjectAccess')
export class ProjectAccessType {
  @Field(() => ID) organizationId!: string;
  @Field() role!: string;
  @Field(() => [String]) permissions!: string[];
}

/**
 * `@Args()` sin nombre recibe todos los argumentos de la operación: esta
 * clase valida la página y deja pasar `organizationId`, que llega con su propio
 * `@Args` y su pipe de UUID (sin `@Field`: no se declara dos veces).
 */
@ArgsType()
export class OrganizationPageArgs extends PaginationArgs {
  @Allow() organizationId?: unknown;
}
