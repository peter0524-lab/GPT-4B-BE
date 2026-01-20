/**
 * Feature Extractor
 * 각 명함(cardId)에 대해 관계 관련 피처를 추출
 */
import { query } from "./db.js";
import config from "../config.js";

/**
 * 특정 cardId에 대한 모든 피처 추출
 */
export async function extractFeaturesForCard(cardId, userId = 1) {
  const features = {};
  
  // 기본 정보
  const basicFeatures = await extractBasicFeatures(cardId, userId);
  Object.assign(features, basicFeatures);
  
  // 상호작용(미팅) 피처
  const interactionFeatures = await extractInteractionFeatures(cardId, userId);
  Object.assign(features, interactionFeatures);
  
  // 메모 피처
  const memoFeatures = await extractMemoFeatures(cardId, userId);
  Object.assign(features, memoFeatures);
  
  // 선물 피처
  const giftFeatures = await extractGiftFeatures(cardId, userId);
  Object.assign(features, giftFeatures);
  
  // 채팅 피처
  const chatFeatures = await extractChatFeatures(cardId, userId);
  Object.assign(features, chatFeatures);
  
  // Fact 피처
  const factFeatures = await extractFactFeatures(cardId);
  Object.assign(features, factFeatures);
  
  return {
    cardId,
    features,
    extractedAt: new Date().toISOString()
  };
}

/**
 * 모든 명함에 대한 피처 추출
 */
export async function extractFeaturesForAllCards(userId = 1) {
  const cards = await query(
    `SELECT id, name, company, position FROM business_cards WHERE userId = ?`,
    [userId]
  );
  
  const results = [];
  for (const card of cards) {
    const cardFeatures = await extractFeaturesForCard(card.id, userId);
    results.push({
      ...cardFeatures,
      cardInfo: {
        name: card.name,
        company: card.company,
        position: card.position
      }
    });
  }
  
  return results;
}

/**
 * 기본 정보 피처
 */
async function extractBasicFeatures(cardId, userId) {
  const [card] = await query(
    `SELECT * FROM business_cards WHERE id = ? AND userId = ?`,
    [cardId, userId]
  );
  
  if (!card) return {};
  
  const now = new Date();
  const createdAt = new Date(card.createdAt);
  const daysSinceCreation = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
  
  return {
    daysSinceCreation,
    isFavorite: card.isFavorite ? 1 : 0,
    hasPhone: card.phone ? 1 : 0,
    hasEmail: card.email ? 1 : 0,
    hasMemo: card.memo ? 1 : 0,
  };
}

/**
 * 상호작용(미팅/일정) 피처
 */
async function extractInteractionFeatures(cardId, userId) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  
  // 총 미팅 수
  const [totalResult] = await query(
    `SELECT COUNT(*) as count FROM events 
     WHERE userId = ? AND FIND_IN_SET(?, linked_card_ids) > 0`,
    [userId, cardId]
  );
  const totalMeetings = totalResult?.count || 0;
  
  // 최근 30일 미팅
  const [last30Result] = await query(
    `SELECT COUNT(*) as count FROM events 
     WHERE userId = ? AND FIND_IN_SET(?, linked_card_ids) > 0
     AND startDate >= ?`,
    [userId, cardId, thirtyDaysAgo]
  );
  const meetingsLast30Days = last30Result?.count || 0;
  
  // 최근 90일 미팅
  const [last90Result] = await query(
    `SELECT COUNT(*) as count FROM events 
     WHERE userId = ? AND FIND_IN_SET(?, linked_card_ids) > 0
     AND startDate >= ?`,
    [userId, cardId, ninetyDaysAgo]
  );
  const meetingsLast90Days = last90Result?.count || 0;
  
  // 평균 미팅 시간
  const [durationResult] = await query(
    `SELECT AVG(TIMESTAMPDIFF(MINUTE, startDate, endDate)) as avgDuration
     FROM events 
     WHERE userId = ? AND FIND_IN_SET(?, linked_card_ids) > 0
     AND startDate IS NOT NULL AND endDate IS NOT NULL`,
    [userId, cardId]
  );
  const avgMeetingDuration = durationResult?.avgDuration || 0;
  
  // 마지막 미팅 경과일
  const [lastMeetingResult] = await query(
    `SELECT MAX(startDate) as lastDate FROM events 
     WHERE userId = ? AND FIND_IN_SET(?, linked_card_ids) > 0`,
    [userId, cardId]
  );
  let daysSinceLastMeeting = 999; // 기본값: 매우 오래됨
  if (lastMeetingResult?.lastDate) {
    daysSinceLastMeeting = Math.floor((now - new Date(lastMeetingResult.lastDate)) / (1000 * 60 * 60 * 24));
  }
  
  // 카테고리별 미팅 수
  const categoryResults = await query(
    `SELECT category, COUNT(*) as count FROM events 
     WHERE userId = ? AND FIND_IN_SET(?, linked_card_ids) > 0
     GROUP BY category`,
    [userId, cardId]
  );
  const meetingsByCategory = {};
  for (const row of categoryResults) {
    meetingsByCategory[`meetings_${row.category}`] = row.count;
  }
  
  return {
    totalMeetings,
    meetingsLast30Days,
    meetingsLast90Days,
    avgMeetingDuration: Math.round(avgMeetingDuration * 100) / 100,
    daysSinceLastMeeting,
    ...meetingsByCategory
  };
}

/**
 * 메모 피처
 */
async function extractMemoFeatures(cardId, userId) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  
  // 총 메모 수
  const [totalResult] = await query(
    `SELECT COUNT(*) as count FROM memo 
     WHERE user_id = ? AND business_card_id = ?`,
    [userId, cardId]
  );
  const totalMemos = totalResult?.count || 0;
  
  // 평균 메모 길이
  const [lengthResult] = await query(
    `SELECT AVG(LENGTH(content)) as avgLength FROM memo 
     WHERE user_id = ? AND business_card_id = ?`,
    [userId, cardId]
  );
  const avgMemoLength = lengthResult?.avgLength || 0;
  
  // 최근 30일 메모
  const [last30Result] = await query(
    `SELECT COUNT(*) as count FROM memo 
     WHERE user_id = ? AND business_card_id = ?
     AND created_at >= ?`,
    [userId, cardId, thirtyDaysAgo]
  );
  const memosLast30Days = last30Result?.count || 0;
  
  // 마지막 메모 경과일
  const [lastMemoResult] = await query(
    `SELECT MAX(created_at) as lastDate FROM memo 
     WHERE user_id = ? AND business_card_id = ?`,
    [userId, cardId]
  );
  let daysSinceLastMemo = 999;
  if (lastMemoResult?.lastDate) {
    daysSinceLastMemo = Math.floor((now - new Date(lastMemoResult.lastDate)) / (1000 * 60 * 60 * 24));
  }
  
  return {
    totalMemos,
    avgMemoLength: Math.round(avgMemoLength),
    memosLast30Days,
    daysSinceLastMemo,
  };
}

/**
 * 선물 피처
 */
async function extractGiftFeatures(cardId, userId) {
  // 총 선물 수
  const [totalResult] = await query(
    `SELECT COUNT(*) as count FROM gifts 
     WHERE userId = ? AND cardId = ?`,
    [userId, cardId]
  );
  const totalGifts = totalResult?.count || 0;
  
  // 평균/총 선물 금액
  const [priceResult] = await query(
    `SELECT AVG(price) as avgPrice, SUM(price) as totalPrice FROM gifts 
     WHERE userId = ? AND cardId = ?`,
    [userId, cardId]
  );
  const avgGiftPrice = priceResult?.avgPrice || 0;
  const totalGiftValue = priceResult?.totalPrice || 0;
  
  // 선물 상황 다양성 (고유한 occasion 수)
  const [occasionResult] = await query(
    `SELECT COUNT(DISTINCT occasion) as diversity FROM gifts 
     WHERE userId = ? AND cardId = ?`,
    [userId, cardId]
  );
  const giftOccasionDiversity = occasionResult?.diversity || 0;
  
  return {
    totalGifts,
    avgGiftPrice: Math.round(avgGiftPrice),
    totalGiftValue: Math.round(totalGiftValue),
    giftOccasionDiversity,
  };
}

/**
 * 채팅 피처
 */
async function extractChatFeatures(cardId, userId) {
  // 총 채팅 수
  const [totalResult] = await query(
    `SELECT COUNT(*) as count FROM chats 
     WHERE userId = ? AND cardId = ?`,
    [userId, cardId]
  );
  const totalChats = totalResult?.count || 0;
  
  // 평균 메시지 수
  const [msgResult] = await query(
    `SELECT AVG(JSON_LENGTH(messages)) as avgMsgs FROM chats 
     WHERE userId = ? AND cardId = ?`,
    [userId, cardId]
  );
  const avgMessagesPerChat = msgResult?.avgMsgs || 0;
  
  return {
    totalChats,
    avgMessagesPerChat: Math.round(avgMessagesPerChat * 100) / 100,
  };
}

/**
 * Extracted Fact 피처
 */
async function extractFactFeatures(cardId) {
  // 총 fact 수
  const [totalResult] = await query(
    `SELECT COUNT(*) as count FROM extracted_fact WHERE card_id = ?`,
    [cardId]
  );
  const totalFacts = totalResult?.count || 0;
  
  // fact_type별 수
  const typeResults = await query(
    `SELECT fact_type, COUNT(*) as count FROM extracted_fact 
     WHERE card_id = ? GROUP BY fact_type`,
    [cardId]
  );
  const factsByType = {};
  let preferenceCount = 0;
  let riskCount = 0;
  for (const row of typeResults) {
    factsByType[`fact_${row.fact_type.toLowerCase()}`] = row.count;
    if (row.fact_type === 'PREFERENCE') preferenceCount = row.count;
    if (row.fact_type === 'RISK') riskCount = row.count;
  }
  
  // 평균 신뢰도
  const [confidenceResult] = await query(
    `SELECT AVG(confidence) as avgConf FROM extracted_fact WHERE card_id = ?`,
    [cardId]
  );
  const avgConfidence = confidenceResult?.avgConf || 0;
  
  // polarity 분포
  const [positiveResult] = await query(
    `SELECT COUNT(*) as count FROM extracted_fact 
     WHERE card_id = ? AND polarity = 1`,
    [cardId]
  );
  const positivePolarity = positiveResult?.count || 0;
  
  const [negativeResult] = await query(
    `SELECT COUNT(*) as count FROM extracted_fact 
     WHERE card_id = ? AND polarity = -1`,
    [cardId]
  );
  const negativePolarity = negativeResult?.count || 0;
  
  return {
    totalFacts,
    preferenceCount,
    riskCount,
    avgConfidence: Math.round(avgConfidence * 100) / 100,
    positivePolarity,
    negativePolarity,
    ...factsByType
  };
}

/**
 * LLM에 전달할 핵심 데이터만 추출 (토큰 절약)
 */
export async function extractEssentialDataForLLM(cardId, userId = 1) {
  // 기본 정보
  const [card] = await query(
    `SELECT name, company, position, memo, gender FROM business_cards 
     WHERE id = ? AND userId = ?`,
    [cardId, userId]
  );
  
  if (!card) return null;
  
  // 최근 메모 5개
  const recentMemos = await query(
    `SELECT content, created_at FROM memo 
     WHERE user_id = ? AND business_card_id = ?
     ORDER BY created_at DESC LIMIT 5`,
    [userId, cardId]
  );
  
  // 최근 일정 5개
  const recentEvents = await query(
    `SELECT title, category, startDate, memo FROM events 
     WHERE userId = ? AND FIND_IN_SET(?, linked_card_ids) > 0
     ORDER BY startDate DESC LIMIT 5`,
    [userId, cardId]
  );
  
  // 최근 선물 3개
  const recentGifts = await query(
    `SELECT giftName, occasion, price, purchaseDate FROM gifts 
     WHERE userId = ? AND cardId = ?
     ORDER BY purchaseDate DESC LIMIT 3`,
    [userId, cardId]
  );
  
  // 주요 fact (confidence 높은 순)
  const topFacts = await query(
    `SELECT fact_type, fact_key, polarity, confidence FROM extracted_fact 
     WHERE card_id = ?
     ORDER BY confidence DESC LIMIT 10`,
    [cardId]
  );
  
  return {
    cardId,
    basicInfo: card,
    recentMemos: recentMemos.map(m => ({
      content: m.content?.substring(0, 200), // 200자로 제한
      date: m.created_at
    })),
    recentEvents: recentEvents.map(e => ({
      title: e.title,
      category: e.category,
      date: e.startDate,
      memo: e.memo?.substring(0, 100)
    })),
    recentGifts,
    topFacts: topFacts.map(f => ({
      type: f.fact_type,
      key: f.fact_key,
      polarity: f.polarity,
      confidence: f.confidence
    }))
  };
}


