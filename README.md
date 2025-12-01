# GPT-4b Backend API

GPT-4b 선물 추천 및 명함 관리 애플리케이션의 백엔드 API 서버입니다.

## 기술 스택

- **Runtime**: Node.js (ES Modules)
- **Framework**: Express.js
- **Database**: MySQL (mysql2)
- **Authentication**: JWT (JSON Web Tokens)
- **Validation**: express-validator
- **Security**: Helmet, CORS

## 주요 기능

### 1. 인증 (Authentication)
- 이메일/비밀번호 회원가입 및 로그인
- JWT 기반 인증
- 소셜 로그인 (Google, Apple) - 구현 예정

### 2. 명함 관리 (Business Cards)
- 명함 CRUD 작업
- OCR을 통한 명함 정보 추출
- 명함 검색 및 필터링
- 명함 디자인 커스텀마이징

### 3. 선물 관리 (Gifts)
- 선물 이력 기록
- LLM 기반 선물 추천
- 선물 카테고리 및 가격 관리

### 4. 캘린더 (Calendar)
- 일정 생성, 수정, 삭제
- 날짜별 일정 조회
- 카테고리별 일정 관리
- 구글 캘린더 연동 (구현 예정)

### 5. LLM 채팅 (Chat)
- OpenAI GPT, Anthropic Claude, Google Gemini 지원
- 대화 이력 저장
- 멀티 LLM 선택

### 6. 사용자 관리 (Users)
- 프로필 관리
- 구독 정보 관리

## 프로젝트 구조

```
BE/
├── src/
│   ├── config/          # 설정 파일
│   │   └── database.js  # MySQL 연결 풀 설정
│   ├── middleware/      # 미들웨어
│   │   ├── auth.middleware.js
│   │   ├── errorHandler.js
│   │   └── notFound.js
│   ├── models/          # 데이터베이스 모델 (MySQL)
│   │   ├── User.model.js
│   │   ├── BusinessCard.model.js
│   │   ├── Gift.model.js
│   │   ├── Event.model.js
│   │   └── Chat.model.js
│   ├── routes/          # API 라우터
│   │   ├── auth.routes.js
│   │   ├── card.routes.js
│   │   ├── ocr.routes.js
│   │   ├── gift.routes.js
│   │   ├── calendar.routes.js
│   │   ├── chat.routes.js
│   │   └── user.routes.js
│   ├── services/        # 비즈니스 로직
│   │   ├── ocr.service.js
│   │   └── llm.service.js
│   ├── utils/           # 유틸리티
│   │   └── jwt.js
│   └── server.js        # 서버 진입점
├── .env.example         # 환경 변수 예시
├── .gitignore
├── package.json
└── README.md
```

## 설치 및 실행

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경 변수 설정

`.env` 파일을 생성하고 필요한 값들을 설정하세요.

```bash
# .env 파일 생성
PORT=3000
NODE_ENV=development

# MySQL 데이터베이스 설정
DB_HOST=127.0.0.1
DB_USER=root
DB_PASSWORD=peter0524!
DB_NAME=backendTest
DB_PORT=3306

# JWT
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRE=7d

# CORS
FRONTEND_URL=http://localhost:5173

# OCR API (Google Cloud Vision 또는 다른 OCR 서비스)
GOOGLE_CLOUD_VISION_API_KEY=your-google-cloud-vision-api-key

# LLM APIs
OPENAI_API_KEY=your-openai-api-key
ANTHROPIC_API_KEY=your-anthropic-api-key
GOOGLE_GEMINI_API_KEY=your-google-gemini-api-key
```

### 3. MySQL 데이터베이스 설정

MySQL 서버가 실행 중이어야 합니다. 데이터베이스 `backendTest`가 존재해야 하며, 서버 시작 시 자동으로 테이블이 생성됩니다.

```sql
-- MySQL에서 데이터베이스 생성
CREATE DATABASE IF NOT EXISTS backendTest CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 4. 서버 실행

```bash
# 개발 모드 (nodemon 사용)
npm run dev

# 프로덕션 모드
npm start
```

서버는 기본적으로 `http://localhost:3000`에서 실행됩니다.

## 데이터베이스 스키마

서버 시작 시 다음 테이블들이 자동으로 생성됩니다:

- **users**: 사용자 정보
- **business_cards**: 명함 정보
- **gifts**: 선물 이력
- **events**: 캘린더 이벤트
- **chats**: LLM 채팅 대화

## API 엔드포인트

### 인증 (Authentication)

- `POST /api/auth/register` - 회원가입
- `POST /api/auth/login` - 로그인
- `GET /api/auth/me` - 현재 사용자 정보 조회
- `POST /api/auth/google` - Google OAuth 로그인 (구현 예정)
- `POST /api/auth/apple` - Apple OAuth 로그인 (구현 예정)

### 명함 (Business Cards)

- `GET /api/cards` - 명함 목록 조회 (검색, 페이지네이션 지원)
- `GET /api/cards/:id` - 명함 상세 조회
- `POST /api/cards` - 명함 생성
- `PUT /api/cards/:id` - 명함 수정
- `DELETE /api/cards/:id` - 명함 삭제

### OCR

- `POST /api/ocr/process` - 이미지 OCR 처리

### 선물 (Gifts)

- `GET /api/gifts` - 선물 이력 조회
- `POST /api/gifts` - 선물 기록 생성
- `POST /api/gifts/recommend` - LLM 기반 선물 추천 (구현 예정)

### 캘린더 (Calendar)

- `GET /api/calendar/events` - 일정 조회 (날짜 범위 필터링)
- `POST /api/calendar/events` - 일정 생성
- `PUT /api/calendar/events/:id` - 일정 수정
- `DELETE /api/calendar/events/:id` - 일정 삭제

### 채팅 (Chat)

- `GET /api/chat` - 대화 목록 조회
- `GET /api/chat/:id` - 대화 상세 조회
- `POST /api/chat` - 새 메시지 전송 또는 새 대화 시작
- `DELETE /api/chat/:id` - 대화 삭제

### 사용자 (Users)

- `GET /api/users/profile` - 프로필 조회
- `PUT /api/users/profile` - 프로필 수정

## 인증 방식

모든 보호된 엔드포인트는 JWT 토큰이 필요합니다. 요청 헤더에 다음과 같이 포함하세요:

```
Authorization: Bearer <your-jwt-token>
```

## MySQL 연결 설정

데이터베이스 연결은 `src/config/database.js`에서 관리됩니다. 연결 풀 설정:

- **timezone**: +09:00 (한국 시간대)
- **connectionLimit**: 100 (최대 연결 수)
- **enableKeepAlive**: true (연결 유지)
- **multipleStatements**: true (여러 SQL 쿼리 실행 허용)

## 개발 참고사항

### OCR 서비스
현재는 Google Cloud Vision API를 지원하며, API 키가 없을 경우 Mock 응답을 반환합니다.
다른 OCR 서비스 (AWS Textract, Azure Computer Vision 등)로 확장 가능합니다.

### LLM 서비스
OpenAI GPT, Anthropic Claude, Google Gemini를 지원합니다.
각 서비스의 API 키를 `.env` 파일에 설정해야 합니다.

### 에러 처리
모든 에러는 일관된 형식으로 반환됩니다:
```json
{
  "success": false,
  "message": "Error message",
  "errors": [] // Validation errors (optional)
}
```

### 성공 응답
성공적인 응답은 다음과 같은 형식입니다:
```json
{
  "success": true,
  "data": {},
  "pagination": {} // 페이지네이션 정보 (optional)
}
```

## 향후 구현 예정

- [ ] Google OAuth 인증
- [ ] Apple OAuth 인증
- [ ] 구글 캘린더 연동
- [ ] 파일 업로드 (Multer)
- [ ] 이미지 저장 (Cloud Storage)
- [ ] 선물 추천 LLM 통합
- [ ] 이메일 알림
- [ ] 푸시 알림
- [ ] API 문서화 (Swagger/OpenAPI)
- [ ] 단위 테스트 및 통합 테스트
- [ ] 로깅 시스템
- [ ] Rate limiting
- [ ] 캐싱 (Redis)

## 라이선스

ISC
