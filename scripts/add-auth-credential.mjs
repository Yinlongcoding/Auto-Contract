import { existsSync, readFileSync, writeFileSync } from "node:fs";

const credentialsPath = "auth/login-credentials.json";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h") || args.length === 0) {
  console.log(`Usage:
  npm run auth:add-credential -- <code> [--from <iso-date>] [--until <iso-date>] [--note <text>]

Example:
  npm run auth:add-credential -- 20260801 --until 2026-12-31T23:59:59+08:00 --note "August code"`);
  process.exit(args.length === 0 ? 1 : 0);
}

const code = String(args[0] ?? "").trim();
if (!/^\d+$/.test(code)) {
  throw new Error("Credential code must be numeric.");
}

const options = parseOptions(args.slice(1));
const now = new Date().toISOString();
const file = readCredentialsFile();
const credentials = Array.isArray(file.credentials) ? file.credentials : [];

const duplicate = credentials.some((record) => {
  const value = String(record.credential ?? record.code ?? "").trim();
  return value === code;
});
if (duplicate) {
  throw new Error(`Credential ${code} already exists in ${credentialsPath}.`);
}

credentials.push({
  credential: code,
  validFrom: options.from ?? now,
  validUntil: options.until ?? "2026-12-31T23:59:59+08:00",
  enabled: true,
  note: options.note ?? "",
});

file.updatedAt = now;
file.credentials = credentials;
writeFileSync(credentialsPath, `${JSON.stringify(file, null, 2)}\n`);
console.log(`Added credential ${code} to ${credentialsPath}.`);
console.log("Run `npm run auth:sync-kv` to publish the updated credentials to Cloudflare KV.");

function readCredentialsFile() {
  if (!existsSync(credentialsPath)) {
    return { updatedAt: new Date().toISOString(), credentials: [] };
  }

  return JSON.parse(readFileSync(credentialsPath, "utf8"));
}

function parseOptions(optionArgs) {
  const options = {};
  for (let index = 0; index < optionArgs.length; index += 1) {
    const name = optionArgs[index];
    const value = optionArgs[index + 1];
    if (!name.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Invalid option: ${name}`);
    }

    if (name === "--from") {
      options.from = value;
    } else if (name === "--until") {
      options.until = value;
    } else if (name === "--note") {
      options.note = value;
    } else {
      throw new Error(`Unknown option: ${name}`);
    }
    index += 1;
  }

  return options;
}
