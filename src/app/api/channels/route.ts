import { NextRequest, NextResponse } from "next/server";
import { filterCatalog, getCatalog, getCatalogIndex } from "@/lib/catalog";
import { proxyToWorker } from "@/lib/worker-proxy";

export async function GET(request: NextRequest) {
  // Prefer the edge API worker (paginated, KV-backed). Falls back to the local
  // catalog file in dev / on platforms with filesystem access.
  const proxied = await proxyToWorker(request, "/api/channels");
  if (proxied) return proxied;

  const catalog = await getCatalog();

  if (!catalog) {
    return NextResponse.json(
      {
        error:
          "Catalog not available. Run npm run pipeline:all or wait for GitHub Actions.",
        channels: [],
        categories: [],
      },
      { status: 503 },
    );
  }

  const idsParam = request.nextUrl.searchParams.get("ids");
  if (idsParam) {
    const { byId } = getCatalogIndex(catalog);
    const ids = idsParam.split(",").filter(Boolean);
    // O(1) per id lookup, preserving requested order
    const ordered = ids
      .map((id) => byId.get(id))
      .filter((c): c is NonNullable<typeof c> => Boolean(c));
    return NextResponse.json(
      { channels: ordered, categories: catalog.categories },
      { headers: { "Cache-Control": "public, s-maxage=300" } },
    );
  }

  const category = request.nextUrl.searchParams.get("category");
  const q = request.nextUrl.searchParams.get("q");
  const status = request.nextUrl.searchParams.get("status");
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") ?? 1));
  const limit = Math.min(
    120,
    Math.max(20, Number(request.nextUrl.searchParams.get("limit") ?? 60)),
  );

  // filterCatalog returns an already status→rank→name sorted list
  let channels = filterCatalog(catalog, category, q);

  if (status) {
    const allowed = new Set(status.split(",").map((s) => s.trim()));
    channels = channels.filter((c) => allowed.has(c.status));
  }
  const total = channels.length;
  const totalPages = Math.ceil(total / limit);
  const offset = (page - 1) * limit;
  channels = channels.slice(offset, offset + limit);

  return NextResponse.json(
    {
      channels,
      categories: catalog.categories,
      generatedAt: catalog.generatedAt,
      stats: catalog.stats,
      pagination: { page, limit, total, totalPages },
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    },
  );
}
