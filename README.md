# Starlab Code

중, 고등학생 대상 알고리즘 문제 풀이 및 수업 운영 플랫폼 MVP.  
선생님은 문제를 만들고 반 단위로 과제를 배정하며 실시간 제출을 모니터링하고,  
학생은 테스트케이스별 채점 진행을 실시간으로 확인할 수 있습니다.

---

## 목차

1. [Backend](#backend)
2. [Frontend](#frontend)
3. [로컬 실행](#로컬-실행)
4. [테스트 및 확인](#테스트-및-확인)

---

## Backend

### 파일 구조

```
backend/
├── requirements.txt
└── app/
    ├── main.py       # FastAPI 엔트리, 모든 HTTP 라우트 (~25개), CORS 설정
    ├── models.py     # SQLModel 테이블 + 요청·응답 스키마
    ├── config.py     # STARLAB_* 환경변수 해석, Settings 데이터클래스
    ├── db.py         # 엔진·세션 팩토리, SQLite PRAGMA, 스키마 자동 마이그레이션
    ├── auth.py       # 패스워드 해시(pbkdf2), JWT 발급·검증, 의존성 함수
    ├── judge.py      # 서브프로세스 채점기, run_code_iter() 제너레이터
    └── seed.py       # 카테고리·문제·테스트케이스·데모 계정 시드
```

### 주요 기능

| 기능 | 설명 |
|---|---|
| 역할 기반 인증 | `student` / `teacher` / `primary_teacher` 3단계, JWT HS256 |
| 문제은행 | 10개 알고리즘 분류, 3단계 난이도, 100문제 × 테스트케이스 50개 시드 |
| NDJSON 스트리밍 채점 | `run_code_iter()` 제너레이터 → `stream_execution()` → 프론트 실시간 전달 |
| 동시 채점 제어 | `asyncio.Semaphore(JUDGE_CONCURRENCY)` + 스레드풀로 이벤트 루프 블로킹 방지 |
| 리소스 가드 | POSIX: `resource.setrlimit` (CPU·메모리), Windows: `subprocess timeout` |
| 반 단위 과제 배정 | `class_name` 전달 시 반 학생 전원에게 `Assignment` 행 일괄 생성 |
| 스키마 자동 마이그레이션 | 기동 시 누락 컬럼을 `ALTER TABLE` 로 자동 추가 |

### 기술 선택 이유

**FastAPI + SQLModel**  
Pydantic 기반으로 요청·응답 스키마와 DB 모델을 한 곳에서 정의할 수 있어 MVP 단계의 코드량을 줄였습니다. 자동 생성 Swagger(`/docs`)가 API 확인 및 시연 시 즉시 활용 가능합니다.

**SQLite (로컬) / PostgreSQL (운영)**  
`DATABASE_URL` 하나로 두 DB를 전환할 수 있어 로컬에서 별도 설치 없이 바로 실행됩니다. SQLite WAL 모드(`synchronous=NORMAL`, `busy_timeout=5000ms`)로 단일 프로세스 다중 연결의 쓰기 락을 최소화했습니다.

**subprocess 채점기**  
채점 요청마다 별도 Python 프로세스를 격리 실행합니다. POSIX에서 `rlimit`으로 CPU·메모리를 강제하여 무한 루프·메모리 폭발을 방지합니다. 현 단계는 신뢰된 환경 전용이며, 공개 운영 시 Docker / gVisor 래퍼로 교체가 필요합니다.

**incremental 시딩**  
문제 제목 기준으로 중복을 건너뛰기 때문에 기존 운영 DB에 서버를 재기동해도 새 문제만 추가되고 기존 데이터는 유지됩니다.

### 주요 API 라우트

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| `POST` | `/auth/token` | 공개 | 로그인, JWT 발급 |
| `GET`  | `/dashboard` | 로그인 | 역할별 요약 지표 |
| `GET`  | `/problems` | 공개 | 문제 목록 (분류·검색 필터) |
| `POST` | `/problems` | 선생님 | 문제 생성 |
| `POST` | `/problems/{id}/submit/stream` | 로그인 | 전체 제출 — NDJSON 스트리밍 |
| `POST` | `/assignments` | 선생님 | 반 단위 과제 일괄 배정 |
| `GET`  | `/assignments/groups` | 선생님 | 반+문제 단위 완료율 집계 |
| `GET`  | `/submissions/feed` | 선생님 | 실시간 제출 피드 (`since_id` 지원) |
| `POST` | `/users/teachers` | 메인 선생님 | 선생님 계정 생성 |
| `POST` | `/users/students` | 선생님 | 학생 계정 생성 (반 지정) |

전체 라우트는 기동 후 `http://127.0.0.1:8000/docs` 에서 확인하세요.

---

## Frontend

### 파일 구조

```
frontend/
├── index.html
├── package.json
├── vite.config.ts
└── src/
    ├── main.tsx      # createRoot + StrictMode, 전역 CSS 로드
    ├── App.tsx       # 모든 뷰를 view 상태값 하나로 분기하는 단일 컴포넌트 트리
    ├── styles.css    # 전체 테마·레이아웃, solved.ac 풍 티어 색상, 히트맵, 모달
    └── vite-env.d.ts
```

### 뷰 구조

`App.tsx` 내 `view` 상태 하나로 모든 화면을 분기합니다.

| 뷰 키 | 화면 | 대상 |
|---|---|---|
| `home` | 대시보드 (학생: 히트맵·숙련도 / 선생님: 학급 현황) | 공통 |
| `problems` | 문제은행 (분류·난이도 필터) | 공통 |
| `solve` | 문제 풀이 + 실시간 채점 프로그레스 바 | 공통 |
| `submissions` | 내 제출 기록 | 학생 |
| `live` | 실시간 제출 피드 (4초 폴링) | 선생님 |
| `assignments` | 과제 배정 + 반별 드릴다운 현황 | 선생님 |
| `accounts` | 선생님·학생 계정 관리 서브탭 | 선생님 |
| `manage` | 문제 생성·수정 | 선생님 |

### 주요 기능

| 기능 | 설명 |
|---|---|
| 스트리밍 채점 UI | `fetch` + `ReadableStream.getReader()`로 NDJSON 한 줄씩 파싱 → 테스트별 % 프로그레스 바 갱신 |
| 실시간 제출 피드 | 4초 폴링, `since_id` 기반 증분 요청, 신규 행 하이라이트 |
| 학생 대시보드 | 30일 활동 히트맵, 난이도·분류별 숙련도 바, 추천 문제 |
| 선생님 대시보드 | 오늘 정답률·활동 학생, 이번 주 활약 학생, 30일 학급 활동 |
| 계정 관리 분리 | 선생님·학생 서브탭으로 계정 생성·목록을 독립 화면으로 분리 |

### 기술 선택 이유

**React 18 + TypeScript + Vite**  
`VITE_API_BASE_URL` 환경변수 하나로 로컬·배포 API 주소를 분리할 수 있고, HMR 덕분에 UI 빠른 반복 개발이 가능합니다. TypeScript로 API 응답 타입을 명시해 런타임 오류를 줄였습니다.

**단일 App.tsx (view 상태 분기)**  
MVP 단계에서 뷰 간 공유 상태(로그인 정보, 현재 문제 등)를 props drilling 없이 관리하기 위해 단일 파일 구조를 선택했습니다. 뷰 수가 늘어나는 시점에 컴포넌트 파일 분리 리팩터링이 필요합니다.

**네이티브 fetch + ReadableStream**  
별도 WebSocket 서버 없이 기존 HTTP 엔드포인트만으로 채점 진행 상황을 실시간 전달할 수 있어 인프라 복잡도를 줄였습니다.

---

## 로컬 실행

### 사전 요구사항

- Python **3.10+**
- Node.js **18+**

### Backend

```bash
# macOS / Linux
cd backend
export PYTHONUTF8=1
python3 -m pip install -r requirements.txt
python3 -m uvicorn app.main:app --reload
```

```powershell
# Windows PowerShell
cd backend
$env:PYTHONUTF8 = '1'
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

- 기본 주소: `http://127.0.0.1:8000`
- 최초 실행 시 `starlab_code_mvp.db`가 생성되고 카테고리·문제 100개·데모 계정이 자동 삽입됩니다.
- DB 초기화: 서버를 끄고 `starlab_code_mvp.db` 삭제 후 재실행

### Frontend

```bash
cd frontend
npm install
npm run dev
```

- 기본 주소: `http://127.0.0.1:5173`
- 백엔드 주소 변경 시 `frontend/.env` 파일 생성:

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8000
```

---

## 테스트 및 확인

### 데모 계정

| 역할 | 아이디 | 비밀번호 |
|---|---|---|
| 메인 선생님 | `main_teacher` | `ChangeMe1234!` |
| 선생님 | `teacher_demo` | `demo1234` |
| 학생 | `student_mina` | `demo1234` |
| 학생 | `student_jun` | `demo1234` |

### 주요 시나리오 체크리스트

**채점 스트리밍 확인**
1. 학생 계정으로 문제은행에서 아무 문제 진입
2. 코드 작성 후 제출 → 테스트케이스별 프로그레스 바가 순서대로 갱신되는지 확인

**과제 배정 및 현황 확인**
1. 선생님 계정으로 `과제 배정` → 문제 + 반 선택 후 배정
2. `과제 현황` 탭에서 완료율 막대 확인, 클릭 시 학생별 드릴다운 확인

**실시간 피드 확인**
1. 선생님 계정으로 `실시간 피드` 탭 열기
2. 다른 탭(또는 브라우저)에서 학생 계정으로 제출 → 4초 이내 신규 행 하이라이트 확인

**API 직접 확인**  
`http://127.0.0.1:8000/docs` Swagger UI에서 토큰 발급 후 각 엔드포인트를 직접 호출할 수 있습니다.

### 타입체크 및 빌드

```bash
cd frontend
npm run typecheck   # TypeScript 오류 확인
npm run build       # dist/ 에 정적 번들 생성
npm run preview     # 빌드 결과 로컬 미리보기
```

---

## 환경변수 요약

| 이름 | 기본값 | 설명 |
|---|---|---|
| `VITE_API_BASE_URL` | `http://127.0.0.1:8000` | 프론트 빌드타임 API 주소 |
| `STARLAB_SECRET_KEY` | 개발용 하드코딩값 | JWT 서명 키, **운영 시 반드시 교체** |
| `STARLAB_DATABASE_URL` | 로컬 SQLite | `postgres://` 입력 시 자동 정규화 |
| `STARLAB_ALLOW_ORIGINS` | localhost:5173/4173 | CORS 화이트리스트 |
| `STARLAB_JUDGE_CONCURRENCY` | `4` | 동시 채점 프로세스 수 |
| `STARLAB_PRIMARY_TEACHER_PASSWORD` | `ChangeMe1234!` | **운영 전 반드시 변경** |

무료 배포(Render + Supabase + Cloudflare Pages) 상세 가이드는 [DEPLOY_FREE.md](DEPLOY_FREE.md)를 참고하세요.