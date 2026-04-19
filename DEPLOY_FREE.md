# Free Deployment Guide

Target stack:

- Frontend: Cloudflare Pages
- Backend: Render Free Web Service
- Database: Supabase Free Postgres

## 1. Prepare GitHub

1. Put this project in a GitHub repository.
2. Push the latest code.

Both Render and Cloudflare Pages will deploy from that repository.

## 2. Create Supabase

1. Sign in to Supabase.
2. Create a new project.
3. Wait until the database becomes ready.
4. Open `Connect`.
5. Copy the `Session pooler` connection string.

Use the session pooler string for Render because it works well for a long-lived
backend and supports IPv4 environments.

Example shape:

```text
postgresql://postgres.xxxxx:[PASSWORD]@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=require
```

## 3. Deploy Backend on Render

1. Sign in to Render.
2. Choose `New +` -> `Blueprint`.
3. Connect your GitHub repo.
4. Select this repository.
5. Render will detect [render.yaml](/C:/Users/fnzk2/Desktop/project-hamming/starlab-code/render.yaml).
6. Start the deploy.

After the service is created, open the service settings and set:

- `DATABASE_URL`: your Supabase Session pooler string
- `STARLAB_ALLOW_ORIGINS`: temporary value `http://localhost:5173`

Render will also generate `STARLAB_SECRET_KEY` automatically from `render.yaml`.

When the deploy finishes, confirm these URLs:

- `https://your-render-service.onrender.com/health`
- `https://your-render-service.onrender.com/`

`/health` should return `status: ok`.

## 4. Deploy Frontend on Cloudflare Pages

1. Sign in to Cloudflare.
2. Open `Workers & Pages`.
3. Choose `Create application` -> `Pages` -> `Import an existing Git repository`.
4. Connect the same GitHub repository.
5. Set:

- Root directory: `frontend`
- Build command: `npm run build`
- Build output directory: `dist`

6. Add environment variable:

- `VITE_API_BASE_URL=https://your-render-service.onrender.com`

7. Deploy.

Because this is a Vite single-page app, [frontend/public/_redirects](/C:/Users/fnzk2/Desktop/project-hamming/starlab-code/frontend/public/_redirects) is included so refreshes keep working on Pages.

## 5. Final CORS Update

After Cloudflare Pages gives you a production URL like
`https://starlab-code-frontend.pages.dev`, go back to Render and change:

- `STARLAB_ALLOW_ORIGINS=https://starlab-code-frontend.pages.dev`

If you also want local development to keep working, use:

```text
http://localhost:5173,http://127.0.0.1:5173,https://starlab-code-frontend.pages.dev
```

Save and redeploy the Render service.

## 6. First Production Check

1. Open the Cloudflare Pages URL.
2. Sign up as a student.
3. Log in with `teacher_demo / demo1234`.
4. Create an assignment.
5. Submit a solution from a student account.

## 7. Important Limits

- Render Free can sleep after idle time, so the first request can be slow.
- Supabase Free projects can be paused if inactive or if free limits are exceeded.
- This app still runs submitted Python code in subprocesses. It is better than
  SQLite-for-production, but it is not a fully hardened public code runner.
