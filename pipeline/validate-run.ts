import fs from "node:fs";
import type { CatalogPayload, RawStreamEntry, ValidationResult } from "./types";
import { readJsonFile, writeJsonFile } from "./utils";
import { pipelinePath, publicDataPath } from "./paths";
import { validateUrls } from "./validate";

interface PipelineState {
  validateOffset: number;
  lastValidateAt: string | null;
}

const BATCH_SIZE = Number(process.env.VALIDATE_BATCH_SIZE ?? 800);
const MAX_VALIDATE = Number(process.env.MAX_VALIDATE ?? 0);

function loadState(): PipelineState {
  const path = pipelinePath("state.json");
  if (!fs.existsSync(path)) {
    return { validateOffset: 0, lastValidateAt: null };
  }
  return readJsonFile<PipelineState>(path);
}

function saveState(state: PipelineState): void {
  writeJsonFile(pipelinePath("state.json"), state);
}

function mergeValidations(
  existing: ValidationResult[],
  fresh: ValidationResult[],
): ValidationResult[] {
  const map = new Map(existing.map((v) => [v.url, v]));
  for (const v of fresh) map.set(v.url, v);
  return [...map.values()];
}

/**
 * Every URL that currently backs a published channel. These MUST be re-checked
 * each run so a source that died since last time is demoted/removed before users
 * hit it — this is what guarantees "only fresh live links" in the catalog.
 */
function liveCatalogUrls(): string[] {
  const urls = new Set<string>();
  for (const p of [publicDataPath("catalog.json"), pipelinePath("catalog.json")]) {
    if (!fs.existsSync(p)) continue;
    try {
      const cat = readJsonFile<CatalogPayload>(p);
      for (const ch of cat.channels ?? []) {
        for (const s of ch.sources ?? []) urls.add(s.url);
      }
      if (urls.size > 0) break;
    } catch {
      /* fall through to next candidate */
    }
  }
  return [...urls];
}

export async function runValidate(): Promise<number> {
  const rawPath = pipelinePath("raw-streams.json");
  if (!fs.existsSync(rawPath)) {
    throw new Error("Missing raw-streams.json — run discover first");
  }

  const raw = readJsonFile<{ streams: RawStreamEntry[] }>(rawPath);
  const allUrls = [...new Set(raw.streams.map((s) => s.url))];

  let urlsToCheck: string[];

  if (MAX_VALIDATE > 0) {
    urlsToCheck = allUrls.slice(0, MAX_VALIDATE);
  } else {
    const state = loadState();
    const start = state.validateOffset;
    const end = Math.min(start + BATCH_SIZE, allUrls.length);
    urlsToCheck = allUrls.slice(start, end);

    const nextOffset = end >= allUrls.length ? 0 : end;
    saveState({
      validateOffset: nextOffset,
      lastValidateAt: new Date().toISOString(),
    });

    console.log(
      `[validate] Batch ${start}-${end} of ${allUrls.length} (next offset ${nextOffset})`,
    );

    if (urlsToCheck.length === 0) {
      urlsToCheck = allUrls.slice(0, BATCH_SIZE);
    }
  }

  const existing: ValidationResult[] = fs.existsSync(
    pipelinePath("validations.json"),
  )
    ? readJsonFile<ValidationResult[]>(pipelinePath("validations.json"))
    : [];

  const existingMap = new Map(existing.map((v) => [v.url, v]));

  const priorityUrls = urlsToCheck.filter((url) => {
    const prev = existingMap.get(url);
    if (!prev) return true;
    if (prev.status === "dead" || prev.status === "invalid") return false;
    return prev.latencyMs === undefined;
  });

  // FRESHNESS GUARANTEE: re-validate EVERY URL currently backing a published
  // channel, so anything shown to users was verified this run. Dead ones get
  // demoted/removed by merge immediately instead of lingering for many cycles.
  const liveUrls = liveCatalogUrls();
  console.log(`[validate] Re-checking ${liveUrls.length} live catalog URLs`);

  // periodically re-check other known-good sources too (keeps the wider pool
  // fresh as the offset window rotates).
  const recheckLimit = Number(process.env.VALIDATE_RECHECK ?? 400);
  const recheckUrls = existing
    .filter((v) => v.status === "ok" || v.status === "slow")
    .slice(0, recheckLimit)
    .map((v) => v.url);

  const combined = [
    ...new Set([...liveUrls, ...priorityUrls, ...recheckUrls]),
  ];
  console.log(`[validate] Checking ${combined.length} URLs this run...`);

  const results = await validateUrls(combined);
  const merged = mergeValidations(existing, [...results.values()]);

  writeJsonFile(pipelinePath("validations.json"), merged);
  console.log(`[validate] Total stored validations: ${merged.length}`);
  return merged.length;
}

if (import.meta.url.startsWith("file:")) {
  const scriptPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
  if (scriptPath.endsWith("validate-run.ts") || scriptPath.endsWith("validate-run.js")) {
    runValidate().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  }
}
