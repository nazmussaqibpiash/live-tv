export type ChannelStatus = "active" | "degraded" | "offline";

export interface RawStreamEntry {
  name: string;
  url: string;
  logo?: string;
  group?: string;
  tvgId?: string;
  feedId: string;
  feedRegion: string;
  isBdix: boolean;
}

export interface ValidationResult {
  url: string;
  status: "ok" | "dead" | "geo_blocked" | "slow" | "timeout" | "invalid";
  latencyMs: number;
  httpCode?: number;
  errorMsg?: string;
}

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

export interface SourceFeed {
  id: string;
  name: string;
  url: string;
  type: string;
  region: string;
  priority: number;
  maxChannels?: number;
  /** consecutive crawl runs this feed returned no usable channels */
  deadStreak?: number;
}
