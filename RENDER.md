# Deploying the server on Render

Follow these steps to get your NestJS backend (Postgres + Redis) running on [Render](https://render.com).

---

## 1. Create a new Web Service

1. Go to [dashboard.render.com](https://dashboard.render.com) and sign in (GitHub is fine).
2. Click **New +** → **Web Service**.
3. Connect your **server repo** (the one that contains this NestJS app, not the client).
4. Use these settings:

   | Field              | Value                                                             |
   | ------------------ | ----------------------------------------------------------------- |
   | **Name**           | `live-auction-api` (or any name)                                  |
   | **Region**         | Pick one (e.g. Oregon)                                            |
   | **Branch**         | `main` (or your default branch)                                   |
   | **Root Directory** | Leave empty (repo root is the server)                             |
   | **Runtime**        | **Node**                                                          |
   | **Build Command**  | `npm ci && npx prisma generate && npm run build`                  |
   | **Start Command**  | `npm run build && npx prisma migrate deploy && node dist/main.js` |

5. **Don’t** create the service yet; add the database and Redis first (steps 2 and 3), then set env vars (step 4).

---

## 2. Add PostgreSQL

1. In the same Render project/account: **New +** → **PostgreSQL**.
2. Set:
   - **Name**: e.g. `live-auction-db`
   - **Database**, **User**: leave default (or set your own).
   - **Region**: same as the web service.
   - **Plan**: Free (or Basic if you prefer).
3. Create the database.
4. Open the new Postgres service → **Info** (or **Connect**) and copy:
   - **Internal Database URL** (use this for the web service so it stays on Render’s network).

You’ll use this as `DATABASE_URL` in the next step.

---

## 3. Add Redis

**Option A – Render Redis**  
New + → Redis (Key Value) → create, then copy the **Internal Redis URL** and use it as `REDIS_URL`.

**Option B – Upstash Redis**  
This app uses **ioredis**, which needs a **Redis TCP URL**, not the REST API.

1. In [Upstash Console](https://console.upstash.com), open your Redis database.
2. Click **Redis Connect** (or **Connect**) and open the **Node** / **ioredis** tab.
3. Copy the **Redis URL**. It looks like: `rediss://default:YOUR_PASSWORD@able-molly-42001.upstash.io:6379`  
   (Use this exact value as `REDIS_URL` on Render. Do **not** use `UPSTASH_REDIS_REST_URL` or the REST token — those are for the REST API only.)

---

## 4. Set environment variables on the Web Service

Open your **Web Service** (the Node one) → **Environment** tab and add:

| Key                | Value                                         | Notes                                                       |
| ------------------ | --------------------------------------------- | ----------------------------------------------------------- |
| `DATABASE_URL`     | _(paste Internal Database URL from Postgres)_ | Required                                                    |
| `REDIS_URL`        | _(paste Internal Redis URL from Redis)_       | Required                                                    |
| `CORS_ORIGIN`      | `https://your-client-domain.vercel.app`       | Your Expo web or client URL; use `*` only for quick testing |
| `AGORA_APP_ID`     | _(your Agora app ID)_                         | Optional                                                    |
| `AGORA_APP_CERT`   | _(your Agora cert)_                           | Optional                                                    |
| `CLERK_SECRET_KEY` | _(from Clerk Dashboard → API Keys)_           | Required for Clerk auth; needed for `/users/sync`           |

- Render sets **`PORT`** for you; the app already uses `process.env.PORT`.
- Do **not** commit real URLs or secrets to Git; set them only in Render.

---

## 5. Deploy

1. Save the environment variables.
2. Click **Manual Deploy** → **Deploy latest commit** (or push a commit to trigger a deploy).
3. Wait for the build to finish. Build runs: `npm ci`, `prisma generate`, `npm run build`. Then start runs: `prisma migrate deploy`, `npm run start:prod`.

---

## 6. Get your API URL

- In the Web Service, open **Settings** → **Domains**. You’ll see something like:
  - `https://live-auction-api.onrender.com`
- Use this as your **backend URL** for the client:
  - In the client repo set `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_SOCKET_URL` to this URL (no path, e.g. `https://live-auction-api.onrender.com`).

---

## 7. Optional: Health check

If you add a simple health route (e.g. `GET /` returning 200), you can set **Health Check Path** in the Web Service to `/` so Render can do zero-downtime deploys. Your app already has a root route; if it returns 200, use `/` as the health check path in Render.

---

## Troubleshooting

- **Build fails on `prisma generate`**  
  Ensure `DATABASE_URL` is set (can be a placeholder during build; Prisma only needs it for migrate at start). If your Prisma version requires a URL at generate time, use the same Postgres URL.

- **App crashes at start**  
  Check **Logs** in Render. Typical causes: wrong `DATABASE_URL` or `REDIS_URL`, or migrations failing. Fix env vars and redeploy.

- **CORS errors from the client**  
  Set `CORS_ORIGIN` to the exact origin of your client (e.g. `https://your-app.vercel.app`). No trailing slash.

- **Free tier spin-down**  
  On the free plan, the web service may sleep after inactivity. The first request after that can be slow; subsequent requests are fast until it sleeps again.
