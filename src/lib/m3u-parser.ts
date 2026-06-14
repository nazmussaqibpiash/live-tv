import type { Channel } from "./types";

function parseExtInf(line: string): {
  name: string;
  logo?: string;
  group?: string;
  tvgId?: string;
} {
  const commaIndex = line.lastIndexOf(",");
  const name = commaIndex >= 0 ? line.slice(commaIndex + 1).trim() : "Unknown";

  const attrs = commaIndex >= 0 ? line.slice(8, commaIndex) : line.slice(8);
  const logo = attrs.match(/tvg-logo="([^"]*)"/i)?.[1];
  const group = attrs.match(/group-title="([^"]*)"/i)?.[1];
  const tvgId = attrs.match(/tvg-id="([^"]*)"/i)?.[1];

  return { name, logo: logo || undefined, group: group || undefined, tvgId };
}

function slugify(value: string, index: number): string {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${base || "channel"}-${index}`;
}

export function parseM3U(content: string): Channel[] {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const channels: Channel[] = [];
  let pending: ReturnType<typeof parseExtInf> | null = null;
  let index = 0;

  for (const line of lines) {
    if (line.startsWith("#EXTINF:")) {
      pending = parseExtInf(line);
      continue;
    }

    if (line.startsWith("#")) continue;

    if (pending && (line.startsWith("http://") || line.startsWith("https://"))) {
      const { name, logo, group, tvgId } = pending;
      channels.push({
        id: slugify(tvgId || name, index),
        name,
        url: line,
        logo,
        group,
        tvgId,
      });
      index += 1;
      pending = null;
    }
  }

  return channels.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

export function groupChannels(channels: Channel[]): Map<string, Channel[]> {
  const map = new Map<string, Channel[]>();

  for (const channel of channels) {
    const key = channel.group?.trim() || "Other";
    const list = map.get(key) ?? [];
    list.push(channel);
    map.set(key, list);
  }

  return new Map(
    [...map.entries()].sort(([a], [b]) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    ),
  );
}
