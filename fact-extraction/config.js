/**
 * fact-extraction 프로젝트 설정
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 상위 디렉토리의 .env 로드
dotenv.config({ path: path.join(__dirname, "..", ".env") });

export const config = {
  // 데이터베이스 설정
  db: {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "HCI_2025",
    port: parseInt(process.env.DB_PORT) || 3306,
  },

  // LLM 설정 (OpenAI)
  llm: {
    provider: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.LLM_MODEL || "gpt-4o-mini",
    maxTokens: 8000,
    temperature: 0.7,
  },

  // source_type 정의
  sourceTypes: {
    CARD: "CARD",
    MEMO: "MEMO",
    EVENT: "EVENT",
    GIFT: "GIFT",
    CHAT: "CHAT",
  },

  // fact_type 정의 (8개 고정)
  factTypes: [
    "PREFERENCE", // 선호 (좋아하는 것)
    "DISLIKE", // 비선호 (싫어하는 것)
    "RISK", // 리스크/주의사항
    "CONSTRAINT", // 제약조건
    "DATE", // 기념일/중요 날짜
    "ROLE_OR_ORG", // 역할/조직 정보
    "INTERACTION", // 상호작용 기록
    "CONTEXT", // 맥락/상황 정보
  ],

  // 워커 설정
  worker: {
    pollIntervalMs: 5000, // 5초마다 폴링
    batchSize: 50, // 한 번에 처리할 레코드 수
  },

  // 시나리오 생성 설정
  scenario: {
    // 생성할 데이터 수
    counts: {
      users: 1, // 시나리오당 사용자 1명
      cardsPerUser: 1, // 사용자당 명함 1개
      memosPerCard: 10, // 명함당 메모 10개
      eventsPerCard: 10, // 명함당 일정 10개
      giftsPerCard: 1, // 명함당 선물 1개
      chatsPerCard: 1, // 명함당 채팅 1개
    },
  },
};

export default config;

