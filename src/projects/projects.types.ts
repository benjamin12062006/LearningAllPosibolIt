export type ProjectConfiguration = Readonly<{
  country: string;
  currency: string;
  channelProfile: 'google_merchant';
}>;

export type Project = Readonly<{
  id: string;
  name: string;
  country: string | null;
  currency: string | null;
  channelProfile: 'google_merchant' | null;
  configurationStatus: 'required' | 'ready';
  createdAt: string;
}>;

export type ConfiguredProject = Project & ProjectConfiguration;

export type ProjectUpdate = Readonly<{
  name?: string;
  country?: string;
  currency?: string;
  channelProfile?: 'google_merchant';
}>;
