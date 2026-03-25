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

## Linux ELF uploader (`up`)

Build binary ELF (from Windows, cross-compile for Linux):

```powershell
$env:GOOS="linux"; $env:GOARCH="amd64"; go build -ldflags="-s -w" -o bin/up ./scripts/up/main.go
```

Copy to Linux server and make it executable:

```bash
chmod +x ./up
sudo mv ./up /usr/local/bin/up
```

Shortest upload command (set token by command):

```bash
SSD_TOKEN="your_jwt_token" up ./your-file.zip
```

Optional env:

- `SSD_BASE_URL` (default: `https://ssdcloud.net`)

CLI output:

- Real-time upload percent (`Upload: xx.xx%`)
- File link after success (`Link: https://...`)
