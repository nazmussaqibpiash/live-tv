"use client";

import type { ApiChannel } from "@/lib/types";
import { ChannelPoster } from "./channel-poster";

interface ChannelCardProps {
  channel: ApiChannel;
  active?: boolean;
  isFavorite?: boolean;
  onSelect: (channel: ApiChannel) => void;
  onToggleFavorite?: (id: string) => void;
  nowPlaying?: string | null;
}

export function ChannelCard(props: ChannelCardProps) {
  return <ChannelPoster {...props} variant="rail" />;
}
