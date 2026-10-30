# Personal AI Shorts Editor — Standalone FFmpeg Cloud Worker

This folder contains the real, long-running native `ffmpeg` worker server used by **Cloud Background Rendering** mode.

- **Vercel / Next.js** handles UI, short API calls, presigned URLs, and job metadata.
- **Cloudflare R2** stores private uploaded media, pre-rendered Bengali/English caption PNGs, and completed MP4 files (short-lived signed URLs only, zero public buckets).
- **Cloudflare D1** persists job state (`QUEUED`, `UPLOADING`, `ANALYZING`, `PLANNING`, `RENDERING`, `COMPLETED`, `FAILED`, `CANCELLED`) independently of browser sessions.
- **Cloudflare Queues** dispatches jobs to this worker via HTTP Pull Consumer.
- **Zero Gemini API Keys**: The AI Edit Decision List (EDL) is generated and validated *before* queueing. This worker never receives or requires your Gemini API key.

## 1. Cloudflare Resources Setup

1. **Private R2 Bucket**:
   - Create a private bucket (e.g. `ai-shorts-private`) — keep Public Access **Disabled**.
   - Add a Bucket CORS rule allowing `PUT` and `GET` from your Vercel app URL (with Allowed Headers `*` and MaxAgeSeconds `3600`) so your browser can upload raw clips directly to R2 via short-lived presigned URLs.
   - Generate an R2 S3 API Token with Object Read & Write permissions on that bucket (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`).

2. **Cloudflare D1 Database**:
   - Create a D1 database (e.g. `ai-shorts-jobs`) and copy its UUID (`CF_D1_DATABASE_ID`). Tables (`render_jobs`, `worker_heartbeats`) are created automatically on first connection.

3. **Cloudflare Queue (HTTP Pull Enabled)**:
   - Create a Queue (e.g. `ai-shorts-render-queue`), enable **HTTP Pull Consumer** in Queue settings, and copy the Queue ID (`CF_QUEUE_ID`).
   - Create a Cloudflare API Token (`CF_API_TOKEN`) with **D1:Edit** and **Queues:Edit** permissions on your `CF_ACCOUNT_ID`.

## 2. Run the Long-Running FFmpeg Worker

You can run `cloud-worker` on any Linux VPS, home server, Railway, Render Background Worker, or Fly.io container:

```bash
docker build -t ai-shorts-ffmpeg-worker ./cloud-worker

docker run -d --restart unless-stopped \
  -p 8080:8080 \
  -e CF_ACCOUNT_ID="..." \
  -e CF_API_TOKEN="..." \
  -e CF_D1_DATABASE_ID="..." \
  -e CF_QUEUE_ID="..." \
  -e R2_ACCOUNT_ID="..." \
  -e R2_ACCESS_KEY_ID="..." \
  -e R2_SECRET_ACCESS_KEY="..." \
  -e R2_BUCKET_NAME="ai-shorts-private" \
  ai-shorts-ffmpeg-worker
```

Once running, open **API Keys & Settings → Cloud Render** in the web app and click **Verify Cloud Infrastructure** to confirm live R2, D1, Queue, and Worker Heartbeat connectivity.
