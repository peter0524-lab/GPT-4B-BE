/**
 * Graph Extraction 설정
 */
import dotenv from "dotenv";
dotenv.config({ path: "../.env" });

export default {
  db: {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
  },
  
  // 피처 필터링 기준
  featureFilter: {
    // 분산 계수(CV) 최소값: 이 값보다 낮으면 피처 제외 (모두 비슷한 값)
    minCoefficientOfVariation: 0.3,
    // 최소 엔트로피: 카테고리형 피처의 다양성 기준
    minEntropy: 0.5,
    // 최소 유효 데이터 비율: 이 비율 이상의 카드가 값을 가져야 함
    minDataCoverage: 0.3,
  },
  
  // LLM 분석 설정
  llmAnalysis: {
    model: "gpt-4o-mini",          // 사용할 모델
    temperature: 0.3,              // 일관성을 위해 낮게 설정
    maxTokens: 1000,
    batchDelayMs: 500,             // Rate limit 방지용 딜레이
  },
  
  // 피처 정의
  features: {
    // 상호작용 관련
    interaction: [
      { key: "totalMeetings", label: "총 미팅 횟수", type: "numeric" },
      { key: "meetingsLast30Days", label: "최근 30일 미팅", type: "numeric" },
      { key: "meetingsLast90Days", label: "최근 90일 미팅", type: "numeric" },
      { key: "avgMeetingDuration", label: "평균 미팅 시간(분)", type: "numeric" },
      { key: "daysSinceLastMeeting", label: "마지막 미팅 경과일", type: "numeric" },
    ],
    // 메모 관련
    memo: [
      { key: "totalMemos", label: "총 메모 수", type: "numeric" },
      { key: "avgMemoLength", label: "평균 메모 길이", type: "numeric" },
      { key: "memosLast30Days", label: "최근 30일 메모", type: "numeric" },
      { key: "daysSinceLastMemo", label: "마지막 메모 경과일", type: "numeric" },
    ],
    // 선물 관련
    gift: [
      { key: "totalGifts", label: "총 선물 횟수", type: "numeric" },
      { key: "avgGiftPrice", label: "평균 선물 금액", type: "numeric" },
      { key: "totalGiftValue", label: "총 선물 금액", type: "numeric" },
      { key: "giftOccasionDiversity", label: "선물 상황 다양성", type: "numeric" },
    ],
    // 채팅 관련
    chat: [
      { key: "totalChats", label: "총 채팅 횟수", type: "numeric" },
      { key: "avgMessagesPerChat", label: "평균 메시지 수", type: "numeric" },
    ],
    // Fact 관련
    fact: [
      { key: "totalFacts", label: "총 fact 수", type: "numeric" },
      { key: "preferenceCount", label: "선호도 fact 수", type: "numeric" },
      { key: "riskCount", label: "리스크 fact 수", type: "numeric" },
      { key: "avgConfidence", label: "평균 신뢰도", type: "numeric" },
      { key: "positivePolarity", label: "긍정 polarity 수", type: "numeric" },
      { key: "negativePolarity", label: "부정 polarity 수", type: "numeric" },
    ],
    // 기본 정보
    basic: [
      { key: "daysSinceCreation", label: "명함 등록 경과일", type: "numeric" },
      { key: "isFavorite", label: "즐겨찾기 여부", type: "boolean" },
      { key: "hasPhone", label: "전화번호 유무", type: "boolean" },
      { key: "hasEmail", label: "이메일 유무", type: "boolean" },
    ],
  },
  
  server: {
    port: 3002,
  }
};


