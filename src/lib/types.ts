export type ChannelStatus = "active" | "degraded" | "offline";

export interface ChannelSource {
  id: string;
  url: string;
  quality?: string;
  rankScore: number;
  latencyMs?: number;
  isPrimary: boolean;
  sourceOrigin?: string;
}

export interface ApiChannel {
  id: string;
  name: string;
  logo?: string;
  category: string;
  subcategory?: string;
  group?: string;
  status: ChannelStatus;
  isBdix: boolean;
  tvgId?: string;
  sources: ChannelSource[];
}

export interface CategoryInfo {
  id: string;
  label: string;
  order: number;
  count: number;
}

export interface CatalogPayload {
  version: string;
  generatedAt: string;
  stats: {
    totalChannels: number;
    activeChannels: number;
    degradedChannels: number;
    totalSources: number;
    validatedSources: number;
  };
  categories: CategoryInfo[];
  channels: ApiChannel[];
}

/* Legacy types for manual playlist mode */
export type PlaylistCategory = "bdix" | "international" | "custom";

export interface CuratedPlaylist {
  id: string;
  name: string;
  description: string;
  category: PlaylistCategory;
  url: string;
  source: string;
  updated: string;
}

export interface Channel {
  id: string;
  name: string;
  url: string;
  logo?: string;
  group?: string;
  tvgId?: string;
}

export interface ParsedPlaylist {
  channels: Channel[];
  playlistUrl: string;
  fetchedAt: string;
}
