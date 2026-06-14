import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const REPORTS_PATH = path.join(process.cwd(), "data", "pipeline", "reports.json");

interface ReportEntry {
  sourceId: string;
  channelId: string;
  fails: number;
  lastError?: string;
  updatedAt: string;
}

function readReports(): Record<string, ReportEntry> {
  try {
    if (!fs.existsSync(REPORTS_PATH)) return {};
    return JSON.parse(fs.readFileSync(REPORTS_PATH, "utf-8")) as Record<
      string,
      ReportEntry
    >;
  } catch {
    return {};
  }
}

function writeReports(data: Record<string, ReportEntry>): void {
  try {
    fs.mkdirSync(path.dirname(REPORTS_PATH), { recursive: true });
    fs.writeFileSync(REPORTS_PATH, JSON.stringify(data, null, 2));
  } catch {
    /* read-only FS (e.g. serverless) — ignore */
  }
}

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  const limited = rateLimit(`report:${ip}`, 30, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } },
    );
  }

  try {
    const body = (await request.json()) as {
      channelId?: string;
      sourceId?: string;
      error?: string;
    };

    if (!body.channelId || !body.sourceId) {
      return NextResponse.json(
        { error: "channelId and sourceId required" },
        { status: 400 },
      );
    }

    // local feedback store → consumed by pipeline merge to auto-demote
    const reports = readReports();
    const prev = reports[body.sourceId];
    reports[body.sourceId] = {
      sourceId: body.sourceId,
      channelId: body.channelId,
      fails: (prev?.fails ?? 0) + 1,
      lastError: body.error,
      updatedAt: new Date().toISOString(),
    };
    writeReports(reports);

    const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL;
    if (workerUrl) {
      try {
        await fetch(`${workerUrl.replace(/\/$/, "")}/api/report`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        /* worker forward best-effort */
      }
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
