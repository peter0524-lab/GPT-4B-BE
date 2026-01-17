/**
 * 각 source_type별 raw_text 생성기
 * 모든 원본 데이터를 LLM이 이해할 수 있는 표준 텍스트로 변환
 */

import { parseChatMessages } from "./chat-parser.js";
import { eventToRawText } from "./event-parser.js";

/**
 * business_cards를 raw_text로 변환
 * @param {Object} card - business_cards 레코드
 * @returns {string} raw_text
 */
export const cardToRawText = (card) => {
  const parts = [];

  parts.push(`[명함 정보]`);

  if (card.name) {
    parts.push(`이름: ${card.name}`);
  }

  if (card.position) {
    parts.push(`직책: ${card.position}`);
  }

  if (card.company) {
    parts.push(`회사: ${card.company}`);
  }

  if (card.phone) {
    parts.push(`전화: ${card.phone}`);
  }

  if (card.email) {
    parts.push(`이메일: ${card.email}`);
  }

  if (card.gender) {
    parts.push(`성별: ${card.gender}`);
  }

  // 명함 내 메모 (중요!)
  if (card.memo) {
    parts.push(`[메모] ${card.memo}`);
  }

  return parts.join("\n");
};

/**
 * memo를 raw_text로 변환
 * @param {Object} memo - memo 레코드
 * @param {Object} card - 연결된 business_card 레코드 (선택)
 * @returns {string} raw_text
 */
export const memoToRawText = (memo, card = null) => {
  const parts = [];

  // 연결된 명함 정보
  if (card) {
    parts.push(`[대상] ${card.name}${card.company ? ` (${card.company})` : ""}`);
  }

  // 작성 시간
  if (memo.created_at) {
    const date = new Date(memo.created_at);
    parts.push(`[작성일] ${date.toLocaleDateString("ko-KR")}`);
  }

  // 메모 내용 (핵심)
  parts.push(`[메모 내용]\n${memo.content}`);

  return parts.join("\n");
};

/**
 * gifts를 raw_text로 변환
 * @param {Object} gift - gifts 레코드
 * @param {Object} card - 연결된 business_card 레코드 (선택)
 * @returns {string} raw_text
 */
export const giftToRawText = (gift, card = null) => {
  const parts = [];

  // 선물 기본 정보
  parts.push(`[선물] ${gift.giftName}`);

  // 수령인 정보
  if (card) {
    parts.push(`[수령인] ${card.name}${card.company ? ` (${card.company})` : ""}`);
  }

  // 날짜
  if (gift.purchaseDate) {
    const date = new Date(gift.purchaseDate);
    parts.push(`[날짜] ${date.toLocaleDateString("ko-KR")}`);
  }

  // 카테고리
  if (gift.category) {
    parts.push(`[카테고리] ${gift.category}`);
  }

  // 가격
  if (gift.price) {
    parts.push(`[가격] ${Number(gift.price).toLocaleString()}원`);
  }

  // 행사/이유
  if (gift.occasion) {
    parts.push(`[행사] ${gift.occasion}`);
  }

  // 설명
  if (gift.giftDescription) {
    parts.push(`[설명] ${gift.giftDescription}`);
  }

  // 메모
  if (gift.notes) {
    parts.push(`[메모] ${gift.notes}`);
  }

  return parts.join("\n");
};

/**
 * chats를 raw_text로 변환
 * @param {Object} chat - chats 레코드
 * @param {Object} card - 연결된 business_card 레코드 (선택)
 * @returns {string} raw_text
 */
export const chatToRawText = (chat, card = null) => {
  const parsed = parseChatMessages(chat.messages);
  
  const parts = [];

  // 대화 제목
  if (chat.title) {
    parts.push(`[선물 추천 대화] ${chat.title}`);
  } else {
    parts.push(`[선물 추천 대화]`);
  }

  // 대상 정보
  if (card) {
    parts.push(`[대상] ${card.name}${card.company ? ` (${card.company})` : ""}`);
  }

  // 파싱된 핵심 정보
  if (parsed.additional) {
    parts.push(`[추가 정보] ${parsed.additional}`);
  }

  if (parsed.userPrompt) {
    parts.push(`[사용자 질문] ${parsed.userPrompt}`);
  }

  if (parsed.selectedGift) {
    parts.push(`[선택한 선물] ${parsed.selectedGift}`);
  }

  // 시간 정보
  if (chat.createdAt) {
    const date = new Date(chat.createdAt);
    parts.push(`[대화 시작] ${date.toLocaleDateString("ko-KR")}`);
  }

  return parts.join("\n");
};

/**
 * 소스 타입에 따라 적절한 변환 함수 호출
 * @param {string} sourceType - CARD, MEMO, EVENT, GIFT, CHAT
 * @param {Object} record - 원본 레코드
 * @param {Object} card - 연결된 명함 (선택)
 * @returns {string} raw_text
 */
export const buildRawText = (sourceType, record, card = null) => {
  switch (sourceType) {
    case "CARD":
      return cardToRawText(record);
    case "MEMO":
      return memoToRawText(record, card);
    case "EVENT":
      return eventToRawText(record, card);
    case "GIFT":
      return giftToRawText(record, card);
    case "CHAT":
      return chatToRawText(record, card);
    default:
      throw new Error(`Unknown source type: ${sourceType}`);
  }
};

export default {
  cardToRawText,
  memoToRawText,
  giftToRawText,
  chatToRawText,
  buildRawText,
};

