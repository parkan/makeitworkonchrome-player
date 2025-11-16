# Deployment Guide

## Quick Start

**One-command deployment:**
```bash
cd /builder
./deploy-to-railway.sh
```

This script automates the entire Railway deployment process including CLI installation, login, project setup, and environment configuration.

## Overview

This HLS Generator Server generates dynamic HLS playlists from pre-processed video clips stored in Cloudflare R2. Each session creates a unique playlist with randomized clip selection.

## Prerequisites

- Cloudflare R2 bucket with clips uploaded
- Railway account (or any Node.js hosting platform)
- rclone configured for R2 access

## Step 1: Upload Clips to R2

**Run from host machine (outside container):**

```bash
cd /builder
chmod +x upload-to-r2.sh
./upload-to-r2.sh
```

This uploads:
- **Trimmed clips**: ~903MB (phrase clips from source video)
- **Static clips**: ~322MB (fallback word/punctuation clips)
- **Total**: ~1.2GB

Upload structure on R2:
```
infamous-men/
├── hls_clips/
│   ├── trimmed/
│   │   └── *.ts (phrase clips)
│   └── static/
│       └── *.ts (word/punctuation clips)
```

## Step 2: Configure R2 Public Access

1. Go to Cloudflare Dashboard: https://dash.cloudflare.com
2. Navigate to: R2 → infamous-men → Settings → Public Access
3. Enable "Allow Access"
4. Note your public URL: `https://pub-166474990ea24709a41c8e491c22ddfe.r2.dev`

## Step 3: Deploy to Railway

### Option A: Using Railway CLI (Recommended)

**Install Railway CLI:**
```bash
# macOS/Linux
curl -fsSL https://railway.app/install.sh | sh

# Or via npm
npm install -g @railway/cli
```

**Deploy from command line:**
```bash
# 1. Navigate to player directory
cd /builder/player

# 2. Login to Railway (opens browser)
railway login

# 3. Initialize new Railway project
railway init

# 4. Set environment variables
railway variables --set R2_BASE_URL=https://pub-166474990ea24709a41c8e491c22ddfe.r2.dev

# 5. Deploy!
railway up

# 6. Get deployment URL
railway status
```

After deployment completes, Railway will output your app URL: `https://your-app.railway.app`

**Manage deployment:**
```bash
# View logs
railway logs

# Redeploy after changes
railway up

# Open project in browser
railway open

# Link to existing project
railway link
```

### Option B: Using Railway Dashboard

1. Go to https://railway.app
2. Click "New Project" → "Deploy from GitHub repo"
3. Or "Deploy from local" and upload `/builder/player/` directory
4. Railway auto-detects Node.js
5. Set environment variables in dashboard:
   - `R2_BASE_URL` = `https://pub-166474990ea24709a41c8e491c22ddfe.r2.dev`
6. Click "Deploy"

### Files to Deploy

Deploy the entire `/builder/player/` directory containing:
- `hls-generator-server.js` - Main server
- `clips-manifest.json` - Clip metadata (~2.5MB)
- `package.json` - Dependencies
- `index.html`, `generate.html` - Frontend
- `*.js`, `*.css` - Frontend assets

### Environment Variables

Required:
```bash
R2_BASE_URL=https://pub-166474990ea24709a41c8e491c22ddfe.r2.dev
```

Optional (Railway sets automatically):
```bash
PORT=3001
```

### Railway Configuration

The `package.json` already includes the correct start script:
```json
{
  "scripts": {
    "start": "node hls-generator-server.js"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

Railway will automatically:
1. Detect Node.js project
2. Run `npm install`
3. Execute `npm start`

## Step 4: Test Deployment

### API Endpoints

**Generate Playlist:**
```bash
curl -X POST https://your-app.railway.app/generate
```

Response:
```json
{
  "sessionId": "abc123...",
  "playlistUrl": "/abc123....m3u8",
  "stats": {
    "totalTokens": 1065,
    "matchedPhrases": 653,
    "totalClips": 1065,
    "phraseClips": 653,
    "staticClips": 412,
    "totalDuration": 245.3
  }
}
```

**Get Playlist:**
```bash
curl https://your-app.railway.app/{sessionId}.m3u8
```

**Health Check:**
```bash
curl https://your-app.railway.app/health
```

### Frontend

Access the web interface at:
- `https://your-app.railway.app/` - Main player
- `https://your-app.railway.app/generate.html` - Generator UI

## Architecture

### Request Flow

1. Client POSTs to `/generate`
2. Server generates playlist from fixed text + manifest
3. Server returns sessionId and playlistUrl
4. Client fetches M3U8 playlist
5. HLS player streams clips from R2

### Clip Resolution

With `R2_BASE_URL` set, clips resolve to:
```
Phrase clips: https://pub-166474990ea24709a41c8e491c22ddfe.r2.dev/hls_clips/trimmed/{filename}
Static clips: https://pub-166474990ea24709a41c8e491c22ddfe.r2.dev/hls_clips/static/{filename}
```

Without `R2_BASE_URL` (local development):
```
Phrase clips: /hls_clips/trimmed/{filename}
Static clips: /hls_clips/static/{filename}
```

## Manifest Structure

The `clips-manifest.json` contains:
- `phraseMap`: All available phrases (3,111 phrases)
- `phraseClips`: Phrase-to-clip mappings (2,335 phrases with clips)
- `staticClips`: Fallback clips for unmatched words/punctuation
- `fixedText`: Source text for playlist generation
- `fixedTokens`: Pre-tokenized text for consistency

## Session Management

- Sessions stored in-memory (Map)
- TTL: 1 hour (configurable via `CONFIG.sessionTTL`)
- Cleanup interval: 5 minutes
- For production: Consider Redis for distributed sessions

## Troubleshooting

### Clips not loading

1. Verify R2_BASE_URL is set correctly
2. Check R2 bucket has public access enabled
3. Verify CORS headers are working (test in browser console)
4. Check Railway logs for errors

### Playback issues

1. Verify HLS.js is loading (check browser console)
2. Test playlist URL directly: `curl {playlistUrl}`
3. Check M3U8 structure has `#EXT-X-DISCONTINUITY` tags
4. Verify clip URLs are accessible

### Server errors

1. Check Railway logs: `railway logs`
2. Verify manifest loaded successfully (startup logs)
3. Check memory usage (manifest is ~2.5MB)
4. Verify Node.js version >=18

## Custom Domain (Optional)

Instead of R2's default domain, you can configure a custom domain:

1. In Cloudflare: R2 → infamous-men → Settings → Custom Domains
2. Add domain (e.g., `clips.yourdomain.com`)
3. Update `R2_BASE_URL` environment variable in Railway
4. Redeploy

## Monitoring

Track these metrics:
- Active sessions: `GET /health` → `sessions` field
- Server uptime: `GET /health` → `uptime` field
- Error logs in Railway dashboard
- R2 bandwidth usage in Cloudflare dashboard

## Cost Estimates

**Cloudflare R2:**
- Storage: ~1.2GB = ~$0.015/month
- Bandwidth: First 10GB free, then $0.36/TB
- Requests: 1M reads free, then $0.36/million

**Railway:**
- Free tier: 500 hours/month, $5 credit
- Pro: $5/month + usage
- Typical usage: ~$0-10/month depending on traffic

## Security Notes

- No authentication on generate endpoint (add if needed)
- CORS enabled for all origins (restrict if needed)
- Sessions in-memory (no persistence)
- Manifest contains source text (consider if sensitive)

## Future Improvements

- [ ] Add Redis for distributed sessions
- [ ] Implement authentication/rate limiting
- [ ] Add CDN caching for manifest
- [ ] Support custom text input (not just fixed text)
- [ ] Add analytics/metrics collection
- [ ] Implement clip preloading optimization
