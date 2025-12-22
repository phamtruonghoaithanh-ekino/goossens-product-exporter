# Vercel Deployment Plan — Embedded Shopify App (Upstash Redis)

**Date:** December 22, 2025

This document describes the detailed implementation plan to deploy the embedded Shopify app to Vercel using Upstash Redis for session storage, removing Prisma/SQLite dependencies, and keeping the app embedded inside Shopify Admin.

## Goals

- Replace Prisma session storage with Upstash Redis
- Remove Prisma and SQLite from the project
- Keep app embedded in Shopify Admin using App Bridge
- Configure Vercel deployment (serverless) and provide exact code changes
- Provide environment variables and deployment steps

## High-level Choices

- **Session storage:** `@shopify/shopify-app-session-storage-redis` (Upstash)
- **File exports/history:** Removed (can be added later with Vercel Blob/S3)

---

## Files Modified

### 1. `app/shopify.server.js`

**Changes:** Switch from Prisma to Redis session storage

**Before:**

```javascript
import "@shopify/shopify-app-react-router/adapters/node";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

const shopify = shopifyApp({
  // ...
  sessionStorage: new PrismaSessionStorage(prisma),
  // ...
});
```

**After:**

```javascript
import "@shopify/shopify-app-react-router/adapters/vercel";
import { RedisSessionStorage } from "@shopify/shopify-app-session-storage-redis";

const sessionStorage = new RedisSessionStorage(
  process.env.UPSTASH_REDIS_REST_URL,
  {
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  },
);

const shopify = shopifyApp({
  // ...
  sessionStorage,
  // ...
});
```

---

### 2. `app/routes/webhooks.app.uninstalled.jsx`

**Changes:** Remove Prisma, use Redis session storage

**Before:**

```javascript
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
```

**After:**

```javascript
import { authenticate, sessionStorage } from "../shopify.server";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  if (session) {
    try {
      await sessionStorage.deleteSession(session.id);
    } catch (e) {
      console.warn("Failed to delete session from Redis", e);
    }
  }

  return new Response();
};
```

---

### 3. `app/routes/webhooks.app.scopes_update.jsx`

**Changes:** Update session in Redis instead of Prisma

**Before:**

```javascript
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);
  const current = payload.current;

  if (session) {
    await db.session.update({
      where: { id: session.id },
      data: { scope: current.toString() },
    });
  }

  return new Response();
};
```

**After:**

```javascript
import { authenticate, sessionStorage } from "../shopify.server";

export const action = async ({ request }) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);
  const current = payload.current;

  if (session) {
    session.scope = current.toString();
    await sessionStorage.storeSession(session);
  }

  return new Response();
};
```

---

### 4. `app/routes/app._index.jsx`

**Changes:** Remove export history feature (database dependency)

- Remove Prisma import and usage
- Simplify loader to not query database
- Remove history UI and download functionality
- Keep core export functionality (file processing)

---

### 5. `vite.config.js`

**Changes:** Add Vercel URL handling

Add near the top of the file:

```javascript
// Set SHOPIFY_APP_URL from Vercel URL if not explicitly set
if (process.env.VERCEL_URL && !process.env.SHOPIFY_APP_URL) {
  process.env.SHOPIFY_APP_URL = `https://${process.env.VERCEL_URL}`;
}
```

---

### 6. `package.json`

**Dependencies to REMOVE:**

- `@prisma/client`
- `@shopify/shopify-app-session-storage-prisma`
- `prisma`

**Dependencies to ADD:**

- `@shopify/shopify-app-session-storage-redis`

**Scripts to REMOVE:**

- `"docker-start": "npm run setup && npm run start"`
- `"setup": "prisma generate && prisma migrate deploy"`
- `"prisma": "prisma"`

---

## Files Created

### 1. `vercel.json` (project root)

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "build",
  "framework": null,
  "installCommand": "npm install",
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/api/server"
    }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "X-Frame-Options",
          "value": "ALLOWALL"
        },
        {
          "key": "Content-Security-Policy",
          "value": "frame-ancestors https://*.myshopify.com https://admin.shopify.com"
        }
      ]
    }
  ]
}
```

---

### 2. `api/server.js` (Vercel serverless function entry)

```javascript
import { createRequestHandler } from "@react-router/vercel";

export default createRequestHandler({
  build: () => import("../build/server/index.js"),
});

export const config = {
  runtime: "nodejs",
  maxDuration: 30,
};
```

---

### 3. `react-router.config.ts` (project root)

```typescript
import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  serverBuildFile: "index.js",
} satisfies Config;
```

---

## Files Deleted

- `app/db.server.js` — Prisma client export (no longer needed)
- `prisma/` — Entire folder (schema, migrations)
- `Dockerfile` — Not needed for Vercel deployment

---

## Environment Variables (Vercel Dashboard)

Set these in Vercel Project Settings → Environment Variables:

| Variable                   | Description                    | Example                       |
| -------------------------- | ------------------------------ | ----------------------------- |
| `SHOPIFY_API_KEY`          | Shopify app API key            | `abc123...`                   |
| `SHOPIFY_API_SECRET`       | Shopify app API secret         | `shpss_xxx...`                |
| `SCOPES`                   | OAuth scopes (comma-separated) | `write_products`              |
| `SHOPIFY_APP_URL`          | Your Vercel deployment URL     | `https://your-app.vercel.app` |
| `UPSTASH_REDIS_REST_URL`   | Upstash Redis REST URL         | `https://xxx.upstash.io`      |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token       | `AXxxxx...`                   |
| `SHOP_CUSTOM_DOMAIN`       | (Optional) Custom shop domain  |                               |

---

## Pre-deployment Setup

### 1. Create Upstash Redis Database

1. Go to [upstash.com](https://upstash.com) and create a free account
2. Create a new Redis database (choose region closest to your users)
3. Copy the **REST URL** and **REST Token** from the dashboard
4. Save these for Vercel environment variables

### 2. Get Shopify App Credentials

Since this is a Custom App for a single Shopify Plus store:

1. Go to **Shopify Admin → Settings → Apps and sales channels → Develop apps**
2. Click **Create an app**
3. Configure Admin API scopes: `write_products`
4. Install the app to your store
5. Copy the **API key** and **API secret key**

---

## Deployment Steps

### Step 1: Apply Code Changes

Run the implementation (all files listed above are modified/created/deleted).

### Step 2: Update Dependencies

```bash
npm install
```

This will install the new Redis session storage package and remove Prisma dependencies.

### Step 3: Push to Git Repository

```bash
git add .
git commit -m "Migrate to Vercel deployment with Upstash Redis"
git push origin main
```

### Step 4: Connect to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click **Add New → Project**
3. Import your Git repository
4. Vercel will auto-detect the React Router project

### Step 5: Configure Environment Variables

In Vercel Dashboard → Project Settings → Environment Variables, add all variables listed in the table above.

### Step 6: Deploy

Click **Deploy**. Vercel will build and deploy your app.

### Step 7: Update Shopify App URLs

After deployment, get your Vercel URL (e.g., `https://your-app.vercel.app`):

1. Update `shopify.prod-app.toml`:
   - Set `application_url` to your Vercel URL
   - Update `redirect_urls` to include your Vercel domain
2. Run `npm run deploy` to sync with Shopify Partner Dashboard
3. Or manually update in Shopify Admin → Apps → Your App → Configuration

---

## Testing Checklist

- [ ] App loads in Shopify Admin (embedded)
- [ ] Authentication flow works (session tokens validated)
- [ ] File upload and export processing works
- [ ] Webhooks are received (check Vercel function logs)
- [ ] No console errors related to missing Prisma

---

## Notes and Caveats

1. **Export History Removed:** The current implementation removes the export history feature since it relied on storing binary file data in SQLite. To re-add this feature:
   - Use Vercel Blob Storage or AWS S3 for files
   - Store metadata only in Redis or add Vercel Postgres

2. **Session Token Validation:** The app still requires session storage for validating App Bridge JWT tokens, even though it's a Custom App for a single store.

3. **Cold Starts:** Vercel serverless functions may experience cold starts. Consider upgrading to Vercel Pro for improved performance if needed.

4. **Redis Session TTL:** Configure appropriate TTL in Redis to match Shopify session expiration.

---

## Rollback Plan

If deployment fails:

1. Keep the original code in a separate branch (`git checkout -b pre-vercel-migration`)
2. Continue using Docker deployment with SQLite
3. Debug Vercel issues separately

---

## Future Enhancements

1. **Add Vercel Blob Storage** for export history files
2. **Enable webhooks** by uncommenting webhook configuration in TOML files
3. **Add monitoring** with Vercel Analytics or external service
4. **Connection pooling** for Redis if experiencing performance issues

---

## Support Resources

- [Vercel Documentation](https://vercel.com/docs)
- [Upstash Redis Documentation](https://docs.upstash.com/redis)
- [Shopify App Development](https://shopify.dev/docs/apps)
- [React Router v7 Documentation](https://reactrouter.com)

---

**End of Deployment Plan**
