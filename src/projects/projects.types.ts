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
