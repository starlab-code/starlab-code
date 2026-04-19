# Starlab Code

Starlab Code is a coding practice platform for teachers and students.

- Teachers can create problems, assign them to classes, and monitor submissions.
- Students can sign up, join a class, solve problems, and submit Python code.
- The frontend is a Vite + React app.
- The backend is a FastAPI + SQLModel app.
- Local development uses SQLite by default.
- Deployment is prepared for Cloudflare Pages + Render Free + Supabase Postgres.

## Current Structure

```text
starlab-code/
|-- backend/
|   |-- app/
|   |   |-- auth.py
|   |   |-- config.py
|   |   |-- db.py
|   |   |-- judge.py
|   |   |-- main.py
|   |   |-- models.py
|   |   `-- seed.py
|   |-- .env.example
|   |-- README.md
|   `-- requirements.txt
|-- frontend/
|   |-- public/
|   |-- src/
|   |-- .env.example
|   `-- package.json
|-- render.yaml
|-- DEPLOY_FREE.md
`-- README.md
```

## Features

- Student-only public sign-up
- Class selection or new class creation during sign-up
- Teacher demo account seed
- Problem list and problem solving
- Assignment creation by class
- Submission history and live submission feed
- Streaming judge responses with NDJSON
- 50 seeded problems

## Local Run

### 1. Backend

```powershell
cd backend
$env:PYTHONUTF8='1'
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

Backend URLs:

- API: `http://127.0.0.1:8000`
- Swagger: `http://127.0.0.1:8000/docs`
- Health check: `http://127.0.0.1:8000/health`

### 2. Frontend

```powershell
cd frontend
npm install
npm run dev
```

Frontend URL:

- App: `http://127.0.0.1:5173`

The frontend uses `VITE_API_BASE_URL`. If it is not set, it falls back to:

```text
http://127.0.0.1:8000
```

## Environment Variables

Backend example: [backend/.env.example](/C:/Users/fnzk2/Desktop/project-hamming/starlab-code/backend/.env.example:1)

Important backend variables:

- `STARLAB_SECRET_KEY`: JWT signing key
- `STARLAB_DATABASE_URL`: optional explicit DB URL
- `DATABASE_URL`: production-friendly DB URL fallback
- `STARLAB_ALLOW_ORIGINS`: comma-separated frontend origins
- `STARLAB_SEED_DEMO_DATA`: `true` or `false`

Frontend example: [frontend/.env.example](/C:/Users/fnzk2/Desktop/project-hamming/starlab-code/frontend/.env.example:1)

- `VITE_API_BASE_URL`: backend base URL

## Database Behavior

- Local default: SQLite at `backend/starlab_code_mvp.db`
- Production target: Supabase Postgres
- The backend automatically normalizes `postgres://...` and `postgresql://...` into the SQLAlchemy `psycopg` format

## Demo Data

When `STARLAB_SEED_DEMO_DATA=true`, startup seeds:

- `teacher_demo / demo1234`
- categories
- 50 problems

Student demo accounts are no longer seeded by default.

## Deployment

Recommended free deployment structure:

- Frontend: Cloudflare Pages
- Backend: Render Free Web Service
- Database: Supabase Free Postgres

Files added for that flow:

- [render.yaml](/C:/Users/fnzk2/Desktop/project-hamming/starlab-code/render.yaml:1)
- [DEPLOY_FREE.md](/C:/Users/fnzk2/Desktop/project-hamming/starlab-code/DEPLOY_FREE.md:1)
- [frontend/public/_redirects](/C:/Users/fnzk2/Desktop/project-hamming/starlab-code/frontend/public/_redirects:1)

Full deployment steps are documented in [DEPLOY_FREE.md](/C:/Users/fnzk2/Desktop/project-hamming/starlab-code/DEPLOY_FREE.md:1).

## Build

Frontend production build:

```powershell
cd frontend
npm run build
```

Backend syntax check:

```powershell
cd backend
python -m compileall app
```

## Notes

- Render Free can sleep after idle time, so the first request may be slow.
- Supabase Free has project and usage limits.
- The built-in judge still runs submitted Python code in subprocesses. This is fine for demos and internal testing, but it is not a hardened public sandbox.
