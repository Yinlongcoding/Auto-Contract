import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const credentialsPath = process.argv[2] ?? "auth/login-credentials.json";
const pepperPath =
  process.argv[3] ?? join(homedir(), ".cloudflare-auto-contract", "auth-pepper.txt");
const outputPath =
  process.argv[4] ?? join(homedir(), ".cloudflare-auto-contract", "credentials-kv-bulk.json");

const credentialsFile = JSON.parse(readFileSync(credentialsPath, "utf8"));
const pepper = readFileSync(pepperPath, "utf8").trim();

if (!pepper) {
  throw new Error("AUTH_PEPPER is empty.");
}

const records = Array.isArray(credentialsFile.credentials)
  ? credentialsFile.credentials
  : [];

const bulkRecords = records
  .map((record) => {
    const credential = String(record.credential ?? record.code ?? "").trim();
    if (!credential) {
      return null;
    }

    const hash = createHash("sha256")
      .update(`${pepper}:${credential}`)
      .digest("hex");

    return {
      key: `credential:${hash}`,
      value: JSON.stringify({
        enabled: record.enabled !== false,
        validFrom: record.validFrom,
        validUntil: record.validUntil ?? record.expiresAt,
        note: record.note,
      }),
    };
  })
  .filter(Boolean);

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(bulkRecords, null, 2));
console.log(`Wrote ${bulkRecords.length} credential record(s) to ${outputPath}`);
