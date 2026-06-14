import fs from "node:fs";
import { runDiscover } from "./discover";
import { runValidate } from "./validate-run";
import { runMerge } from "./merge";
import { runCrawl } from "./crawl";
import { runEnrichLogos } from "./enrich-logos";
import { runEpg } from "./epg";
import { pipelinePath } from "./paths";

const LOCK_PATH = pipelinePath(".pipeline.lock");
/** a lock older than this is considered stale (crashed run) and reclaimed */
const STALE_LOCK_MS = 60 * 60 * 1000;

/** Prevent two concurrent full pipeline runs from corrupting shared output. */
function acquireLock(): boolean {
  try {
    fs.mkdirSync(pipelinePath(), { recursive: true });
    if (fs.existsSync(LOCK_PATH)) {
      const raw = fs.readFileSync(LOCK_PATH, "utf-8");
      const startedAt = Number(JSON.parse(raw).startedAt) || 0;
      if (Date.now() - startedAt < STALE_LOCK_MS) return false;
      console.warn("[pipeline] reclaiming stale lock");
    }
    fs.writeFileSync(
      LOCK_PATH,
      JSON.stringify({ pid: process.pid, startedAt: Date.now() }),
    );
    return true;
  } catch {
    // if locking itself fails, don't block the run
    return true;
  }
}

/** true only when THIS process owns the lock, so we never delete another's */
let lockHeld = false;

function releaseLock(): void {
  if (!lockHeld) return;
  try {
    fs.rmSync(LOCK_PATH, { force: true });
    lockHeld = false;
  } catch {
    /* ignore */
  }
}

async function main() {
  const step = process.env.PIPELINE_STEP ?? "all";
  console.log(`[pipeline] Step: ${step}`);

  // only the full run mutates shared catalog output; single steps are dev tools
  const needsLock = step === "all" || step === "merge";
  if (needsLock) {
    if (!acquireLock()) {
      console.error(
        "[pipeline] Another run is in progress (lock held). Exiting.",
      );
      process.exit(0);
    }
    lockHeld = true;
  }

  if (step === "crawl") {
    await runCrawl();
    return;
  }

  // auto-discovery first: grow the source pool before discovering streams
  if (step === "all" || step === "discover") {
    if (process.env.CRAWL_ENABLED !== "0") {
      try {
        await runCrawl();
      } catch (err) {
        console.warn("[pipeline] crawl skipped:", String(err));
      }
    }
    await runDiscover();
    if (step === "discover") return;
  }

  if (step === "all" || step === "validate") {
    await runValidate();
    if (step === "validate") return;
  }

  if (step === "logos") {
    await runEnrichLogos();
    return;
  }

  if (step === "epg") {
    await runEpg();
    return;
  }

  if (step === "all" || step === "merge") {
    // refresh logo map before merging so channels get enriched logos
    if (process.env.LOGOS_ENABLED !== "0") {
      try {
        await runEnrichLogos();
      } catch (err) {
        console.warn("[pipeline] logo enrich skipped:", String(err));
      }
    }
    await runMerge();
  }

  // EPG (now/next guide) is best-effort and runs after the catalog exists.
  if (step === "all") {
    if (process.env.EPG_ENABLED !== "0") {
      try {
        await runEpg();
      } catch (err) {
        console.warn("[pipeline] epg skipped:", String(err));
      }
    }
  }

  console.log("[pipeline] Done");
}

void main()
  .then(() => releaseLock())
  .catch((err) => {
    releaseLock();
    console.error("[pipeline] FAILED:", err);
    process.exit(1);
  });
