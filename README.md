# SSDCloud MVP

Web upload system with React frontend and Node.js backend.

## Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Database: MongoDB
- Storage: Cloudflare R2 (S3-compatible)
- Auth: JWT access/refresh + long-lived API key for scripts

## Features

- Register / login / refresh token / logout
- User profile with `balance`
- Upload file with billing (`cost = ceil(sizeMb * unitPrice)`)
- API key management (create/list/revoke, key hash only in DB)
- Download/delete uploaded files

## Run local

1. Copy `.env.example` to `.env` and adjust values.
2. Start MongoDB:
   - `docker compose up -d`
3. Create bucket on Cloudflare R2 (ex: `ssdcloud-files`) and fill R2 credentials in `.env`.
4. Install dependencies:
   - `npm install`
5. Start apps:
   - `npm run dev`
6. Open:
   - Web: `http://localhost:5173`
   - API: `http://localhost:4000/health`

## Deploy to ssdcloud.net

1. Point DNS A record of `ssdcloud.net` to server public IP.
2. On server, clone repo and create `.env`.
3. Run:
   - `docker compose -f infra/docker-compose.prod.yml up -d --build`
4. Caddy auto-issues SSL certificate for `ssdcloud.net`.

## Script upload example

Use API key generated from dashboard:

```bash
curl -X POST "https://ssdcloud.net/api/files/upload/initiate" \
  -H "x-api-key: sk_xxx" \
  -H "Content-Type: application/json" \
  -d '{"fileName":"your-file.zip","fileSize":123456,"mimeType":"application/zip"}'
```

Then request `/presign`, upload each part directly to the returned URL(s), and call `/complete`.

Or run smoke test script (automates initiate -> presign -> PUT part -> complete):

```bash
node scripts/smoke-upload.mjs ./your-file.zip sk_xxx http://localhost:4000
```

## Uploader CLI (`up`) for Linux + Windows

Build both binaries from one command:

- Windows: `scripts\up\build.bat`
- Linux/macOS: `sh ./scripts/up/build.sh`

Output:

- `bin/up` (Linux ELF, amd64)
- `bin/up.exe` (Windows, amd64)

Install on Linux:

```bash
chmod +x ./bin/up
sudo mv ./bin/up /usr/local/bin/up
```

Install on Windows (PowerShell, current user):

```powershell
Copy-Item .\bin\up.exe "$HOME\AppData\Local\Microsoft\WindowsApps\up.exe"
```

Auth for `up`:

- `SSD_API_KEY` (recommended for script key, format `sk_...` or `uk_...`)
- Fallback: `SSD_TOKEN`
  - If value starts with `sk_` or `uk_`, `up` auto-sends `x-api-key`
  - Otherwise `up` sends `Authorization: Bearer ...`

Shortest upload command (API key):

```bash
SSD_API_KEY="sk_xxx" up ./your-file.zip
```

Shortest upload command (JWT):

```bash
SSD_TOKEN="your_jwt_token" up ./your-file.zip
```

Windows (PowerShell):

```powershell
$env:SSD_API_KEY="sk_xxx"; up.exe .\your-file.zip
```

Optional env:

- `SSD_BASE_URL` (default: `https://ssdcloud.net`)

CLI output:

- Real-time upload percent (`Upload: xx.xx%`)
- File link after success (`Link: https://...`)

### Troubleshooting token

If `up` reports missing credential:

- Linux/macOS:
  - `export SSD_API_KEY="sk_xxx"` (recommended, also supports `uk_xxx`)
  - or `export SSD_TOKEN="your_jwt_token"`
- Windows PowerShell:
  - `$env:SSD_API_KEY="sk_xxx"` (recommended, also supports `uk_xxx`)
  - or `$env:SSD_TOKEN="your_jwt_token"`

If `up` reports `status 401` or `status 403`:

- If using API key (`sk_...` or `uk_...`): key is invalid/revoked or lacks permission.
- If using JWT: token is invalid/expired or lacks permission.
- Set a new credential again using the commands above.

Note:

- Upload endpoints support API key or JWT.
- The signed download link endpoint requires JWT. If you upload with API key, `up` prints `File ID` after upload completion.
