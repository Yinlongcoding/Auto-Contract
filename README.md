# Auto-Contract

Auto Contract Desktop is a Tauri + React desktop app for generating foreign trade contract documents.

## Scripts

```bash
npm install
npm run dev
npm run build
npm run build:desktop
```

## Project Structure

- `src/` - React frontend
- `src-tauri/` - Tauri/Rust desktop backend
- `templates/` - document templates used by the app
- `docs/` - product and UI/UX notes
- `auth/login-credentials.json` - numeric login credentials read from GitHub at login time

## Login Credentials

The desktop app reads the credential list from:

```text
https://raw.githubusercontent.com/Yinlongcoding/Auto-Contract/main/auth/login-credentials.json
```

Each credential must be numeric and include `validFrom`, `validUntil`, and `enabled`.
