import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LiveTvApp } from "@/components/live-tv-app";
import { getChannelById } from "@/lib/catalog";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const channel = await getChannelById(id);

  if (!channel) {
    return { title: "Live TV — Channel" };
  }

  const title = `${channel.name} — Live TV`;
  const description = `Watch ${channel.name} live${
    channel.category ? ` · ${channel.category}` : ""
  } free in your browser.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: channel.logo ? [{ url: channel.logo }] : undefined,
      type: "video.other",
    },
  };
}

export default async function WatchPage({ params }: Props) {
  const { id } = await params;
  const channel = await getChannelById(id);
  if (!channel) notFound();
  return <LiveTvApp initialChannelId={id} />;
}
