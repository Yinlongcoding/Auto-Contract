# Auto Contract Auth Worker

This Worker verifies login credentials for the desktop app without exposing the credential set to clients.

Endpoints:

- `GET /health`
- `POST /verify-login` with `{ "credential": "..." }`

Secrets and storage:

- `AUTH_PEPPER` is a Worker secret.
- `CREDENTIALS` is a KV namespace containing `credential:<sha256>` keys.
