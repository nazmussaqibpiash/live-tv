import { NextRequest, NextResponse } from "next/server";
import { getCatalog } from "@/lib/catalog";
import { proxyToWorker } from "@/lib/worker-proxy";

export async function GET(request: NextRequest) {
  const proxied = await proxyToWorker(request, "/api/categories");
  if (proxied) return proxied;

  const catalog = await getCatalog();

  if (!catalog) {
    return NextResponse.json(
      { error: "Catalog not available", categories: [], stats: null },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { categories: catalog.categories, stats: catalog.stats, generatedAt: catalog.generatedAt },
    {
      headers: {
        "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1200",
      },
    },
  );
}
