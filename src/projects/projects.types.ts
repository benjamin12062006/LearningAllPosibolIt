import type {
  OrganizationPermission,
  OrganizationRole,
} from '../organizations/organization-roles.js';

export type ChannelProfile = 'google_merchant';

export type ProjectConfiguration = Readonly<{
  country: string;
  currency: string;
  channelProfile: ChannelProfile;
}>;

export type Project = Readonly<{
  id: string;
  name: string;
  country: string | null;
  currency: string | null;
  channelProfile: ChannelProfile | null;
  configurationStatus: 'required' | 'ready';
  createdAt: string;
}>;

export type ConfiguredProject = Project & ProjectConfiguration;

/**
 * Quién actúa, sobre qué proyecto de qué organización y qué puede hacer. Lo
 * resuelve la membresía; los IDs que manda el cliente solo son selectores.
 */
export type ProjectAccess = Readonly<{
  actorId: string;
  organizationId: string;
  projectId: string;
  role: OrganizationRole;
  permissions: readonly OrganizationPermission[];
}>;

export type ProjectUpdate = Readonly<{
  name?: string;
  country?: string;
  currency?: string;
  channelProfile?: ChannelProfile;
}>;

type ConfigurationColumns = Readonly<{
  country: string | null;
  currency: string | null;
  channelProfile: ChannelProfile | null;
}>;

/** País, moneda y canal se guardan juntos: o están los tres o no hay configuración. */
export function hasCompleteConfiguration<T extends ConfigurationColumns>(
  project: T,
): project is T & ProjectConfiguration {
  return (
    project.country !== null &&
    project.currency !== null &&
    project.channelProfile !== null
  );
}
