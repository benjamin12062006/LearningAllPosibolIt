import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { INVITATION_TOKEN_PATTERN, normalizeEmail } from './invitations.js';
import {
  ORGANIZATION_ROLES,
  type OrganizationRole,
} from './organization-roles.js';

/** RFC 5321: una dirección completa no pasa de 254 caracteres. */
const MAX_EMAIL_LENGTH = 254;

function trim({ value }: { value: unknown }) {
  return typeof value === 'string' ? value.trim() : value;
}

function toNormalizedEmail({ value }: { value: unknown }) {
  return typeof value === 'string' ? normalizeEmail(value) : value;
}

export class CreateOrganizationDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;
}

export class ChangeMemberRoleDto {
  @IsIn(ORGANIZATION_ROLES)
  role!: OrganizationRole;
}

export class InviteMemberDto {
  @Transform(toNormalizedEmail)
  @IsEmail()
  @MaxLength(MAX_EMAIL_LENGTH)
  email!: string;

  @IsIn(ORGANIZATION_ROLES)
  role!: OrganizationRole;
}

export class AcceptInvitationDto {
  @IsString()
  @Matches(INVITATION_TOKEN_PATTERN)
  token!: string;
}
