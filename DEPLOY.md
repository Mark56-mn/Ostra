# Ostra v0.2 — Vercel Production Deployment Guide

This guide walks through deploying Ostra v0.2 to Vercel production.

## Prerequisites

- GitHub repository with Ostra code
- Vercel account (free tier works)
- (Optional) A provider API key for a live model

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

> **First deploy uses mock mode** — no provider key needed yet.

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
     "model": "ostra-mock-1",
     "endpointConfigured": false
   }
   ```
4. Send a test message in the chat — Ostra should reply with a mock response

---

## Step 3: Choose and Configure a Provider

Go to **Project Settings → Environment Variables** in Vercel.

### Option A: Groq (recommended for speed + generous free tier)

```
AI_PROVIDER=groq
GROQ_API_KEY=your-groq-api-key
```

Get a key at [console.groq.com/keys](https://console.groq.com/keys).

### Option B: OpenRouter (largest free model catalog)

```
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your-openrouter-key
```

Get a key at [openrouter.ai/keys](https://openrouter.ai/keys).

### Option C: Mistral

```
AI_PROVIDER=mistral
MISTRAL_API_KEY=your-mistral-key
```

Get a key at [console.mistral.ai/api-keys](https://console.mistral.ai/api-keys).

### Option D: NVIDIA NIM

```
AI_PROVIDER=nvidia
NVIDIA_API_KEY=your-nvidia-key
```

Get a key at [build.nvidia.com](https://build.nvidia.com).

### Option E: Google Gemini

```
AI_PROVIDER=gemini
GEMINI_API_KEY=your-gemini-key
```

Get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

### Option F: Custom endpoint (Kaggle, VPS, etc.)

```
AI_PROVIDER=custom
AI_API_KEY=your-endpoint-key
AI_BASE_URL=https://your-endpoint.com/v1
MODEL_TIMEOUT_MS=60000
```

### Option G: Legacy mode (still supported)

```
MODEL_MODE=http
MODEL_API_URL=https://your-endpoint.com/chat/completions
MODEL_API_KEY=your-key
MODEL_NAME=ostra-experimental
```

### Environment scoping

Set variables for each environment:
- **Production** — live deployment
- **Preview** — PR/branch deployments
- **Development** — local dev (use `.env.local` instead)

---

## Step 4: Switch to Live Provider

1. Update `AI_PROVIDER` to your chosen provider
2. Add the corresponding API key
3. Redeploy (or trigger a new deployment via Vercel dashboard)

---

## Step 5: Verify Production Deployment

1. Check health endpoint:
   ```bash
   curl https://your-app.vercel.app/api/health
   ```
   Should show `"mode": "live"` and `"endpointConfigured": true`

2. Test chat functionality:
   - Send a message in the UI
   - Verify Ostra responds from your provider
   - Check conversation persists in browser (localStorage)

3. Monitor Vercel logs:
   - Go to **Project → Logs**
   - Check for any `[ostra:*]` error messages
   - Verify model requests are reaching your provider

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
- [ ] Live provider responds (not just mock)
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
2. Verify `AI_PROVIDER` is set to a valid provider
3. Verify the API key is correct and has quota remaining
4. Check Vercel logs for `[ostra:chat]` error messages
5. Try switching to a different provider to isolate the issue

### Environment variables not working

1. Verify variables are set in **Production** scope (not just Preview)
2. Redeploy after changing environment variables
3. Check variable names match exactly (case-sensitive)
4. Only the active provider's key is needed — others can be left unset

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
│  │  - Provider Gateway                              │  │
│  │    ├── OpenRouter adapter                        │  │
│  │    ├── Groq adapter                              │  │
│  │    ├── Mistral adapter                           │  │
│  │    ├── NVIDIA NIM adapter                        │  │
│  │    ├── Gemini adapter                            │  │
│  │    └── Custom / Legacy adapter                   │  │
│  └────────────────────┬─────────────────────────────┘  │
└───────────────────────┼─────────────────────────────────┘
                        │ HTTPS POST
┌───────────────────────▼─────────────────────────────────┐
│  Provider API (OpenRouter / Groq / Mistral / etc.)      │
│  - Not managed by Vercel                                │
│  - Hosts the AI model                                   │
│  - Returns JSON response                                │
└─────────────────────────────────────────────────────────┘
```

---

## Environment Variable Security

**Client-side (browser):** NEVER
- No provider API keys
- No model endpoints
- No server secrets

**Server-side (API routes only):**
- All `AI_*` variables
- All provider API keys
- All `MODEL_*` variables

The browser communicates ONLY with Ostra's `/api/*` routes, which proxy requests to the provider.
Secrets stay on the server.

---

## Switching Providers

Changing the provider is an **environment variable change**, not a code change:

1. Update `AI_PROVIDER` to the new provider
2. Update the corresponding API key
3. Redeploy

No code changes required. The provider gateway handles all differences automatically.
