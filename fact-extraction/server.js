/**
 * Fact Extraction Pipeline API Server
 * 
 * 시나리오 입력 → 전체 파이프라인 실행을 위한 API 서버
 */

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { 
  generateDummyData, 
  populateSourceEvents, 
  extractFactsForUser 
} from "./lib/scenario-pipeline.js";
import { generateScenarioOptions } from "./lib/llm-client.js";
import { query, getConnection, closePool } from "./lib/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.FACT_SERVER_PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Static files (프론트엔드)
app.use(express.static(path.join(__dirname, "public")));

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Fact Extraction API is running" });
});

/**
 * 기존 명함 목록 조회
 * GET /api/cards
 */
app.get("/api/cards", async (req, res) => {
  try {
    const cards = await query(`
      SELECT bc.*, 
        (SELECT COUNT(*) FROM memo WHERE business_card_id = bc.id) as memoCount,
        (SELECT COUNT(*) FROM gifts WHERE cardId = bc.id) as giftCount
      FROM business_cards bc 
      WHERE bc.userId = 1 
      ORDER BY bc.createdAt DESC
    `);

    res.json({
      success: true,
      cards: cards,
      total: cards.length,
    });
  } catch (error) {
    console.error("명함 목록 조회 오류:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 기존 명함에 대해 추가 데이터 생성 (미리보기)
 * POST /api/scenario/preview-for-card
 * Body: { cardId: number, card: object }
 */
app.post("/api/scenario/preview-for-card", async (req, res) => {
  try {
    const { cardId, card } = req.body;

    if (!cardId || !card) {
      return res.status(400).json({ error: "cardId와 card 정보가 필요합니다." });
    }

    console.log("=== 기존 명함 추가 데이터 생성 ===");
    console.log("Card ID:", cardId, "Name:", card.name);

    // 기존 데이터 조회 (중복 방지용)
    const existingMemos = await query(
      `SELECT content FROM memo WHERE business_card_id = ? ORDER BY created_at DESC LIMIT 20`,
      [cardId]
    );
    const existingEvents = await query(
      `SELECT title, category, DATE(startDate) as date FROM events WHERE linked_card_ids LIKE ? ORDER BY startDate DESC LIMIT 20`,
      [`%${cardId}%`]
    );
    const existingGifts = await query(
      `SELECT giftName, occasion, DATE(purchaseDate) as date FROM gifts WHERE cardId = ? ORDER BY purchaseDate DESC LIMIT 20`,
      [cardId]
    );
    const existingChats = await query(
      `SELECT title FROM chats WHERE userId = 1 AND title LIKE ? ORDER BY createdAt DESC LIMIT 10`,
      [`%${card.name}%`]
    );

    const existingData = {
      memos: existingMemos.map(m => m.content?.substring(0, 100)),
      events: existingEvents.map(e => `${e.title} (${e.category}, ${e.date})`),
      gifts: existingGifts.map(g => `${g.giftName} (${g.occasion}, ${g.date})`),
      chats: existingChats.map(c => c.title),
    };

    console.log("기존 데이터:", {
      memos: existingData.memos.length,
      events: existingData.events.length,
      gifts: existingData.gifts.length,
      chats: existingData.chats.length,
    });

    const { generateDataForExistingCard } = await import("./lib/llm-client.js");
    const generatedData = await generateDataForExistingCard(card, existingData);

    // cardId를 데이터에 매핑
    generatedData.cardId = cardId;

    res.json({
      success: true,
      cardId,
      cardName: card.name,
      data: generatedData,
      existingCounts: {
        memos: existingData.memos.length,
        events: existingData.events.length,
        gifts: existingData.gifts.length,
        chats: existingData.chats.length,
      },
      summary: {
        memos: (generatedData.memos || []).length,
        events: (generatedData.events || []).length,
        gifts: (generatedData.gifts || []).length,
        chats: (generatedData.chats || []).length,
      }
    });
  } catch (error) {
    console.error("기존 명함 데이터 생성 오류:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 기존 명함 데이터 DB 저장
 * POST /api/scenario/confirm-for-card
 * Body: { cardId: number, data: object }
 */
app.post("/api/scenario/confirm-for-card", async (req, res) => {
  const connection = await getConnection();
  
  try {
    const { cardId, data } = req.body;

    if (!cardId || !data) {
      return res.status(400).json({ error: "cardId와 data가 필요합니다." });
    }

    console.log("=== 기존 명함 데이터 DB 저장 ===");
    console.log(`대상 명함 ID: ${cardId}`);
    
    // 저장 시작 시간 기록 (createdAfter 필터용)
    const saveStartTime = new Date().toISOString();
    
    await connection.beginTransaction();
    
    const userId = 1;
    
    // ⚠️ cardId가 실제 존재하는지 확인
    const [cardCheck] = await connection.query(
      `SELECT id, name FROM business_cards WHERE id = ? AND userId = ?`,
      [cardId, userId]
    );
    if (!cardCheck || cardCheck.length === 0) {
      throw new Error(`cardId=${cardId}가 business_cards에 존재하지 않습니다.`);
    }
    console.log(`명함 확인 완료: ${cardCheck[0].name} (id=${cardId})`);
    
    let memosCount = 0, eventsCount = 0, giftsCount = 0, chatsCount = 0;

    // 메모 저장
    for (const memo of (data.memos || [])) {
      if (!memo.content || memo.content.trim() === '') {
        console.log(`스킵: memo, content가 비어있음`);
        continue;
      }
      await connection.query(
        `INSERT INTO memo (user_id, business_card_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        [userId, cardId, memo.content.trim(), memo.created_at || new Date(), memo.updated_at || new Date()]
      );
      console.log(`메모 저장: cardId=${cardId}`);
      memosCount++;
    }

    // 일정 저장
    for (const event of (data.events || [])) {
      if (!event.title) {
        console.log(`스킵: event, title이 없음`);
        continue;
      }
      const validCategory = ["미팅", "식사", "출장", "통화", "기타"].includes(event.category) ? event.category : "기타";
      const startDate = event.startDate || new Date().toISOString();
      const endDate = event.endDate || startDate;
      
      await connection.query(
        `INSERT INTO events (userId, title, startDate, endDate, category, description, location, participants, memo, notification, isAllDay, linked_card_ids, color)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, event.title, startDate, endDate, validCategory, event.description || null, event.location || null,
         event.participants || null, event.memo || null, event.notification || 30, event.isAllDay ? 1 : 0, String(cardId), event.color || "#4285F4"]
      );
      console.log(`일정 저장: linked_card_ids=${cardId} (${event.title})`);
      eventsCount++;
    }

    // 선물 저장
    for (const gift of (data.gifts || [])) {
      if (!gift.giftName) {
        console.log(`스킵: gift, giftName이 없음`);
        continue;
      }
      const purchaseDate = gift.purchaseDate || new Date().toISOString();
      const year = gift.year || new Date(purchaseDate).getFullYear();
      
      await connection.query(
        `INSERT INTO gifts (userId, cardId, giftName, giftDescription, price, category, purchaseDate, occasion, notes, year)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, cardId, gift.giftName, gift.giftDescription || null, gift.price || 0, gift.category || '기타',
         purchaseDate, gift.occasion || '기타', gift.notes || null, year]
      );
      console.log(`선물 저장: cardId=${cardId} (${gift.giftName})`);
      giftsCount++;
    }

    // 채팅 저장
    for (const chat of (data.chats || [])) {
      if (!chat.messages || !Array.isArray(chat.messages)) {
        console.log(`스킵: chat, messages가 없거나 배열이 아님`);
        continue;
      }
      await connection.query(
        `INSERT INTO chats (userId, llmProvider, title, messages, isActive, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, "gpt", chat.title || '선물 추천 대화', JSON.stringify(chat.messages), 1, chat.createdAt || new Date()]
      );
      console.log(`채팅 저장: (${chat.title || '선물 추천 대화'})`);
      chatsCount++;
    }

    await connection.commit();
    console.log(`✅ 저장 완료: 메모 ${memosCount}, 일정 ${eventsCount}, 선물 ${giftsCount}, 채팅 ${chatsCount}`);

    res.json({
      success: true,
      userId,
      cardId,
      cardName: cardCheck[0].name,
      createdAfter: saveStartTime,  // source_event 생성 시 이 시간 이후 데이터만 처리
      summary: {
        memos: memosCount,
        events: eventsCount,
        gifts: giftsCount,
        chats: chatsCount,
      }
    });
  } catch (error) {
    await connection.rollback();
    console.error("기존 명함 데이터 저장 오류:", error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

/**
 * 시나리오 옵션 생성 (LLM이 제안)
 * POST /api/scenario/suggest
 * Body: { domain: string } (예: "비즈니스", "개인", "영업")
 */
app.post("/api/scenario/suggest", async (req, res) => {
  try {
    const { domain = "비즈니스" } = req.body;

    console.log("=== 시나리오 옵션 생성 시작 ===");
    console.log("도메인:", domain);

    const options = await generateScenarioOptions(domain);

    console.log(`시나리오 옵션 ${options.length}개 생성 완료`);

    res.json({
      success: true,
      domain,
      options,
    });
  } catch (error) {
    console.error("시나리오 옵션 생성 오류:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 선택된 시나리오로 상세 시나리오 텍스트 생성
 * POST /api/scenario/expand
 * Body: { selectedOption: object }
 */
app.post("/api/scenario/expand", async (req, res) => {
  try {
    const { selectedOption } = req.body;

    if (!selectedOption) {
      return res.status(400).json({ error: "선택된 시나리오가 필요합니다." });
    }

    console.log("=== 선택된 시나리오 확장 ===");
    console.log("시나리오:", selectedOption.title);

    // 선택된 옵션을 상세 시나리오 텍스트로 변환
    const scenarioText = buildScenarioText(selectedOption);

    res.json({
      success: true,
      scenario: scenarioText,
      option: selectedOption,
    });
  } catch (error) {
    console.error("시나리오 확장 오류:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 선택된 시나리오 옵션을 텍스트로 변환 (주인공 정보 없이 관계 인물만)
 */
function buildScenarioText(option) {
  let text = `[${option.title}]\n\n`;

  (option.contacts || []).forEach((contact, index) => {
    text += `${index + 1}. ${contact.name} (${contact.position}, ${contact.company})`;
    if (contact.gender) text += ` - ${contact.gender}`;
    text += '\n';
    
    if (contact.traits && contact.traits.length > 0) {
      contact.traits.forEach(trait => {
        text += `   - ${trait}\n`;
      });
    }
    
    if (contact.interactions && contact.interactions.length > 0) {
      text += `   - 주요 만남: ${contact.interactions.join(', ')}\n`;
    }
    
    if (contact.gifts && contact.gifts.length > 0) {
      text += `   - 선물 이력: ${contact.gifts.join(', ')}\n`;
    }
    
    text += '\n';
  });

  return text.trim();
}

/**
 * Step 1: 시나리오로 더미 데이터 미리보기 (DB 저장 안함)
 * POST /api/scenario/preview
 * Body: { scenario: string }
 */
app.post("/api/scenario/preview", async (req, res) => {
  try {
    const { scenario } = req.body;

    if (!scenario || !scenario.trim()) {
      return res.status(400).json({ error: "시나리오가 필요합니다." });
    }

    console.log("=== 더미 데이터 미리보기 생성 ===");
    console.log("시나리오 길이:", scenario.length);

    // LLM으로 데이터만 생성 (DB 저장 안함)
    const { generateDummyData: llmGenerateDummyData } = await import("./lib/llm-client.js");
    const generatedData = await llmGenerateDummyData(scenario);

    // 명함별로 데이터 그룹화
    const groupedByCard = {};
    
    for (let i = 0; i < (generatedData.business_cards || []).length; i++) {
      const card = generatedData.business_cards[i];
      const cardIndex = i + 1; // 1-based index
      
      groupedByCard[cardIndex] = {
        card: card,
        memos: [],
        events: [],
        gifts: [],
        chats: []
      };
    }

    // 메모 그룹화
    for (const memo of (generatedData.memo || [])) {
      const cardId = memo.business_card_id;
      if (groupedByCard[cardId]) {
        groupedByCard[cardId].memos.push(memo);
      }
    }

    // 일정 그룹화 (linked_card_ids 파싱)
    for (const event of (generatedData.events || [])) {
      const linkedIds = String(event.linked_card_ids || "").split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n));
      for (const cardId of linkedIds) {
        if (groupedByCard[cardId]) {
          groupedByCard[cardId].events.push(event);
        }
      }
    }

    // 선물 그룹화
    for (const gift of (generatedData.gifts || [])) {
      const cardId = gift.cardId;
      if (groupedByCard[cardId]) {
        groupedByCard[cardId].gifts.push(gift);
      }
    }

    // 채팅 그룹화 (title에서 명함 이름 추론)
    for (const chat of (generatedData.chats || [])) {
      // 모든 명함에 대해 제목에 이름이 포함되어 있는지 확인
      for (const [cardId, group] of Object.entries(groupedByCard)) {
        if (chat.title && chat.title.includes(group.card.name)) {
          group.chats.push(chat);
        }
      }
    }

    console.log("미리보기 생성 완료:", Object.keys(groupedByCard).length, "명함");

    res.json({
      success: true,
      rawData: generatedData,
      groupedByCard: groupedByCard,
      summary: {
        cards: (generatedData.business_cards || []).length,
        memos: (generatedData.memo || []).length,
        events: (generatedData.events || []).length,
        gifts: (generatedData.gifts || []).length,
        chats: (generatedData.chats || []).length,
      }
    });
  } catch (error) {
    console.error("미리보기 생성 오류:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Step 2: 미리보기 데이터 확인 후 DB 저장
 * POST /api/scenario/confirm
 * Body: { rawData: object }
 */
app.post("/api/scenario/confirm", async (req, res) => {
  try {
    const { rawData } = req.body;

    if (!rawData) {
      return res.status(400).json({ error: "데이터가 필요합니다." });
    }

    console.log("=== 데이터 DB 저장 시작 ===");
    
    // 저장 시작 시간 기록 (createdAfter 필터용)
    const saveStartTime = new Date().toISOString();

    const result = await generateDummyData(null, rawData); // rawData 직접 전달

    console.log("DB 저장 완료:", result.summary);

    res.json({
      success: true,
      userId: result.userId,
      cardIdMap: result.cardIdMap,
      createdAfter: saveStartTime,  // source_event 생성 시 이 시간 이후 데이터만 처리
      summary: result.summary,
    });
  } catch (error) {
    console.error("DB 저장 오류:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * (기존 호환) Step 1: 시나리오로 더미 데이터 생성 (바로 DB 저장)
 * POST /api/scenario/generate
 * Body: { scenario: string }
 */
app.post("/api/scenario/generate", async (req, res) => {
  try {
    const { scenario } = req.body;

    if (!scenario || !scenario.trim()) {
      return res.status(400).json({ error: "시나리오가 필요합니다." });
    }

    console.log("=== 더미 데이터 생성 시작 ===");
    console.log("시나리오 길이:", scenario.length);

    const result = await generateDummyData(scenario);

    console.log("더미 데이터 생성 완료:", result.summary);

    res.json({
      success: true,
      userId: result.userId,
      cardIdMap: result.cardIdMap,
      summary: result.summary,
    });
  } catch (error) {
    console.error("더미 데이터 생성 오류:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Step 2: source_event 생성
 * POST /api/scenario/populate-source
 * Body: { userId: number, cardIds?: number[], createdAfter?: string }
 * cardIds가 있으면 해당 명함들만 처리
 * createdAfter가 있으면 해당 시간 이후에 생성된 데이터만 처리
 */
app.post("/api/scenario/populate-source", async (req, res) => {
  try {
    const { userId, cardIds, createdAfter } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId가 필요합니다." });
    }

    console.log("=== source_event 생성 시작 ===");
    console.log("User ID:", userId);
    if (cardIds && cardIds.length > 0) {
      console.log("대상 명함 IDs:", cardIds);
    } else {
      console.log("대상: 모든 명함");
    }
    if (createdAfter) {
      console.log("createdAfter 필터:", createdAfter);
    }

    const results = await populateSourceEvents(userId, cardIds || null, createdAfter || null);

    console.log("source_event 생성 완료:", results);

    res.json({
      success: true,
      userId,
      cardIds: cardIds || "all",
      results,
    });
  } catch (error) {
    console.error("source_event 생성 오류:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Step 3: fact 추출
 * POST /api/scenario/extract-facts
 * Body: { userId: number, cardIds?: number[] }
 * cardIds가 있으면 해당 명함들만 처리, 없으면 모든 미처리 source_event 처리
 */
app.post("/api/scenario/extract-facts", async (req, res) => {
  try {
    const { userId, cardIds } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId가 필요합니다." });
    }

    console.log("=== Fact 추출 시작 ===");
    console.log("User ID:", userId);
    if (cardIds && cardIds.length > 0) {
      console.log("대상 명함 IDs:", cardIds);
    } else {
      console.log("대상: 모든 미처리 source_event");
    }

    const results = await extractFactsForUser(userId, cardIds || null);

    console.log("Fact 추출 완료:", results);

    res.json({
      success: true,
      userId,
      cardIds: cardIds || "all",
      ...results,
    });
  } catch (error) {
    console.error("Fact 추출 오류:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 전체 파이프라인 한 번에 실행
 * POST /api/scenario/run-all
 * Body: { scenario: string }
 */
app.post("/api/scenario/run-all", async (req, res) => {
  try {
    const { scenario } = req.body;

    if (!scenario || !scenario.trim()) {
      return res.status(400).json({ error: "시나리오가 필요합니다." });
    }

    console.log("=== 전체 파이프라인 시작 ===");

    // Step 1: 더미 데이터 생성
    console.log("Step 1: 더미 데이터 생성...");
    const generateResult = await generateDummyData(scenario);

    // 새로 생성된 명함 ID들 추출
    const newCardIds = Object.values(generateResult.cardIdMap);
    console.log("새로 생성된 명함 IDs:", newCardIds);

    // Step 2: source_event 생성 (새로 생성된 명함에 대해서만!)
    console.log("Step 2: source_event 생성 (대상 명함:", newCardIds, ")...");
    const sourceResult = await populateSourceEvents(generateResult.userId, newCardIds);

    // Step 3: fact 추출 (새로 생성된 명함에 대해서만!)
    console.log("Step 3: Fact 추출 (대상 명함:", newCardIds, ")...");
    const extractResult = await extractFactsForUser(generateResult.userId, newCardIds);

    console.log("=== 전체 파이프라인 완료 ===");

    res.json({
      success: true,
      userId: generateResult.userId,
      cardIds: newCardIds,
      generate: generateResult.summary,
      source: sourceResult,
      extract: extractResult,
    });
  } catch (error) {
    console.error("파이프라인 오류:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 통계 조회
 * GET /api/scenario/stats
 */
app.get("/api/scenario/stats", async (req, res) => {
  try {
    const [sourceStats] = await query(`
      SELECT 
        source_type,
        COUNT(*) as total,
        SUM(CASE WHEN is_processed THEN 1 ELSE 0 END) as processed
      FROM source_event
      GROUP BY source_type
    `);

    const [factStats] = await query(`
      SELECT 
        fact_type,
        COUNT(*) as count,
        AVG(confidence) as avg_confidence
      FROM extracted_fact
      GROUP BY fact_type
    `);

    const [totals] = await query(`
      SELECT
        (SELECT COUNT(*) FROM users) as users,
        (SELECT COUNT(*) FROM business_cards) as cards,
        (SELECT COUNT(*) FROM source_event) as source_events,
        (SELECT COUNT(*) FROM extracted_fact) as facts
    `);

    res.json({
      totals: totals[0],
      sourceEvents: sourceStats,
      facts: factStats,
    });
  } catch (error) {
    console.error("통계 조회 오류:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 분포 분석 API
 * GET /api/scenario/analyze
 */
app.get("/api/scenario/analyze", async (req, res) => {
  try {
    const result = {
      generatedAt: new Date().toISOString(),
      memo: await analyzeMemos(),
      chat: await analyzeChats(),
      sourceEvent: await analyzeSourceEvents(),
      fact: await analyzeFacts(),
      warnings: [],
    };

    // 이상 징후 체크
    if (result.memo.duplicateRate > 0.1) {
      result.warnings.push(`메모 중복률이 높음: ${(result.memo.duplicateRate * 100).toFixed(1)}%`);
    }
    if (result.memo.count < 10) {
      result.warnings.push(`메모 수가 적음: ${result.memo.count}개`);
    }
    if (result.fact.count === 0) {
      result.warnings.push(`추출된 fact가 없음`);
    } else if (result.fact.typeDistribution) {
      const types = Object.values(result.fact.typeDistribution);
      if (types.length > 0) {
        const maxType = Math.max(...types);
        const minType = Math.min(...types);
        if (minType > 0 && maxType / minType > 10) {
          result.warnings.push(`fact_type 분포가 불균형함 (최대/최소 = ${(maxType / minType).toFixed(1)})`);
        }
      }
    }

    res.json(result);
  } catch (error) {
    console.error("분포 분석 오류:", error);
    res.status(500).json({ error: error.message });
  }
});

// 분석 헬퍼 함수들

// Jaccard Similarity
function jaccardSimilarity(text1, text2) {
  const set1 = new Set(text1.toLowerCase().split(/\s+/));
  const set2 = new Set(text2.toLowerCase().split(/\s+/));
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return intersection.size / union.size;
}

// 중복률 계산
function calculateDuplicateRate(texts, threshold = 0.8) {
  if (texts.length < 2) return { rate: 0, pairs: [] };
  const duplicatePairs = [];
  let duplicateCount = 0;
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const similarity = jaccardSimilarity(texts[i], texts[j]);
      if (similarity >= threshold) {
        duplicateCount++;
        duplicatePairs.push({
          index1: i, index2: j,
          similarity: similarity.toFixed(2),
          preview1: texts[i].substring(0, 50),
          preview2: texts[j].substring(0, 50)
        });
      }
    }
  }
  const totalPairs = (texts.length * (texts.length - 1)) / 2;
  return { rate: duplicateCount / totalPairs, pairs: duplicatePairs };
}

// 길이 통계
function calculateLengthStats(texts) {
  if (texts.length === 0) return null;
  const lengths = texts.map(t => t.length).sort((a, b) => a - b);
  return {
    count: lengths.length,
    min: lengths[0],
    max: lengths[lengths.length - 1],
    avg: Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length),
    median: lengths[Math.floor(lengths.length / 2)],
    p25: lengths[Math.floor(lengths.length * 0.25)],
    p75: lengths[Math.floor(lengths.length * 0.75)]
  };
}

// 단어 빈도 분석
function analyzeWordFrequency(texts, topN = 20) {
  const wordCount = {};
  for (const text of texts) {
    const words = text.toLowerCase().replace(/[^\w\s가-힣]/g, '').split(/\s+/).filter(w => w.length > 1);
    for (const word of words) {
      wordCount[word] = (wordCount[word] || 0) + 1;
    }
  }
  return Object.entries(wordCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }));
}

// 메모 분석
async function analyzeMemos() {
  const memos = await query(`SELECT id, content, business_card_id FROM memo`);
  const contents = memos.map(m => m.content);
  const lengthStats = calculateLengthStats(contents);
  const duplicates = calculateDuplicateRate(contents);
  const wordFreq = analyzeWordFrequency(contents);
  
  const cardMemoCount = {};
  for (const memo of memos) {
    cardMemoCount[memo.business_card_id] = (cardMemoCount[memo.business_card_id] || 0) + 1;
  }

  return {
    type: 'memo',
    count: memos.length,
    lengthStats,
    duplicateRate: duplicates.rate,
    duplicatePairs: duplicates.pairs.slice(0, 5),
    topWords: wordFreq,
    cardDistribution: cardMemoCount
  };
}

// 채팅 분석
async function analyzeChats() {
  const chats = await query(`SELECT id, messages, title FROM chats WHERE isActive = TRUE`);
  
  const userPrompts = [];
  const additionalInfos = [];
  const selectedGifts = [];

  for (const chat of chats) {
    let msgs = chat.messages;
    if (typeof msgs === 'string') {
      try { msgs = JSON.parse(msgs); } catch { continue; }
    }
    if (!Array.isArray(msgs)) continue;

    for (const msg of msgs) {
      const content = msg.content || '';
      const role = msg.role || '';

      const additionalMatch = content.match(/추가\s*정보\s*[:：]\s*(.+)/i);
      if (additionalMatch) additionalInfos.push(additionalMatch[1].trim());

      if (role === 'user') {
        if (userPrompts.length === 0 || !userPrompts.includes(content)) {
          userPrompts.push(content.trim());
        }
        const selectedMatch = content.match(/선택한\s*선물\s*[:：]\s*(.+)/i);
        if (selectedMatch) selectedGifts.push(selectedMatch[1].trim());
      }
    }
  }

  const additionalFreq = {};
  for (const info of additionalInfos) {
    additionalFreq[info] = (additionalFreq[info] || 0) + 1;
  }

  return {
    type: 'chat',
    totalChats: chats.length,
    userPromptCount: userPrompts.length,
    additionalInfoCount: additionalInfos.length,
    selectedGiftCount: selectedGifts.length,
    additionalInfoDistribution: additionalFreq
  };
}

// Source Event 분석
async function analyzeSourceEvents() {
  const events = await query(`
    SELECT source_type, is_processed, COUNT(*) as count
    FROM source_event
    GROUP BY source_type, is_processed
  `);

  const distribution = {};
  for (const row of events) {
    if (!distribution[row.source_type]) {
      distribution[row.source_type] = { processed: 0, pending: 0 };
    }
    if (row.is_processed) {
      distribution[row.source_type].processed = row.count;
    } else {
      distribution[row.source_type].pending = row.count;
    }
  }

  return { type: 'source_event', distribution };
}

// Fact 분석
async function analyzeFacts() {
  const facts = await query(`
    SELECT ef.*, bc.name as card_name
    FROM extracted_fact ef
    JOIN business_cards bc ON ef.card_id = bc.id
  `);

  if (facts.length === 0) {
    return { type: 'fact', count: 0 };
  }

  const typeDistribution = {};
  for (const fact of facts) {
    typeDistribution[fact.fact_type] = (typeDistribution[fact.fact_type] || 0) + 1;
  }

  const keyFrequency = {};
  for (const fact of facts) {
    const key = fact.fact_key.toLowerCase();
    keyFrequency[key] = (keyFrequency[key] || 0) + 1;
  }
  const topKeys = Object.entries(keyFrequency).sort((a, b) => b[1] - a[1]).slice(0, 20);

  const confidences = facts.map(f => f.confidence);

  const cardFactCount = {};
  for (const fact of facts) {
    const key = fact.card_name || fact.card_id;
    cardFactCount[key] = (cardFactCount[key] || 0) + 1;
  }

  return {
    type: 'fact',
    count: facts.length,
    typeDistribution,
    topKeys,
    confidenceStats: {
      min: Math.min(...confidences),
      max: Math.max(...confidences),
      avg: confidences.reduce((a, b) => a + b, 0) / confidences.length
    },
    cardDistribution: cardFactCount
  };
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n서버 종료 중...");
  await closePool();
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║       Fact Extraction Pipeline Server                      ║
╠════════════════════════════════════════════════════════════╣
║  URL: http://localhost:${PORT}                              ║
║  API: http://localhost:${PORT}/api/scenario                 ║
╚════════════════════════════════════════════════════════════╝
  `);
});

export default app;

