import fs from "node:fs";
import type { RawStreamEntry, ValidationResult } from "./types";
import { readJsonFile, writeJsonFile } from "./utils";
import { pipelinePath } from "./paths";
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

  // periodically re-check known-good sources so dead ones get demoted fast
  const recheckLimit = Number(process.env.VALIDATE_RECHECK ?? 400);
  const recheckUrls = existing
    .filter((v) => v.status === "ok" || v.status === "slow")
    .slice(0, recheckLimit)
    .map((v) => v.url);

  const combined = [...new Set([...priorityUrls, ...recheckUrls])];
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
