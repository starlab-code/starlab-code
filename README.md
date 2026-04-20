# Starlab Code

중·고등학생 대상 알고리즘 문제 풀이 · 수업 운영 플랫폼 MVP.
선생님은 문제를 만들고 반 단위로 과제를 배정하며 실시간 제출을 모니터링하고,
학생은 문제를 풀면서 테스트케이스별 채점 진행을 실시간으로 확인할 수 있습니다.

---

## 목차

1. [주요 기능](#주요-기능)
2. [기술 스택](#기술-스택)
3. [디렉터리 구조](#디렉터리-구조)
4. [파일별 상세 설명](#파일별-상세-설명)
5. [프론트엔드 뷰 구조](#프론트엔드-뷰-구조)
6. [빠른 실행 (로컬)](#빠른-실행-로컬)
7. [환경변수](#환경변수)
8. [주요 API 라우트](#주요-api-라우트)
9. [데이터 모델 요약](#데이터-모델-요약)
10. [시드 데이터](#시드-데이터)
11. [아키텍처 메모](#아키텍처-메모)
12. [데모 계정](#데모-계정)
13. [배포 가이드](#배포-가이드)
14. [알려진 한계와 후속 작업](#알려진-한계와-후속-작업)

---

## 주요 기능

- **역할 기반 인증**: 학생 / 선생님 / 메인 선생님(primary_teacher) 3단계 위계, JWT 기반 세션
- **계정 관리 탭 분리**: 선생님 전용 `계정 관리` 화면에서 선생님·학생 서브탭으로 분리 관리
- **문제은행**: 10개 알고리즘 분류 + 난이도(입문 / 기초 / 중급) 필터, solved.ac 풍 티어 색상
- **대규모 문제 카탈로그**: 기본 시드 **100문제 × 테스트케이스 50개 = 5,000케이스** 자동 생성
- **문제 생성·수정**: 10~50개 테스트케이스 강제, `===` / `@@` 구분자로 대량 입력 지원
- **Python 채점기**: 정답 / 오답 / 런타임 에러 / 시간 초과를 테스트케이스 단위로 판정
- **스트리밍 채점**: NDJSON으로 테스트별 결과를 실시간 전달 → 프론트에서 % 프로그레스 바로 표시
- **동시 채점 제한**: `STARLAB_JUDGE_CONCURRENCY` 로 파이썬 서브프로세스 동시 실행 수 제어
- **리소스 가드**: 코드·입력·출력 바이트 상한 + CPU 초/메모리(리눅스) 제한
- **반 단위 과제 배정**: 문제 + 반 선택만으로 반 학생 전원에게 일괄 배정
- **반별 진행 현황**: 완료율 막대 + 클릭 시 학생별 제출 상세 드릴다운
- **학생 대시보드**: 30일 활동 히트맵, 난이도·분류별 숙련도 바, 추천 문제
- **선생님 대시보드**: 오늘 제출 / 정답률 / 활동 학생, 30일 학급 활동, 이번 주 활약 학생
- **실시간 제출 피드**: 4초 주기 폴링 + 신규 행 하이라이트

## 기술 스택

| 계층 | 사용 기술 |
| --- | --- |
| 프론트엔드 | React 18, TypeScript 5.6, Vite 5 |
| 백엔드 | FastAPI, SQLModel, Uvicorn |
| DB | SQLite (로컬, WAL 모드) / PostgreSQL (Supabase 권장, 운영) |
| 인증 | JWT (HS256) + pbkdf2_sha256 패스워드 해시 |
| 채점 | `subprocess` 기반 Python 실행 (POSIX 에서는 rlimit 사용) |

---

## 디렉터리 구조

```
starlab-code/
├── README.md                       이 문서
├── DEPLOY_FREE.md                  Render + Cloudflare Pages + Supabase 무료 배포 가이드
├── render.yaml                     Render 블루프린트 (백엔드 배포 설정)
├── .gitignore
├── backend/                        FastAPI + SQLModel
│   ├── README.md                   백엔드 단독 메모
│   ├── requirements.txt            파이썬 의존성 명세
│   ├── starlab_code_mvp.db         SQLite 파일 (최초 실행 시 자동 생성, .gitignore 대상)
│   ├── .gitignore
│   └── app/
│       ├── main.py                 FastAPI 엔트리 · 모든 라우트 정의
│       ├── models.py               SQLModel 테이블 + 요청/응답 스키마
│       ├── config.py               환경변수 기반 Settings 데이터클래스
│       ├── db.py                   엔진·세션 팩토리, SQLite PRAGMA, 스키마 마이그레이션
│       ├── auth.py                 패스워드 해시, JWT 발급/검증, 의존성
│       ├── judge.py                Python 서브프로세스 채점기 (run_code_iter 포함)
│       └── seed.py                 분류·문제 100개·테스트케이스·데모 계정 시드
└── frontend/                       React 18 + TypeScript + Vite
    ├── index.html                  Vite 진입 HTML
    ├── package.json                의존성 및 스크립트
    ├── tsconfig.json               TS 설정 루트
    ├── tsconfig.app.json           앱 코드용 TS 설정
    ├── tsconfig.node.json          빌드 스크립트용 TS 설정
    ├── vite.config.ts              Vite/React 플러그인 설정
    ├── public/
    │   └── _redirects              SPA 라우팅을 위한 Cloudflare Pages 리다이렉트
    ├── .gitignore
    └── src/
        ├── main.tsx                React 엔트리 (StrictMode + 루트 렌더)
        ├── App.tsx                 전 화면 단일 파일 컴포넌트 트리 (~4,400줄)
        ├── styles.css              전체 테마·레이아웃·대시보드 스타일 (~3,100줄)
        └── vite-env.d.ts           Vite 타입 선언
```

---

## 파일별 상세 설명

### 백엔드

| 파일 | 역할 | 핵심 포인트 |
| --- | --- | --- |
| [backend/requirements.txt](backend/requirements.txt) | Python 의존성 | `fastapi`, `uvicorn[standard]`, `sqlmodel`, `psycopg[binary]`, `passlib[bcrypt]`, `python-jose[cryptography]`, `python-multipart` |
| [backend/app/main.py](backend/app/main.py) | FastAPI 애플리케이션 | 모든 HTTP 라우트(약 25개), CORS 미들웨어, 기동 시 시드 호출, NDJSON 스트리밍 응답, 스레드풀 기반 채점 동시성 제어 |
| [backend/app/models.py](backend/app/models.py) | 데이터 모델 | `User` / `Category` / `Problem` / `TestCase` / `Assignment` / `Submission` 테이블 + 응답 전용 Pydantic 모델 |
| [backend/app/config.py](backend/app/config.py) | 설정 허브 | `STARLAB_*` / `DATABASE_URL` 등 모든 환경변수를 한 곳에서 해석, `postgres://` → `postgresql+psycopg://` 정규화 |
| [backend/app/db.py](backend/app/db.py) | DB 연결 | SQLite WAL PRAGMA 설정, Postgres 풀 크기 제어, `primary_teacher_id` 등 컬럼 자동 마이그레이션, `get_session()` 의존성 |
| [backend/app/auth.py](backend/app/auth.py) | 인증 | `pbkdf2_sha256` 해시, JWT 발급/검증, `get_current_user` / `require_teacher` 의존성 |
| [backend/app/judge.py](backend/app/judge.py) | 채점기 | `run_code_iter()` 가 테스트별로 서브프로세스 실행, POSIX 에서는 `resource.setrlimit` 으로 CPU·메모리 제한, 결과를 제너레이터로 반환 |
| [backend/app/seed.py](backend/app/seed.py) | 시드 | 10개 카테고리 + 100개 데모 문제 + 5,000개 테스트케이스 + 데모 계정 자동 삽입, 기존 DB에 incrementally 추가 |

### 프론트엔드

| 파일 | 역할 | 핵심 포인트 |
| --- | --- | --- |
| [frontend/index.html](frontend/index.html) | HTML 셸 | `<div id="root">` + `main.tsx` 모듈 로드 |
| [frontend/package.json](frontend/package.json) | NPM 메타 | `dev` / `build` / `preview` / `typecheck` 스크립트, React 18 + Vite 5 |
| [frontend/vite.config.ts](frontend/vite.config.ts) | Vite 설정 | React 플러그인, 개발 포트 5173 |
| [frontend/public/_redirects](frontend/public/_redirects) | SPA 리다이렉트 | Cloudflare Pages 에서 새로고침 시 `index.html` 로 fallback |
| [frontend/src/main.tsx](frontend/src/main.tsx) | React 엔트리 | `createRoot` + StrictMode 렌더, 전역 CSS 로드 |
| [frontend/src/App.tsx](frontend/src/App.tsx) | 단일 컴포넌트 트리 | 로그인·대시보드·문제 풀이·계정 관리·과제 배정·실시간 피드까지 모든 뷰, `VITE_API_BASE_URL` 기반 `fetch` 클라이언트, NDJSON 스트리밍 파서 |
| [frontend/src/styles.css](frontend/src/styles.css) | 전체 스타일 | solved.ac 스타일 티어 색상, 대시보드 그리드, 히트맵, 모달, 계정 탭 |
| [frontend/src/vite-env.d.ts](frontend/src/vite-env.d.ts) | Vite 타입 | `import.meta.env` 타입 선언 |

---

## 프론트엔드 뷰 구조

[App.tsx](frontend/src/App.tsx) 하나에 모든 화면이 있으며 `view` 상태값 하나로 분기합니다.

| 뷰 키 | 화면 | 대상 | 주요 컴포넌트 |
| --- | --- | --- | --- |
| `home` | 대시보드 | 학생·선생님 | `StudentDashboard` / `TeacherDashboard` |
| `problems` | 문제은행 | 공통 | `ProblemListView` |
| `solve` | 문제 풀이 | 공통 | `SolveView` + NDJSON 스트리밍 채점 UI |
| `submissions` | 내 제출 | 학생 | `SubmissionsView` |
| `live` | 실시간 제출 피드 | 선생님 | `LiveFeedView` (4초 폴링) |
| `assignments` | 과제 배정/현황 | 선생님 | `AssignmentsView` + 반별 드릴다운 |
| `accounts` | **계정 관리** | 선생님 | `AccountsView` — `선생님 계정` / `학생 계정` 서브탭 |
| `manage` | 문제 생성/수정 | 선생님 | `ManageView` |

`accounts` 탭은 기존에 과제 화면 하단에 묶여 있던 계정 생성 UI를 독립 페이지로 분리한 것입니다. 내부에 `useState<"teacher" | "student">` 서브탭을 두고 선생님 계정 생성/목록과 학생 계정 생성/반별 그룹 목록을 각각 보여줍니다.

---

## 빠른 실행 (로컬)

### 사전 요구

- Python **3.10+** (Render 에서는 3.12.7 사용)
- Node.js **18+** (npm 동봉)
- Windows PowerShell / macOS · Linux bash 모두 지원

### 1. 백엔드

**Windows PowerShell**
```powershell
cd backend
$env:PYTHONUTF8 = '1'
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

**macOS / Linux**
```bash
cd backend
export PYTHONUTF8=1
python3 -m pip install -r requirements.txt
python3 -m uvicorn app.main:app --reload
```

- 기본 주소: `http://127.0.0.1:8000`
- Swagger UI: `http://127.0.0.1:8000/docs`
- 최초 실행 시 `backend/starlab_code_mvp.db` 가 생성되고 [seed.py](backend/app/seed.py) 의 분류·100개 문제·데모 계정이 자동 삽입됩니다.
- 시드는 **제목 기준 incremental 삽입**이라, 이미 운영 중인 DB에도 새 문제만 추가됩니다.
- DB를 초기화하려면 서버를 끄고 `starlab_code_mvp.db` 를 삭제한 뒤 다시 실행하세요.

### 2. 프론트엔드

```bash
cd frontend
npm install
npm run dev
```

- 기본 주소: `http://127.0.0.1:5173`
- 타입체크: `npm run typecheck`
- 빌드: `npm run build` (타입체크 선행 후 Vite 번들)
- 백엔드 주소가 다르면 `frontend/.env` 를 만들어 지정:

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8000
```

### 3. 운영 빌드

```bash
cd frontend
npm run build      # dist/ 에 정적 번들 생성
npm run preview    # 로컬에서 빌드 결과 미리보기
```

---

## 환경변수

모든 백엔드 설정은 [backend/app/config.py](backend/app/config.py) 의 `Settings` 데이터클래스에서 한 번에 해석됩니다.

### 필수 / 핵심

| 이름 | 위치 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `VITE_API_BASE_URL` | 프론트엔드 빌드타임 | `http://127.0.0.1:8000` | API 서버 주소. 배포 시 반드시 지정 |
| `STARLAB_SECRET_KEY` (또는 `JWT_SECRET`) | 백엔드 | 개발용 하드코딩값 | JWT 서명 키. **운영 배포 전 반드시 환경변수로 주입** |
| `STARLAB_DATABASE_URL` (또는 `DATABASE_URL`) | 백엔드 | 로컬 SQLite | `postgres://` / `postgresql://` 는 `postgresql+psycopg://` 로 자동 정규화 |
| `STARLAB_ALLOW_ORIGINS` | 백엔드 | localhost:5173/4173 | 콤마 구분 CORS 화이트리스트 |
| `PYTHONUTF8` | 백엔드 | `1` 권장 | Windows 한글 입출력 인코딩 이슈 방지 |

### 메인 선생님(primary_teacher) 계정

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `STARLAB_PRIMARY_TEACHER_USERNAME` | `main_teacher` | 기동 시 자동 ensure 되는 메인 선생님 계정명 |
| `STARLAB_PRIMARY_TEACHER_DISPLAY_NAME` | `메인 선생님` | 표시 이름 |
| `STARLAB_PRIMARY_TEACHER_PASSWORD` | `ChangeMe1234!` | **운영 전 반드시 변경** |

### 시드 / 성능 튜닝

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `STARLAB_SEED_DEMO_DATA` | `true` | 데모 문제 카탈로그 시드 여부 |
| `STARLAB_TOKEN_MINUTES` | `1440` | JWT 만료 시간(분) |
| `STARLAB_DB_POOL_SIZE` | `5` | Postgres 기본 풀 크기 (Render Free + Supabase 권장) |
| `STARLAB_DB_MAX_OVERFLOW` | `5` | 초과 연결 수 |
| `STARLAB_DB_POOL_RECYCLE_SECONDS` | `300` | 유휴 연결 재사용 주기 |
| `STARLAB_THREADPOOL_SIZE` | `64` | FastAPI 스레드풀 상한 |

### 채점 리소스 가드

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `STARLAB_JUDGE_CONCURRENCY` | `4` | 동시에 실행할 수 있는 제출/실행 수 |
| `STARLAB_MAX_CODE_BYTES` | 64KB | 제출 코드 크기 상한 |
| `STARLAB_MAX_INPUT_BYTES` | 256KB | 테스트 입력 크기 상한 |
| `STARLAB_MAX_OUTPUT_BYTES` | 256KB | 프로세스 출력 크기 상한 |
| `STARLAB_JUDGE_CPU_SECONDS` | `4` | POSIX rlimit 로 강제하는 CPU 초 상한 |
| `STARLAB_JUDGE_MEMORY_BYTES` | 256MB | POSIX rlimit 로 강제하는 메모리 상한 |

---

## 주요 API 라우트

[backend/app/main.py](backend/app/main.py) 기준.

| 메서드 | 경로 | 권한 | 설명 |
| --- | --- | --- | --- |
| `GET`  | `/` | 공개 | 루트 |
| `GET`  | `/health` | 공개 | 헬스체크 (Render 용) |
| `POST` | `/auth/register` | 공개 | 학생 계정 생성 (선생님은 시드/`/users/teachers` 사용) |
| `POST` | `/auth/token` | 공개 | 로그인, JWT 발급 |
| `GET`  | `/auth/me` | 로그인 | 현재 로그인 사용자 |
| `GET`  | `/dashboard` | 로그인 | 역할별 요약 지표 |
| `GET`  | `/categories` | 공개 | 분류 목록 |
| `GET`  | `/classrooms` | 공개 | 반 목록 + 학생 수 |
| `GET`  | `/students` | 선생님 | 학생 목록 |
| `GET`  | `/teachers` | 선생님 | 선생님 목록 (메인 선생님 권한) |
| `POST` | `/users/teachers` | 메인 선생님 | 선생님 계정 생성 |
| `POST` | `/users/students` | 선생님 | 학생 계정 생성 (반 지정) |
| `GET`  | `/problems` | 공개 | 문제 카드 목록 (분류/검색 필터) |
| `GET`  | `/problems/{id}` | 로그인 | 문제 상세 (선생님은 비공개 테스트 포함) |
| `POST` | `/problems` | 선생님 | 문제 생성 |
| `PUT`  | `/problems/{id}` | 선생님 | 문제 수정 |
| `POST` | `/assignments` | 선생님 | 과제 배정 (`class_name` 전달 시 반 전원 일괄 배정) |
| `GET`  | `/assignments` | 로그인 | 내 과제 / 내가 배정한 과제 |
| `GET`  | `/assignments/groups` | 선생님 | 반+문제 단위 완료율 요약 |
| `GET`  | `/assignments/groups/detail` | 선생님 | 특정 그룹의 학생별 제출 현황 |
| `GET`  | `/submissions` | 로그인 | 제출 기록 |
| `GET`  | `/submissions/feed` | 선생님 | 실시간 피드 (`since_id` 지원) |
| `POST` | `/problems/{id}/run` | 로그인 | 공개 테스트 실행 (일괄) |
| `POST` | `/problems/{id}/submit` | 로그인 | 전체 테스트 제출 (일괄) |
| `POST` | `/problems/{id}/run/stream` | 로그인 | 공개 테스트 실행 — NDJSON 스트리밍 |
| `POST` | `/problems/{id}/submit/stream` | 로그인 | 전체 테스트 제출 — NDJSON 스트리밍 |

---

## 데이터 모델 요약

[backend/app/models.py](backend/app/models.py) 기준.

- `User` — 역할(`teacher`/`student`), `class_name` 으로 반 구분, `primary_teacher_id` / `created_by_teacher_id` / `is_primary_teacher` 로 선생님 위계 표현
- `Category` — 알고리즘 분류 (기본 10개)
- `Problem` — 문제 본문·제한·샘플·스타터 코드
- `TestCase` — 문제당 10~50개, `is_public` 으로 공개/비공개 구분
- `Assignment` — 과제 1행 = 학생 1명 (반 배정 시 학생 수만큼 생성)
- `Submission` — 제출 이력, 상태·통과 테스트·런타임
- 응답 전용 모델: `AssignmentGroup`, `AssignmentGroupStudent`, `SubmissionFeedItem`, `DashboardSummary`, `ClassroomSummary`, `ProblemCard` / `ProblemDetail`

### 선생님 위계

- **메인 선생님** (`is_primary_teacher = true`): 다른 선생님 계정을 생성할 수 있는 관리자
- **일반 선생님**: 자신이 관리하는 학생(`primary_teacher_id` 가 본인인 학생)에 대해서만 과제·제출 조회
- **학생**: 가입 시 선생님을 선택하거나, 선생님이 직접 계정을 생성할 때 `primary_teacher_id` 가 지정됨

---

## 시드 데이터

[backend/app/seed.py](backend/app/seed.py) — 서버 기동 시 `on_startup` 에서 호출됩니다.

- **카테고리 10종**: 입출력·기초 연산 / 조건문과 분기 / 반복문 기본 / 문자열 다루기 / 리스트·배열 기초 / 정렬·탐색 / 스택과 큐 / 완전 탐색 / 그래프 기초 / 누적합·구간 쿼리
- **문제 100개** × **테스트케이스 50개** = 총 **5,000개 케이스**
- 각 카테고리마다 10문제씩 난이도가 고르게 분포 (입문 / 기초 / 중급)
- 테스트케이스는 순수 함수(예: `make_range_sum_cases`)로 결정론적으로 생성되어 리빌드 시에도 동일
- **incremental 시딩**: 이미 존재하는 제목의 문제는 건너뛰므로, 기존 운영 DB 에 새 문제만 추가됨
- 데모 계정(교사 1명 + 학생 2명)도 함께 삽입

---

## 아키텍처 메모

- **채점기**: [judge.py](backend/app/judge.py) 의 `run_code_iter()` 가 테스트케이스별로 `subprocess` 를 실행하며 결과를 yield. [main.py](backend/app/main.py) 의 `stream_execution()` 이 이를 감싸 `{kind: "start" | "result" | "done"}` NDJSON 라인으로 프론트에 흘려보냅니다.
- **리소스 제한**: POSIX(Linux/macOS) 에서는 `resource.setrlimit` 으로 CPU·AS(메모리) 를 강제하고, Windows 에서는 `subprocess.run(timeout=...)` 만 적용됩니다. 배포는 Linux 권장.
- **동시성 제어**: 채점 요청은 `asyncio.Semaphore(JUDGE_CONCURRENCY)` 와 스레드풀로 감싸 FastAPI 이벤트 루프를 막지 않도록 합니다.
- **스트리밍 파싱**: 프론트의 `executeStream()` 이 `fetch` + `ReadableStream.getReader()` 로 한 줄씩 파싱해 테스트별 프로그레스 바를 갱신합니다.
- **실시간 피드**: `/submissions/feed?since_id=` 를 4초마다 폴링하여 새 행만 가져옵니다.
- **과제 그룹핑**: `(title, problem_id, class_name, assignment_type)` 조합으로 그룹 키를 만들어 완료율을 집계합니다.
- **SQLite 모드**: WAL 저널 + `synchronous=NORMAL` + `busy_timeout=5000ms` 설정으로 단일 프로세스 다중 연결에서도 쓰기 락을 줄였습니다.
- **스키마 자동 마이그레이션**: [db.py](backend/app/db.py) 가 기동 시 `user` 테이블에 선생님 위계 컬럼(`primary_teacher_id` 등)이 없으면 `ALTER TABLE` 로 추가합니다.

---

## 데모 계정

- 메인 선생님: `main_teacher` / `ChangeMe1234!` (환경변수로 변경 가능)
- 선생님: `teacher_demo` / `demo1234`
- 학생: `student_mina` / `demo1234` (2-3반)
- 학생: `student_jun` / `demo1234` (2-3반)

---

## 배포 가이드

무료 티어 기준 상세 가이드는 [DEPLOY_FREE.md](DEPLOY_FREE.md) 참고.

### 권장 조합 — Render + Supabase + Cloudflare Pages (설정 간단)

| 레이어 | 서비스 | 메모 |
| --- | --- | --- |
| 프론트엔드 | **Cloudflare Pages** | `frontend/` 루트, `npm run build`, `dist` 출력. `_redirects` 포함 |
| 백엔드 | **Render Free Web Service** | [render.yaml](render.yaml) 블루프린트 사용, 15분 유휴 시 슬립 |
| DB | **Supabase Free Postgres** | `Session pooler` 연결 문자열을 `DATABASE_URL` 로 주입 |

### 배포 전 체크리스트

- [ ] `STARLAB_SECRET_KEY` 를 Render `generateValue` 로 자동 생성 (render.yaml 에 이미 설정됨)
- [ ] `DATABASE_URL` 에 Supabase Session pooler 문자열 주입
- [ ] `STARLAB_ALLOW_ORIGINS` 를 Cloudflare Pages 도메인으로 제한
- [ ] `STARLAB_PRIMARY_TEACHER_PASSWORD` 기본값에서 변경
- [ ] `VITE_API_BASE_URL` 을 Render 서비스 URL 로 지정
- [ ] Cloudflare Pages 첫 배포 후 Render `STARLAB_ALLOW_ORIGINS` 최종 업데이트
- [ ] (선택) 채점 샌드박스 강화 — Docker / gVisor / firejail 래퍼 교체

### 진짜 격리가 필요하다면 — Oracle Cloud Always Free

백엔드를 Oracle Cloud 프리티어(ARM Ampere 4 OCPU / 24GB)에 올리고 `docker run --rm --network=none --memory=256m --cpus=0.5 --read-only` 형태로 채점 서브프로세스를 감싸면 공개 운영이 가능합니다. 도메인·TLS 는 Cloudflare Tunnel.

---

## 알려진 한계와 후속 작업

- **채점 샌드박스 없음** — `subprocess` 실행 + rlimit 수준이라 신뢰된 환경에서만 운영하세요. 실서비스에는 Docker / gVisor / firejail 같은 격리가 필요합니다.
- **Windows 리소스 제한** — `resource` 모듈이 없어 CPU/메모리 rlimit 이 적용되지 않습니다. Windows 는 로컬 개발 전용으로 권장.
- **언어 확장** — C / C++ 를 염두에 두고 `language` 필드는 분리돼 있지만, 현재 채점기는 Python 만 지원합니다.
- **채점 큐 분리** — 동시 제출이 많아지면 별도 워커(Celery, RQ)와 우선순위 큐가 필요합니다. 현재는 in-process 세마포어로만 직렬화.
- **DB 마이그레이션** — `_run_schema_migrations()` 가 수동으로 컬럼을 추가하는 단순 로직이라 실운영에서는 Alembic 도입을 권장합니다.
- **레이트 리밋 없음** — `/submit/stream` 스팸 호출로 CPU 포화 가능. 운영 전 `slowapi` 등 도입 필요.
- **단일 파일 프론트엔드** — `App.tsx` 가 4천 줄을 넘어가 컴포넌트 분리 리팩터링이 다음 단계.
