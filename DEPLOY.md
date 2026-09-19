# Ostra v0 — Vercel Production Deployment Guide

This guide walks through deploying Ostra v0 to Vercel production.

## Prerequisites

- GitHub repository with Ostra code
- Vercel account (free tier works)
- (Optional) A running model endpoint (Kaggle, VPS, or OpenAI-compatible API)

---

## Step 1: Import Repository to Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Click **Import Git Repository**
3. Select your `Mark56-mn/Ostra` repository
4. Vercel auto-detects **Next.js** framework settings
5. Leave build settings as defaults:
   - **Build Command:** `next build` (auto-detected)
   - **Output Directory:** `.next` (auto-detected)
   - **Install Command:** `bun install`
6. Click **Deploy**

> **First deploy uses mock mode** — no model endpoint needed yet.

---

## Step 2: Verify Deployment

After the first deploy completes:

1. Visit your Vercel URL (e.g., `https://ostra.vercel.app`)
2. Open the app and confirm the chat interface loads
3. Check the health endpoint:
   ```
   https://your-app.vercel.app/api/health
   ```
   You should see:
   ```json
   {
     "status": "ok",
     "system": "ostra",
     "version": "0.1.0",
     "mode": "mock",
     "provider": "mock",
     "model": "ostra-experimental",
     "endpointConfigured": false
   }
   ```
4. Send a test message in the chat — Ostra should reply with a mock response

---

## Step 3: Configure Environment Variables

Go to **Project Settings → Environment Variables** in Vercel.

### Required for production (when using a real model):

| Variable | Value | Notes |
|----------|-------|-------|
| `MODEL_MODE` | `http` | Use `mock` for testing without a model |
| `MODEL_API_URL` | `https://your-endpoint.ngrok-free.app/generate` | Full URL to your model |
| `MODEL_API_KEY` | `your-api-key-here` | (Optional) Bearer token for the endpoint |

### Optional configuration:

| Variable | Value | Default |
|----------|-------|---------|
| `MODEL_NAME` | `ostra-experimental` | `ostra-experimental` |
| `MODEL_API_FORMAT` | `openai` or `simple` | `openai` |
| `MODEL_TIMEOUT_MS` | `45000` | `45000` |
| `OSTRA_MAX_MESSAGE_LENGTH` | `8000` | `8000` |
| `OSTRA_RATE_LIMIT_MAX` | `30` | `30` |
| `OSTRA_RATE_LIMIT_WINDOW` | `60` | `60` |

### Environment scoping

Set variables for each environment:
- **Production** — live deployment
- **Preview** — PR/branch deployments
- **Development** — local dev (use `.env.local` instead)

---

## Step 4: Connect Model Endpoint (Kaggle/VPS)

### Option A: Kaggle (Experimental)

1. Start your Kaggle notebook with the model endpoint
2. Expose via ngrok: `ngrok http 8000` (or your port)
3. Copy the ngrok URL (e.g., `https://abc123.ngrok-free.app`)
4. Add to Vercel:
   ```
   MODEL_MODE=http
   MODEL_API_URL=https://abc123.ngrok-free.app/generate
   ```
5. Redeploy (or trigger a new deployment)

### Option B: VPS / Dedicated Server

1. Deploy model on your VPS (vLLM, llama.cpp, or custom FastAPI)
2. Set up HTTPS (nginx reverse proxy + Let's Encrypt)
3. Add to Vercel:
   ```
   MODEL_MODE=http
   MODEL_API_URL=https://your-domain.com/v1/chat/completions
   MODEL_API_KEY=your-auth-token
   ```

### Option C: OpenAI-Compatible API

1. Get API key from OpenAI, Together AI, Groq, etc.
2. Add to Vercel:
   ```
   MODEL_MODE=http
   MODEL_API_URL=https://api.openai.com/v1/chat/completions
   MODEL_API_KEY=sk-your-openai-key
   MODEL_NAME=gpt-4o-mini
   ```

---

## Step 5: Verify Production Deployment

1. Check health endpoint:
   ```bash
   curl https://your-app.vercel.app/api/health
   ```
   Should show `"mode": "http"` and `"endpointConfigured": true`

2. Test chat functionality:
   - Send a message in the UI
   - Verify Ostra responds from your model endpoint
   - Check conversation persists in browser (localStorage)

3. Monitor Vercel logs:
   - Go to **Project → Logs**
   - Check for any `[ostra:*]` error messages
   - Verify model requests are reaching your endpoint

---

## Step 6: Custom Domain (Optional)

1. Go to **Project Settings → Domains**
2. Add your custom domain (e.g., `ostra.yourdomain.com`)
3. Configure DNS as instructed by Vercel
4. SSL certificate is automatic

---

## Production Checklist

- [ ] Deployment succeeds (no build errors)
- [ ] Health endpoint returns `status: "ok"`
- [ ] Chat interface loads and is responsive
- [ ] Mock mode works (or HTTP mode with real endpoint)
- [ ] API keys are NOT visible in browser (check Network tab)
- [ ] Error messages are user-friendly (no stack traces)
- [ ] Rate limiting is active (check `X-RateLimit-*` headers)
- [ ] Custom domain configured (if using one)

---

## Troubleshooting

### Build fails

1. Check Vercel build logs for errors
2. Run locally: `bun run build`
3. Common issues:
   - Missing dependencies (check `package.json`)
   - TypeScript errors (run `bun run typecheck`)

### Model not responding

1. Check health endpoint: `endpointConfigured` should be `true`
2. Verify `MODEL_API_URL` is correct and accessible
3. Check Vercel logs for `[ostra:chat]` error messages
4. Ensure your model endpoint accepts POST requests with JSON body

### Environment variables not working

1. Verify variables are set in **Production** scope (not just Preview)
2. Redeploy after changing environment variables
3. Check variable names match exactly (case-sensitive)

---

## Architecture Reference

```
┌─────────────────────────────────────────────────────────┐
│  Vercel (Next.js 15, Serverless)                       │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Browser                                         │  │
│  │  - Chat UI (React)                               │  │
│  │  - localStorage (conversations)                  │  │
│  │  - No secrets                                    │  │
│  └────────────────────┬─────────────────────────────┘  │
│                       │ POST /api/chat                  │
│  ┌────────────────────▼─────────────────────────────┐  │
│  │  Server (API Route)                              │  │
│  │  - Validation + Rate Limiting                    │  │
│  │  - Agent Runtime                                 │  │
│  │  - Model Provider (http mode)                    │  │
│  │  - Environment: MODEL_API_URL, MODEL_API_KEY     │  │
│  └────────────────────┬─────────────────────────────┘  │
└───────────────────────┼─────────────────────────────────┘
                        │ HTTPS POST
┌───────────────────────▼─────────────────────────────────┐
│  Model Endpoint (Kaggle / VPS / OpenAI)                 │
│  - Not managed by Vercel                                │
│  - Hosts the AI model                                   │
│  - Returns JSON response                                │
└─────────────────────────────────────────────────────────┘
```

---

## Environment Variable Security

**Client-side (browser):** NEVER
- No `MODEL_API_URL`
- No `MODEL_API_KEY`
- No server secrets

**Server-side (API routes only):**
- All `MODEL_*` variables
- All `OSTRA_*` configuration

The browser communicates ONLY with Ostra's `/api/*` routes, which proxy requests to the model endpoint. Secrets stay on the server.

---

## Updating the Model

Changing the model is an **environment variable change**, not a code change:

1. Update `MODEL_API_URL` to new endpoint
2. Update `MODEL_API_KEY` if authentication changes
3. Update `MODEL_NAME` to reflect new model
4. Redeploy

No code changes required. The model adapter abstraction handles all differences.

---

## Next Steps (After v0)

- [ ] Add authentication (Convex Auth or NextAuth)
- [ ] Persistent conversation storage (Postgres/Supabase)
- [ ] Persistent memory system
- [ ] Tool calling framework
- [ ] Task queue and scheduler
- [ ] Rate limiting with Redis
- [ ] Admin dashboard
