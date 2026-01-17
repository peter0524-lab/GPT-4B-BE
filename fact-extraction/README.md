# Fact Extraction Pipeline

비정형/반정형 원천 데이터(명함, 메모, 일정, 선물 이력, 채팅)를 LLM으로 구조화된 fact로 변환하고, MySQL에 표준 형태로 저장하는 파이프라인입니다.

## 목표

"나 ↔ 상대(명함)" 관계 상태 업데이트/시각화/검색의 기반 데이터 생성

## 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           원본 테이블 (5개)                                   │
├───────────────┬───────────────┬───────────────┬───────────────┬─────────────┤
│ business_cards│     memo      │    events     │    gifts      │    chats    │
│   (명함)      │   (메모)      │   (일정)      │  (선물이력)   │ (추천대화)  │
└───────┬───────┴───────┬───────┴───────┬───────┴───────┬───────┴──────┬──────┘
        │               │               │               │              │
        └───────────────┴───────────────┴───────────────┴──────────────┘
                                        │
                                        ▼
                    ┌───────────────────────────────────────┐
                    │       source_event 자동 생성 워커      │
                    │  (populate-source-events.js)          │
                    │                                       │
                    │  - 각 테이블 스캔                      │
                    │  - raw_text 생성 (LLM 입력 표준화)    │
                    │  - events: linked_card_ids 분해       │
                    │  - chats: messages 파싱               │
                    └───────────────────┬───────────────────┘
                                        │
                                        ▼
                    ┌───────────────────────────────────────┐
                    │           source_event 테이블          │
                    │                                       │
                    │  - user_id, card_id (관계)            │
                    │  - source_type, source_pk (추적)      │
                    │  - raw_text (LLM 입력)                │
                    │  - is_processed (처리 상태)           │
                    └───────────────────┬───────────────────┘
                                        │
                                        ▼
                    ┌───────────────────────────────────────┐
                    │        LLM Fact 추출 파이프라인        │
                    │  (extract-facts.js)                   │
                    │                                       │
                    │  - raw_text → LLM (Gemini)            │
                    │  - JSON 출력 → 검증/정제              │
                    │  - extracted_fact INSERT              │
                    └───────────────────┬───────────────────┘
                                        │
                                        ▼
                    ┌───────────────────────────────────────┐
                    │         extracted_fact 테이블          │
                    │                                       │
                    │  - fact_type (8개 고정)               │
                    │  - fact_key (자유 텍스트)             │
                    │  - confidence, evidence               │
                    └───────────────────────────────────────┘
```

## 디렉토리 구조

```
fact-extraction/
├── config.js                       # 설정 파일
├── migrations/
│   └── 001_create_source_extracted_tables.sql
├── lib/
│   ├── db.js                       # DB 연결
│   ├── llm-client.js               # LLM 클라이언트 (Gemini)
│   ├── parsers/
│   │   ├── chat-parser.js          # chats.messages 파싱
│   │   ├── event-parser.js         # events.linked_card_ids 파싱
│   │   └── source-text-builder.js  # raw_text 생성
│   └── validators/
│       └── fact-validator.js       # fact JSON 검증
├── scripts/
│   ├── run-migration.js            # 테이블 생성
│   ├── generate-scenario-data.js   # 시나리오→더미 데이터
│   ├── populate-source-events.js   # source_event 자동 채우기
│   ├── extract-facts.js            # LLM fact 추출
│   ├── analyze-distribution.js     # 분포 분석/품질 검증
│   └── run-all.js                  # 전체 파이프라인 실행
├── prompts/                        # (예정) 프롬프트 템플릿
├── tests/                          # (예정) 테스트
└── README.md
```

## 설치 및 실행

### 1. 의존성 (상위 프로젝트 사용)

```bash
# 상위 디렉토리에서
npm install @google/generative-ai  # Gemini API 사용 시
```

### 2. 환경 변수 (상위 .env)

```env
# MySQL
DB_HOST=your-db-host
DB_USER=admin
DB_PASSWORD=your-password
DB_NAME=HCI_2025
DB_PORT=3306

# LLM (Gemini)
GOOGLE_GEMINI_API_KEY=your-gemini-api-key
```

### 3. 실행 순서

```bash
cd fact-extraction

# 1. 테이블 생성
node scripts/run-migration.js

# 2. 시나리오 기반 더미 데이터 생성
node scripts/generate-scenario-data.js
# 또는 대화형 입력:
node scripts/generate-scenario-data.js --interactive

# 3. source_event 자동 채우기
node scripts/populate-source-events.js

# 4. LLM fact 추출
node scripts/extract-facts.js

# 5. 분포 분석
node scripts/analyze-distribution.js

# 전체 한 번에 실행
node scripts/run-all.js
```

## fact_type 정의 (8개 고정)

| Type | 설명 | 예시 |
|------|------|------|
| `PREFERENCE` | 선호 (좋아하는 것) | 커피, 와인, 골프 |
| `DISLIKE` | 비선호 (싫어하는 것) | 라벤더 향, 해산물 |
| `RISK` | 리스크/주의사항 | 견과류 알레르기, 당뇨 |
| `CONSTRAINT` | 제약조건 | 예산 10만원, 저녁 미팅 불가 |
| `DATE` | 기념일/중요 날짜 | 생일 5/15, 결혼기념일 |
| `ROLE_OR_ORG` | 역할/조직 정보 | CTO, 마케팅팀 |
| `INTERACTION` | 상호작용 기록 | 첫 미팅, 점심 식사 |
| `CONTEXT` | 맥락/상황 정보 | 채식주의자, 2자녀 |

## source_type 정의 (5개)

| Type | 원본 테이블 | 설명 |
|------|-------------|------|
| `CARD` | business_cards | 명함 기본 정보 + 짧은 메모 |
| `MEMO` | memo | 미팅 후 회고/관찰 기록 |
| `EVENT` | events | 시간 기반 상호작용 |
| `GIFT` | gifts | 선물 이력 |
| `CHAT` | chats | 선물 추천 대화 |

## 8단계 진행 계획

| # | 단계 | 스크립트 | 상태 |
|---|------|----------|------|
| 1 | DB 테이블 생성 | `run-migration.js` | ✅ |
| 2 | 시나리오 설계 | (README) | ✅ |
| 3 | LLM에 시나리오 전달 | `generate-scenario-data.js` | ✅ |
| 4 | 합성 데이터 생성 | `generate-scenario-data.js` | ✅ |
| 5 | source_event 자동화 | `populate-source-events.js` | ✅ |
| 6 | 분포 점검 | `analyze-distribution.js` | ✅ |
| 7 | fact 추출 | `extract-facts.js` | ✅ |
| 8 | 사전화 | (예정) | ⏳ |

## 중요 제약사항

1. **LLM은 DB에 직접 INSERT하지 않음**
   - LLM → JSON 출력 → 서버 검증 → INSERT

2. **chats.messages 파싱 규칙**
   - `추가 정보: ...` → additional
   - user의 첫 메시지 → userPrompt
   - `선택한 선물: ...` → selectedGift

3. **events.linked_card_ids 처리**
   - 콤마 구분 문자열
   - event 1개 → source_event 여러 개 가능

## API 사용량 주의

- `generate-scenario-data.js`: 시나리오당 1회 LLM 호출 (~8000 토큰)
- `extract-facts.js`: source_event당 1회 LLM 호출
- Rate limiting: 호출 간 500ms 대기

## 향후 계획

1. **fact_dictionary 구축**: fact_key 클러스터링 → 정규화
2. **Outbox 패턴**: 안정적인 이벤트 처리
3. **시각화 대시보드**: 관계 상태 시각화
4. **검색 API**: fact 기반 검색

## 문제 해결

### 마이그레이션 오류
```bash
# 테이블이 이미 존재하면 무시됨
node scripts/run-migration.js
```

### LLM 호출 실패
```bash
# 환경 변수 확인
echo $GOOGLE_GEMINI_API_KEY

# 단일 배치 재시도
node scripts/extract-facts.js --batch-size 1
```

### 데이터 검증
```bash
# 분포 분석으로 이상 징후 확인
node scripts/analyze-distribution.js --output report.json
```

