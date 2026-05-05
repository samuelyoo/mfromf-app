# TRD (Technical Requirements Document)
## Product Name: FutureKey
### Document Version: Draft v0.2
### Date: 2026-05-04
### Target Audience: Engineering Team, DevOps, Product Management

---

## 1. 문서 목적 (Purpose)
이 문서는 FutureKey의 BRD 및 PRD를 바탕으로, 시스템을 실제 구현하기 위한 기술적 요구사항, 시스템 아키텍처, 데이터 모델, 핵심 로직 및 보안/스토리지 전략을 정의하는 기술 요구사항 문서(TRD)이다.

이 문서는 개발팀이 MVP를 설계, 개발 및 배포하는 데 필요한 기술적 가이드라인을 제공하며, 스토리지 비용 분석(Cost Analysis) 등 결정을 앞둔 오픈 이슈를 구체화한다.

**v0.2 변경 요약:** 사내 레퍼런스 프로젝트(`erg-coach`, `bible-app`)의 운영 경험을 반영하여 기술 스택을 확정하고, 프론트엔드와 백엔드 영역을 명확히 분리하여 기술하였다.

---

## 2. 시스템 아키텍처 개요 (System Architecture)

### 2.1 High-Level Architecture

FutureKey는 **프론트엔드(Web)** 와 **백엔드(BaaS)** 를 명확히 분리한 구조로 설계한다. 백엔드는 Supabase 기반의 Backend-as-a-Service 모델을 채택하여 MVP 단계의 운영 복잡도를 최소화한다.

```
[ Browser / Mobile Web ]
          │
          ▼
[ Frontend: Next.js on Vercel ]   ──── (Edge SSR, Static Assets, CDN)
          │
          ▼
[ Backend: Supabase Cloud ]
   ├─ Postgres (Database + RLS)
   ├─ Auth (OAuth: Google/Apple)
   ├─ Storage (S3-backed Object Storage)
   └─ Edge Functions (Deno) + pg_cron (Scheduler)
          │
          ▼
[ External Services ]
   ├─ Email: Resend (또는 AWS SES)
   ├─ Archive Storage: AWS S3 Glacier Deep Archive (장기 보관 전용)
   └─ Monitoring: Supabase Logs + Sentry
```

### 2.2 Frontend Stack

| 항목 | 선택 | 비고 |
|---|---|---|
| Framework | **Next.js 15 (App Router)** | SSR이 공유 링크 OG 메타데이터 및 카운트다운 초기 렌더에 유리 |
| Language | **TypeScript 5.x** | 모노레포 내 타입 공유 |
| Styling | Tailwind CSS | 레퍼런스 프로젝트와 동일한 패턴 |
| State / Data | React Server Components + `@supabase/ssr` | 서버 측 RLS 검증 후 데이터 전달 |
| Hosting | **Vercel** | Edge Network, 자동 배포 |
| Mobile 전략 | 모바일 퍼스트 반응형 웹 (네이티브 앱은 Post-MVP) | PRD §12.4 |

### 2.3 Backend Stack

| 항목 | 선택 | 비고 |
|---|---|---|
| Platform | **Supabase Cloud** | Postgres + Auth + Storage + Edge Functions 통합 제공 |
| Database | **Postgres 15+** | RLS(Row-Level Security)로 접근 제어 일원화 |
| Auth | **Supabase Auth** (Google/Apple OAuth) | JWT 발급/검증 자체 구현 불필요 |
| Storage | **Supabase Storage** (S3 호환) | 핫 스토리지. 장기 아카이브는 별도 S3 Glacier로 이전 (§5.2 참조) |
| Scheduler | **`pg_cron`** + **Supabase Edge Functions (Deno)** | D-day, 리마인더, 아카이브 워커 |
| Queue / Async | Postgres job table + Edge Function poller (또는 `pg_net`) | 별도 SQS/Redis 도입 없이 운영 단순화 |
| Email | **Resend** (1순위) / AWS SES (대체) | 발송 실패 시 재시도 + DLQ 테이블 |
| Hosting | Supabase Cloud (managed) | MVP 단계에서는 self-host 불필요 |

### 2.4 공통 인프라스트럭처 (Shared Infrastructure)

| 항목 | 선택 | 비고 |
|---|---|---|
| Repo 구조 | **pnpm workspace + Turborepo** | `apps/web`, `apps/edge-functions`, `packages/db`, `packages/ui`, `packages/types` 등 |
| Package Manager | **pnpm 10.x** | 레퍼런스 프로젝트와 동일 |
| Node 버전 | **Node 20+** | 빌드 및 로컬 개발 환경 |
| Unit Test | **Vitest** | 패키지/유틸 단위 테스트 |
| E2E Test | **Playwright** | 메시지 생성 → 봉인 → 열람 골든 패스 |
| CI/CD | **GitHub Actions** | Lint / Typecheck / Test / Preview Deploy 파이프라인 |
| Monitoring | Supabase Logs, Vercel Analytics, Sentry | 에러 트래킹 및 성능 메트릭 |

### 2.5 환경 분리 (Environments)

- **Local**: Supabase CLI로 로컬 Postgres + 로컬 Edge Functions 실행
- **Preview**: PR 단위로 Vercel Preview Deploy + 별도 Supabase Project (또는 Branching)
- **Production**: Vercel Production + Supabase Production Project

---

## 3. 핵심 시스템 컴포넌트 (Core Components)

### 3.1 Frontend Components

#### 3.1.1 페이지 구성
- `/` 랜딩 / 온보딩
- `/compose` 메시지 작성 (텍스트, 외부 링크, 미디어 업로드)
- `/dashboard` 발신자 카운트다운 대시보드 (PRD P2)
- `/m/[accessLinkId]` 수신자 진입 페이지 (잠금 / 열람 분기)
- `/auth/*` 로그인 / 콜백
- `/settings` 알림, 수신 거부 설정

#### 3.1.2 카운트다운 UI
- 클라이언트 기기 시계를 신뢰하지 않음.
- 서버에서 `serverNow` 와 `availableAt`(UTC)을 함께 내려주고, 클라이언트는 둘의 차이를 기반으로 카운트다운을 렌더링한다.
- D-day 도달 시점은 클라이언트가 결정하지 않는다. 반드시 서버 재요청으로 상태 전환을 확인한다 (PRD §9.3).

#### 3.1.3 인증 통합
- `@supabase/ssr`을 사용하여 서버 컴포넌트에서 세션을 읽어 RLS 컨텍스트를 적용한다.
- 발신자는 OAuth 로그인 필수. 수신자는 링크 단독 진입 모드 지원 여부 확정 필요 (PRD §14.5 Q6 참조 — 본 TRD 시점에서는 **하이브리드: 링크 단독 진입 가능 + 민감 메시지는 OAuth 필수** 제안).

### 3.2 Backend Components

#### 3.2.1 Authentication & Authorization (인증 및 권한)
- **OAuth Provider**: Supabase Auth의 Google, Apple 프로바이더 활성화. (향후 카카오 연동은 Supabase Custom OIDC 또는 Edge Function 내 구현)
- **세션 / 토큰**: Supabase가 발급하는 JWT를 그대로 사용. 별도의 세션 서버 불필요(Stateless).
- **접근 제어 (Row-Level Security)**: 모든 민감 테이블(`messages`, `media_attachments`, `access_links`)에 RLS 정책을 강제 적용한다.
    - 발신자: `auth.uid() = sender_id`
    - 수신자: `access_link_id` + 만료기간(`expires_at > now()`) + D-day(`available_at <= now()`) 3가지가 모두 일치할 때만 본문 컬럼 SELECT 허용.

#### 3.2.2 Message State Machine (메시지 상태 관리)
메시지는 다음 상태 머신을 따른다.

| 상태 | 의미 | 전이 조건 |
|---|---|---|
| `DRAFT` | 작성 중. 발신자만 접근 가능. | 신규 생성 시 |
| `SEALED` | 발신자 확정. 예약 스케줄에 등록됨. 발신자가 '완전 잠금' 또는 '재봉인 가능' 옵션 중 선택. | 발신자가 봉인 액션 |
| `LOCKED` | 수신자에게 링크가 공유되었으나 D-day 이전이라 본문 접근 불가. 메타데이터만 노출. | 발신자가 링크를 외부로 공유한 시점, 또는 수신자가 첫 진입한 시점 |
| `AVAILABLE` | D-day 도달. 권한 있는 수신자가 열람 가능. | `pg_cron` 워커가 `available_at <= now()` 인 메시지를 일괄 전이 |
| `EXPIRED` | 공유 링크 만료일 또는 보존 기간 경과. | 워커가 만료 조건 충족 시 전이 |
| `DELETED` | 발신자에 의한 삭제. UI에 노출 안됨. | 발신자 액션 |
| `SOFT_DELETED` | 익명화 처리 후 보존 기간(1~2년) 동안 격리 보관. | `DELETED` 상태에서 일정 시간 경과 후 워커가 전이 |

상태 전이는 모두 단일 트랜잭션 + `WHERE status = '<expected>'` 조건부 UPDATE로 처리하여 동시성 문제(중복 알림 등)를 방지한다.

#### 3.2.3 Scheduler & Notification Worker (스케줄러 및 알림)
- **D-day Worker** (`pg_cron` 1분 주기 → Edge Function 트리거):
  ```sql
  UPDATE messages
  SET status = 'AVAILABLE'
  WHERE status IN ('SEALED', 'LOCKED')
    AND available_at <= now();
  -- 변경된 row → 알림 큐 테이블에 INSERT
  ```
- **Reminder Worker**: 사용자가 설정한 리마인더 옵션(D-30/D-7/D-1, PRD NOTI-003에 따라 **사용자 설정 가능**)에 맞춰 알림 큐에 INSERT. D-day까지 남은 기간이 짧을 경우 적용 불가능한 옵션은 자동 스킵.
- **Notification Dispatcher**: 별도 Edge Function이 알림 큐를 폴링하여 Resend로 발송. 실패 시 재시도(지수 백오프, 최대 5회) 후 DLQ 테이블로 이동.
- **BlockList 연동**: 발송 직전 `block_list` 조회하여 차단된 수신자에게는 발송하지 않음 (PRD §9.4).
- **Idempotency**: 알림 큐 row에 `idempotency_key`(message_id + reminder_type) UNIQUE 제약으로 중복 발송 방지.

---

## 4. 데이터베이스 모델링 (Database Schema)

### 4.1 핵심 엔티티 (Core Entities)
1. **`users`**: Supabase Auth와 1:1 연결. OAuth Provider ID, 플랜 정보(Free/Paid).
2. **`profiles`**: 표시명, 기본 공개 설정, 알림 설정. `users.id` FK.
3. **`messages`**: 제목, 본문(암호화), 썸네일, 외부 영상 URL, `available_at`(UTC), `sealing_policy`, 상태값.
4. **`media_attachments`** (유료 플랜): Supabase Storage object key, 미디어 타입, 용량.
5. **`access_links`**: 수신자용 매직 링크 ID, `expires_at`, 타겟 이메일, 사용 여부.
6. **`schedules`**: 메시지별 리마인더 설정 (D-30/D-7/D-1 토글 등).
7. **`notifications`**: 알림 큐. status, retry_count, idempotency_key.
8. **`audit_logs`**: 봉인, 조회 시도, 삭제 등 민감한 액션 로그.
9. **`block_list`**: 수신자가 발신자 차단 / 메시지별 차단 / 플랫폼 전체 차단.
10. **`reports`**: 신고, 차단, 운영 조치.

### 4.2 보안 정책
- 모든 민감 테이블에 RLS Policy 강제.
- 모든 Primary Key는 UUID v4.
- 메시지 본문 컬럼은 `pgcrypto`를 활용한 컬럼 레벨 암호화 적용 검토.

### 4.3 마이그레이션 운영
- Supabase CLI(`supabase db diff`)로 마이그레이션 생성.
- `supabase/migrations/*.sql` 을 Git으로 버전 관리.

---

## 5. 스토리지 및 미디어 전략 (Storage Strategy & Cost Analysis)

PRD §14.5 Q7의 결정에 따라 본 TRD에서 기본 보존 정책을 다음과 같이 권고한다.

### 5.1 무료 플랜 (Free Tier)
- 내부 미디어 업로드 제한.
- 텍스트 메시지 및 외부 URL(예: YouTube Unlisted Link)만 허용.
- Supabase Storage 트래픽 비용 최소화.

### 5.2 유료 플랜 및 스토리지 (Paid Tier)
- **직접 업로드**: Supabase Storage Signed URL을 사용하여 클라이언트에서 직접 업로드 (서버 부하 분산).
- **핫 / 콜드 라이프사이클**:
    - **0 ~ D-day + 30일**: Supabase Storage(S3 Standard 등가, ~$0.023/GB/월)에 보관. 열람 트래픽 처리.
    - **D-day + 30일 이후**: 별도 AWS S3 Glacier Deep Archive(~$0.00099/GB/월)로 자동 이전. Edge Function에서 archive 워커가 처리.
    - **장기 보관 권고 기간**: D-day 이후 **1년**을 기본으로 한다. 1년 경과 시 발신자에게 보관 연장/다운로드/삭제 옵션 안내.
- **참고**: Supabase Storage는 네이티브 Lifecycle Policy를 제공하지 않으므로, 아카이브 이전은 **자체 워커**로 구현해야 한다.

> **PRD §14.5 Q7 종결 권고**: 보존 기본 = 1년, 유료 사용자는 영구 보관 옵션 구매 가능.

---

## 6. 보안 및 프라이버시 (Security & Privacy)

- **데이터 암호화**:
    - **At Rest**: Supabase가 디스크 레벨 AES-256 암호화 기본 제공. 메시지 본문은 추가로 `pgcrypto` 컬럼 암호화 검토.
    - **In Transit**: TLS 1.2 이상 (Supabase, Vercel 모두 기본 적용).
- **소프트 딜리트 (Soft Delete)**: `DELETED` 처리된 데이터는 익명화 후 일정 기간(1~2년) 별도 파티션에 격리. RLS 정책으로 일반 쿼리에서 원천 차단.
- **무단 접근 차단**: 메시지/링크 ID는 UUID v4 사용. Auto-increment 정수 ID 노출 금지.
- **PIPA(개인정보보호법) 대응**: 한국 시장이 1순위이므로 다음 사항을 운영 정책에 반영한다.
    - 개인정보 처리방침 별도 페이지 노출.
    - 마케팅성 알림은 별도 동의(opt-in) 분리.
    - SES/Resend 등 처리위탁 사실 명시.
- **Rate Limiting**: Edge Function 및 공개 페이지에 IP 단위 rate limit 적용 (Supabase + Vercel Edge Middleware).

---

## 7. 성능 및 확장성 (Performance & Scalability)

- **카운트다운 UI 정확성**: 클라이언트 시계 미신뢰. 서버 응답 시 `serverNow` + `availableAt`(UTC) 동시 전달, 프론트는 둘의 차이로 렌더.
- **캐싱(Caching)**: 공개 페이지(잠긴 메시지 메타, 썸네일)는 Vercel Edge Cache 활용. 바이럴 트래픽 스파이크 흡수.
- **DB 인덱스**: `messages(status, available_at)`, `access_links(message_id, expires_at)`, `notifications(status, scheduled_for)` 등 워커 쿼리 패턴에 맞춘 인덱스 필수.
- **SLO 초안 (MVP)**:
    - p95 페이지 응답: < 800ms
    - D-day 도달 후 알림 발송 지연: < 5분
    - 데이터 내구성: Supabase + S3 Glacier 이중화로 99.999999999% (11 nines) 목표
- **백업 / DR**: Supabase의 자동 일일 백업(7일 보존) 외에, 주 1회 별도 S3 버킷으로 Postgres dump 백업 (RPO 24시간, RTO 4시간 목표).

---

## 8. 오픈 이슈 및 다음 단계 (Open Issues & Next Steps)

### 8.1 Open Issues (TRD에서 미확정)
1. **수신자 OAuth 정책**: 링크 단독 진입 허용 vs OAuth 필수. PRD §14.5 Q6과 함께 결정 필요. (현재 TRD 권고: 하이브리드)
2. **메시지 본문 컬럼 암호화 방식**: `pgcrypto` 적용 시 검색/인덱싱 영향 검토.
3. **카카오 OAuth 도입 시점**: MVP 포함 여부.

### 8.2 Next Steps
1. **API 스펙 정의**: 프론트엔드 ↔ Supabase 호출 패턴 + Edge Function REST 엔드포인트 OpenAPI 문서화.
2. **비용 한계치 확정**: 미디어 업로드 사이즈 제한 (예: 영상당 200MB).
3. **CI/CD 파이프라인**: Vercel Preview + Supabase Branching 연동.
4. **이메일 발송 솔루션 PoC**: Resend vs SES 비교, 한국 발송 도달률 검증.
5. **부하 테스트**: 카운트다운 페이지 바이럴 시나리오(동시 접속 10K) k6 시뮬레이션.
