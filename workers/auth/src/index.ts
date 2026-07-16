type CredentialRecord = {
  enabled?: boolean;
  validFrom?: string;
  validUntil?: string;
  note?: string;
};

type Env = {
  CREDENTIALS: KVNamespace;
  AUTH_PEPPER: string;
};

const jsonHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "86400",
  "Content-Type": "application/json; charset=utf-8",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: jsonHeaders });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true });
    }

    if (request.method !== "POST" || url.pathname !== "/verify-login") {
      return json({ valid: false, message: "Not found" }, 404);
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return json({ valid: false, message: "Invalid request" }, 400);
    }

    const credential = getCredential(payload);
    if (!credential) {
      return json({ valid: false, message: "Credential is required" }, 400);
    }

    const key = `credential:${await credentialHash(env.AUTH_PEPPER, credential)}`;
    const record = await env.CREDENTIALS.get<CredentialRecord>(key, "json");
    const result = verifyRecord(record);
    return json(result);
  },
};

function getCredential(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("credential" in payload)) {
    return "";
  }

  const value = (payload as { credential?: unknown }).credential;
  if (typeof value !== "string" && typeof value !== "number") {
    return "";
  }

  return String(value).trim();
}

function verifyRecord(record: CredentialRecord | null) {
  if (!record || record.enabled === false) {
    return { valid: false, message: "凭证无效" };
  }

  const now = Date.now();
  const validFrom = parseOptionalDate(record.validFrom);
  const validUntil = parseOptionalDate(record.validUntil);

  if (validFrom !== null && now < validFrom) {
    return { valid: false, message: "凭证尚未生效" };
  }

  if (validUntil !== null && now > validUntil) {
    return { valid: false, message: "凭证已过期" };
  }

  return { valid: true };
}

function parseOptionalDate(value: string | undefined) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

async function credentialHash(pepper: string, credential: string) {
  const input = new TextEncoder().encode(`${pepper}:${credential}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  });
}
