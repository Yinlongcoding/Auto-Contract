import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const wranglerConfigPath = "workers/auth/wrangler.jsonc";
const wranglerConfig = JSON.parse(readFileSync(wranglerConfigPath, "utf8"));
const namespace = wranglerConfig.kv_namespaces?.find(
  (item) => item.binding === "CREDENTIALS",
);

if (!namespace?.id) {
  throw new Error(`CREDENTIALS KV namespace id not found in ${wranglerConfigPath}.`);
}

run("node", ["scripts/prepare-auth-kv.mjs"]);

const bulkPath = join(homedir(), ".cloudflare-auto-contract", "credentials-kv-bulk.json");
run("npx", [
  "wrangler",
  "kv",
  "bulk",
  "put",
  bulkPath,
  "--namespace-id",
  namespace.id,
  "--remote",
]);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
