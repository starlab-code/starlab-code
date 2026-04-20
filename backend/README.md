# Starlab Code Backend

FastAPI backend for the Starlab Code project.

## Local Run

```powershell
$env:PYTHONUTF8='1'
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

The app uses SQLite locally by default. To use Postgres instead, set
`STARLAB_DATABASE_URL` or `DATABASE_URL`.

## Important Environment Variables

- `STARLAB_SECRET_KEY`: JWT signing secret.
- `STARLAB_DATABASE_URL`: database connection string.
- `STARLAB_ALLOW_ORIGINS`: comma-separated frontend origins.
- `STARLAB_PRIMARY_TEACHER_USERNAME`: username for the auto-seeded main teacher account.
- `STARLAB_PRIMARY_TEACHER_DISPLAY_NAME`: display name for the auto-seeded main teacher account.
- `STARLAB_PRIMARY_TEACHER_PASSWORD`: password for the auto-seeded main teacher account.
- `STARLAB_SEED_DEMO_DATA`: set to `false` to skip the default problem catalog seed.

## Deployment Notes

- Render free web services can sleep when idle, so the first request can be slow.
- Supabase Postgres is the recommended production database for this project.
- The main teacher account is automatically ensured on startup, so deployment creates it if it does not exist yet.
- The built-in judge executes submitted Python code in subprocesses. That is still
  not a hardened sandbox, so use care before opening the service to the public.
