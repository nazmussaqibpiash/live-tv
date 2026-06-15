import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({
  // Default in-memory caching is fine for this app; the heavy data
  // (catalog/EPG) is served from the API Worker + KV, not Next cache.
});
