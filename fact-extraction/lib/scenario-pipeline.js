/**
 * 시나리오 파이프라인 서비스
 * 
 * 시나리오 입력 → 원본 테이블 데이터 생성 → source_event → extracted_fact
 */

import { query, execute, getConnection, closePool } from "./db.js";
import { generateDummyData as llmGenerateDummyData, extractFacts as llmExtractFacts } from "./llm-client.js";
import { parseLinkedCardIds } from "./parsers/event-parser.js";
import { inferCardIdsFromChat } from "./parsers/chat-parser.js";
import { buildRawText } from "./parsers/source-text-builder.js";
import { validateFacts, deduplicateFacts } from "./validators/fact-validator.js";

/**
 * LLM 생성 데이터의 cardId/business_card_id를 실제 DB ID로 변환하는 유틸리티
 * LLM은 1-based 인덱스(cardId: 1 = 첫 번째 명함)를 생성함
 * @param {Object} item - LLM이 생성한 데이터 아이템
 * @param {Object} cardIdMap - {0: 실제DB_ID, 1: 실제DB_ID, ...}
 * @returns {number|null} 실제 DB의 card_id 또는 null
 */
function resolveCardId(item, cardIdMap) {
  // 가능한 필드들을 순서대로 확인
  const possibleFields = ['cardIndex', 'cardId', 'card_id', 'business_card_id'];
  
  for (const field of possibleFields) {
    if (item[field] !== undefined && item[field] !== null) {
      const value = parseInt(item[field]);
      if (isNaN(value)) continue;
      
      // cardIndex는 이미 0-based, 나머지는 1-based이므로 -1
      const index = field === 'cardIndex' ? value : value - 1;
      const realId = cardIdMap[index];
      
      if (realId) {
        return realId;
      }
    }
  }
  
  // 명함이 1개뿐이면 그 명함으로 기본 설정
  const keys = Object.keys(cardIdMap);
  if (keys.length === 1) {
    return cardIdMap[keys[0]];
  }
  
  return null;
}

/**
 * linked_card_ids 문자열/배열을 실제 DB ID 문자열로 변환
 * @param {string|Array} linkedCardIds - LLM 생성 값 (예: "1,2" 또는 [1,2])
 * @param {Object} cardIdMap - {0: 실제DB_ID, ...}
 * @returns {string|null} 실제 DB ID 콤마 구분 문자열
 */
function resolveLinkedCardIds(linkedCardIds, cardIdMap) {
  if (!linkedCardIds) return null;
  
  let arr = [];
  if (typeof linkedCardIds === 'string') {
    arr = linkedCardIds.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
  } else if (Array.isArray(linkedCardIds)) {
    arr = linkedCardIds.map(n => parseInt(n)).filter(n => !isNaN(n));
  }
  
  // 1-based를 0-based로 변환 후 cardIdMap에서 실제 ID 조회
  const realIds = arr.map(id => cardIdMap[id - 1]).filter(Boolean);
  return realIds.length > 0 ? realIds.join(',') : null;
}

/**
 * Step 1: 시나리오로 원본 테이블에 더미 데이터 생성
 */
export async function generateDummyData(scenario, rawData = null) {
  // rawData가 있으면 직접 사용, 없으면 LLM으로 생성
  const generatedData = rawData || await llmGenerateDummyData(scenario);

  const connection = await getConnection();

  try {
    await connection.beginTransaction();

    // user_id는 항상 1로 고정 (기존 계정 사용)
    const userId = 1;
    
    // ⚠️ userId=1이 users 테이블에 실제 존재하는지 확인
    const [userCheck] = await connection.query(
      `SELECT id FROM users WHERE id = ?`,
      [userId]
    );
    if (!userCheck || userCheck.length === 0) {
      throw new Error(`userId=${userId}가 users 테이블에 존재하지 않습니다. 먼저 사용자를 생성해주세요.`);
    }
    console.log(`사용자 ID 확인 완료: ${userId}`);

    // 2. 명함 생성
    const cardIdMap = {};
    if (!generatedData.business_cards || generatedData.business_cards.length === 0) {
      throw new Error('business_cards 데이터가 없습니다. 최소 1개의 명함이 필요합니다.');
    }
    
    for (let i = 0; i < generatedData.business_cards.length; i++) {
      const card = generatedData.business_cards[i];
      
      // 필수 필드 검증
      if (!card.name || card.name.trim() === '') {
        throw new Error(`business_cards[${i}]: name 필드는 필수입니다.`);
      }
      
      const [cardResult] = await connection.query(
        `INSERT INTO business_cards (userId, name, position, company, phone, email, memo, gender, isFavorite, design)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          card.name.trim(),
          card.position || null,
          card.company || null,
          card.phone || null,
          card.email || null,
          card.memo || null,
          card.gender || null,
          card.isFavorite ? 1 : 0,
          card.design || "design-1",
        ]
      );
      cardIdMap[i] = cardResult.insertId;
      console.log(`명함 생성: index=${i} → DB id=${cardResult.insertId} (${card.name})`);
    }

    // 3. 일정 생성
    let eventsCount = 0;
    if (generatedData.events) {
      for (let eventIdx = 0; eventIdx < generatedData.events.length; eventIdx++) {
        const event = generatedData.events[eventIdx];
        
        // linked_card_ids를 실제 DB ID로 변환
        const linkedCardIds = resolveLinkedCardIds(event.linked_card_ids, cardIdMap);
        
        // 필수 필드 검증
        if (!event.title) {
          console.log(`스킵: event[${eventIdx}], title이 없음`);
          continue;
        }

        // category 유효성 검사 (enum: '미팅','업무','개인','기타')
        const validCategories = ["미팅", "업무", "개인", "기타"];
        const category = validCategories.includes(event.category) ? event.category : "기타";
        
        // 날짜 기본값 설정
        const startDate = event.startDate || new Date().toISOString();
        const endDate = event.endDate || startDate;

        await connection.query(
          `INSERT INTO events (userId, title, startDate, endDate, category, color, description, location, participants, memo, isAllDay, linked_card_ids)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userId,
            event.title,
            startDate,
            endDate,
            category,
            event.color || "#9ca3af",
            event.description || null,
            event.location || null,
            event.participants || null,
            event.memo || null,
            event.isAllDay ? 1 : 0,
            linkedCardIds,
          ]
        );
        console.log(`일정 생성: event[${eventIdx}] → linked_card_ids=${linkedCardIds} (${event.title})`);
        eventsCount++;
      }
    }

    // 4. 선물 생성
    let giftsCount = 0;
    if (generatedData.gifts) {
      for (let giftIdx = 0; giftIdx < generatedData.gifts.length; giftIdx++) {
        const gift = generatedData.gifts[giftIdx];
        
        // LLM 생성 cardId를 실제 DB ID로 변환
        const cardId = resolveCardId(gift, cardIdMap);
        if (!cardId) {
          console.log(`스킵: gift[${giftIdx}] "${gift.giftName}", 명함 매핑 실패`, gift);
          continue;
        }

        // 필수 필드 검증
        if (!gift.giftName) {
          console.log(`스킵: gift[${giftIdx}], giftName이 없음`);
          continue;
        }

        // purchaseDate 처리 (null이면 현재 날짜)
        const purchaseDate = gift.purchaseDate || new Date().toISOString();
        const year = gift.year || new Date(purchaseDate).getFullYear();

        await connection.query(
          `INSERT INTO gifts (userId, cardId, giftName, giftDescription, price, category, purchaseDate, occasion, notes, year)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userId,
            cardId,
            gift.giftName,
            gift.giftDescription || null,
            gift.price || 0,
            gift.category || '기타',
            purchaseDate,
            gift.occasion || '기타',
            gift.notes || null,
            year,
          ]
        );
        console.log(`선물 생성: gift[${giftIdx}] → cardId=${cardId} (${gift.giftName})`);
        giftsCount++;
      }
    }

    // 5. 채팅 생성
    let chatsCount = 0;
    if (generatedData.chats) {
      for (let chatIdx = 0; chatIdx < generatedData.chats.length; chatIdx++) {
        const chat = generatedData.chats[chatIdx];
        
        // 필수 필드 검증
        if (!chat.messages || !Array.isArray(chat.messages)) {
          console.log(`스킵: chat[${chatIdx}], messages가 없거나 배열이 아님`);
          continue;
        }
        
        const messagesJson = JSON.stringify(chat.messages);
        // createdAt이 있으면 사용, 없으면 현재 시간
        const createdAt = chat.createdAt || new Date().toISOString();

        await connection.query(
          `INSERT INTO chats (userId, llmProvider, title, messages, isActive, createdAt)
           VALUES (?, 'gpt', ?, ?, TRUE, ?)`,
          [userId, chat.title || '선물 추천 대화', messagesJson, createdAt]
        );
        console.log(`채팅 생성: chat[${chatIdx}] (${chat.title || '선물 추천 대화'})`);
        chatsCount++;
      }
    }

    // 6. 메모 생성 (시간순으로)
    // LLM이 "memo" 또는 "memos"로 생성할 수 있음
    let memosCount = 0;
    const memoData = generatedData.memos || generatedData.memo || [];
    if (memoData.length > 0) {
      for (let memoIdx = 0; memoIdx < memoData.length; memoIdx++) {
        const memo = memoData[memoIdx];
        
        // LLM 생성 cardId를 실제 DB ID로 변환
        const cardId = resolveCardId(memo, cardIdMap);
        if (!cardId) {
          console.log(`스킵: memo[${memoIdx}], 명함 매핑 실패`, memo);
          continue;
        }

        // 필수 필드 검증
        if (!memo.content || memo.content.trim() === '') {
          console.log(`스킵: memo[${memoIdx}], content가 없음`);
          continue;
        }

        // createdAt 또는 created_at 사용
        const createdAt = memo.createdAt || memo.created_at || new Date().toISOString();

        await connection.query(
          `INSERT INTO memo (user_id, business_card_id, content, created_at)
           VALUES (?, ?, ?, ?)`,
          [userId, cardId, memo.content.trim(), createdAt]
        );
        console.log(`메모 생성: memo[${memoIdx}] → cardId=${cardId}`);
        memosCount++;
      }
    }

    await connection.commit();

    return {
      userId,
      cardIdMap,
      summary: {
        cards: Object.keys(cardIdMap).length,
        events: eventsCount,
        gifts: giftsCount,
        chats: chatsCount,
        memos: memosCount,
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Step 2: source_event 생성 (특정 userId에 대해)
 * @param {number} userId - 사용자 ID
 * @param {number[]} cardIds - (선택) 특정 명함 ID들만 처리. 없으면 전체 명함 처리
 * @param {Date|string} createdAfter - (선택) 이 시간 이후에 생성된 데이터만 처리
 */
export async function populateSourceEvents(userId, cardIds = null, createdAfter = null) {
  const connection = await getConnection();

  try {
    await connection.beginTransaction();

    const results = {
      cards: 0,
      memos: 0,
      events: 0,
      gifts: 0,
      chats: 0,
    };

    // cardIds 필터가 있으면 Set으로 변환 (빠른 조회용)
    const targetCardIds = cardIds && cardIds.length > 0 ? new Set(cardIds) : null;
    
    // cardId가 대상인지 확인하는 헬퍼 함수
    const isTargetCard = (cardId) => {
      if (!targetCardIds) return true; // 필터 없으면 전체 대상
      return targetCardIds.has(cardId);
    };
    
    // createdAfter 필터 (이 시간 이후에 생성된 데이터만 처리)
    const createdAfterDate = createdAfter ? new Date(createdAfter) : null;
    const isCreatedAfter = (dateValue) => {
      if (!createdAfterDate) return true; // 필터 없으면 전체 대상
      if (!dateValue) return false;
      const itemDate = new Date(dateValue);
      return itemDate >= createdAfterDate;
    };
    console.log(`createdAfter 필터: ${createdAfterDate ? createdAfterDate.toISOString() : '없음'}`);

    // 이미 처리된 source_event 확인 함수
    const getExisting = async (sourceType) => {
      const rows = await query(
        `SELECT source_pk, card_id FROM source_event WHERE source_type = ? AND user_id = ?`,
        [sourceType, userId]
      );
      const set = new Set();
      for (const row of rows) {
        set.add(`${row.source_pk}:${row.card_id}`);
      }
      return set;
    };

    // source_event INSERT 함수
    const insertSourceEvent = async (data) => {
      await connection.query(
        `INSERT INTO source_event 
         (user_id, card_id, source_type, source_pk, occurred_at, raw_text)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE raw_text = VALUES(raw_text), updated_at = CURRENT_TIMESTAMP`,
        [data.userId, data.cardId, data.sourceType, data.sourcePk, data.occurredAt, data.rawText]
      );
    };

    // CARD 처리 (cardIds 필터 적용)
    const cardExisting = await getExisting("CARD");
    let cardsQuery = `SELECT * FROM business_cards WHERE userId = ?`;
    let cardsParams = [userId];
    if (targetCardIds) {
      cardsQuery += ` AND id IN (${[...targetCardIds].map(() => '?').join(',')})`;
      cardsParams.push(...targetCardIds);
    }
    const cards = await query(cardsQuery, cardsParams);
    for (const card of cards) {
      const key = `${card.id}:${card.id}`;
      if (cardExisting.has(key)) continue;
      const rawText = buildRawText("CARD", card);
      await insertSourceEvent({
        userId: card.userId,
        cardId: card.id,
        sourceType: "CARD",
        sourcePk: card.id,
        occurredAt: card.createdAt,
        rawText,
      });
      results.cards++;
    }

    // MEMO 처리
    // 실제 존재하는 card_id 목록 (EVENT 처리에서도 사용)
    const validCardIds = new Set(cards.map(c => c.id));
    
    const memoExisting = await getExisting("MEMO");
    const memos = await query(
      `SELECT m.*, bc.name, bc.company, bc.position
       FROM memo m
       LEFT JOIN business_cards bc ON m.business_card_id = bc.id
       WHERE m.user_id = ?`,
      [userId]
    );
    for (const memo of memos) {
      // card_id가 유효하지 않거나 실제 business_cards에 존재하지 않으면 스킵
      if (!memo.business_card_id || memo.business_card_id <= 0 || !validCardIds.has(memo.business_card_id)) {
        continue;
      }
      // cardIds 필터가 있으면 대상 명함만 처리
      if (!isTargetCard(memo.business_card_id)) continue;
      // createdAfter 필터
      if (!isCreatedAfter(memo.created_at)) continue;
      
      const key = `${memo.id}:${memo.business_card_id}`;
      if (memoExisting.has(key)) continue;
      const card = { name: memo.name, company: memo.company, position: memo.position };
      const rawText = buildRawText("MEMO", memo, card);
      await insertSourceEvent({
        userId: memo.user_id,
        cardId: memo.business_card_id,
        sourceType: "MEMO",
        sourcePk: memo.id,
        occurredAt: memo.created_at || memo.updated_at,
        rawText,
      });
      results.memos++;
    }

    // EVENT 처리
    const eventExisting = await getExisting("EVENT");
    const events = await query(`SELECT * FROM events WHERE userId = ?`, [userId]);
    const cardMap = new Map(cards.map((c) => [c.id, c]));
    for (const event of events) {
      const linkedCardIds = parseLinkedCardIds(event.linked_card_ids);
      if (linkedCardIds.length === 0) continue;
      // createdAfter 필터 (이벤트는 createdAt 또는 startDate 기준)
      if (!isCreatedAfter(event.createdAt || event.startDate)) continue;
      
      for (const cardId of linkedCardIds) {
        // card_id가 유효하지 않거나 실제 business_cards에 존재하지 않으면 스킵
        if (!cardId || cardId <= 0 || !validCardIds.has(cardId)) {
          continue;
        }
        // cardIds 필터가 있으면 대상 명함만 처리
        if (!isTargetCard(cardId)) continue;
        
        const key = `${event.id}:${cardId}`;
        if (eventExisting.has(key)) continue;
        const card = cardMap.get(cardId);
        const rawText = buildRawText("EVENT", event, card);
        await insertSourceEvent({
          userId: event.userId,
          cardId: cardId,
          sourceType: "EVENT",
          sourcePk: event.id,
          occurredAt: event.startDate,
          rawText,
        });
        results.events++;
      }
    }

    // GIFT 처리
    const giftExisting = await getExisting("GIFT");
    const gifts = await query(
      `SELECT g.*, bc.name, bc.company, bc.position
       FROM gifts g
       LEFT JOIN business_cards bc ON g.cardId = bc.id
       WHERE g.userId = ?`,
      [userId]
    );
    for (const gift of gifts) {
      // card_id가 유효하지 않거나 실제 business_cards에 존재하지 않으면 스킵
      if (!gift.cardId || gift.cardId <= 0 || !validCardIds.has(gift.cardId)) {
        continue;
      }
      // cardIds 필터가 있으면 대상 명함만 처리
      if (!isTargetCard(gift.cardId)) continue;
      // createdAfter 필터
      if (!isCreatedAfter(gift.createdAt || gift.purchaseDate)) continue;
      
      const key = `${gift.id}:${gift.cardId}`;
      if (giftExisting.has(key)) continue;
      const card = { name: gift.name, company: gift.company, position: gift.position };
      const rawText = buildRawText("GIFT", gift, card);
      await insertSourceEvent({
        userId: gift.userId,
        cardId: gift.cardId,
        sourceType: "GIFT",
        sourcePk: gift.id,
        occurredAt: gift.purchaseDate || gift.createdAt,
        rawText,
      });
      results.gifts++;
    }

    // CHAT 처리
    const chatExisting = await getExisting("CHAT");
    const chats = await query(
      `SELECT * FROM chats WHERE userId = ? AND isActive = TRUE`,
      [userId]
    );
    for (const chat of chats) {
      // createdAfter 필터 (채팅은 createdAt 기준)
      if (!isCreatedAfter(chat.createdAt)) continue;
      
      const inferredCardIds = inferCardIdsFromChat(chat, cards);
      const chatCardIds = inferredCardIds.length > 0 ? inferredCardIds : cards.length > 0 ? [cards[0].id] : [];
      for (const cardId of chatCardIds) {
        // card_id가 유효하지 않거나 실제 business_cards에 존재하지 않으면 스킵
        if (!cardId || cardId <= 0 || !validCardIds.has(cardId)) {
          continue;
        }
        // cardIds 필터가 있으면 대상 명함만 처리
        if (!isTargetCard(cardId)) continue;
        
        const key = `${chat.id}:${cardId}`;
        if (chatExisting.has(key)) continue;
        const card = cards.find((c) => c.id === cardId);
        const rawText = buildRawText("CHAT", chat, card);
        await insertSourceEvent({
          userId: chat.userId,
          cardId: cardId,
          sourceType: "CHAT",
          sourcePk: chat.id,
          occurredAt: chat.createdAt,
          rawText,
        });
        results.chats++;
      }
    }

    await connection.commit();
    return results;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Step 3: fact 추출 (특정 userId에 대해 미처리 source_event만)
 * @param {number} userId - 사용자 ID
 * @param {number[]} cardIds - (선택) 특정 명함 ID들만 처리. 없으면 전체 미처리 source_event 처리
 */
export async function extractFactsForUser(userId, cardIds = null) {
  const connection = await getConnection();

  try {
    // 미처리 source_event 조회
    let sqlQuery = `
      SELECT se.*, bc.name as card_name, bc.company as card_company
      FROM source_event se
      JOIN business_cards bc ON se.card_id = bc.id
      WHERE se.user_id = ? AND se.is_processed = FALSE`;
    
    const params = [userId];
    
    // cardIds가 지정되면 해당 명함들만 필터링
    if (cardIds && cardIds.length > 0) {
      sqlQuery += ` AND se.card_id IN (${cardIds.map(() => '?').join(',')})`;
      params.push(...cardIds);
    }
    
    sqlQuery += ` ORDER BY se.occurred_at ASC`;
    
    const pendingEvents = await query(sqlQuery, params);

    let totalExtracted = 0;
    let totalSaved = 0;

    for (const sourceEvent of pendingEvents) {
      try {
        // 해당 card_id의 기존 fact 조회 (LLM 컨텍스트용)
        const existingFacts = await query(
          `SELECT fact_type, fact_key, polarity, confidence 
           FROM extracted_fact 
           WHERE card_id = ? 
           ORDER BY confidence DESC`,
          [sourceEvent.card_id]
        );
        
        // LLM으로 fact 추출 (기존 fact 컨텍스트 포함)
        const rawFacts = await llmExtractFacts(sourceEvent, existingFacts);

        if (rawFacts.length === 0) {
          // fact가 없어도 처리 완료 표시
          await connection.query(
            `UPDATE source_event SET is_processed = TRUE, processed_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [sourceEvent.id]
          );
          continue;
        }

        totalExtracted += rawFacts.length;

        // 검증
        const { validFacts } = validateFacts(rawFacts);

        // 중복 제거
        const dedupedFacts = deduplicateFacts(validFacts);
        
        // INVALIDATE 액션 처리: 무효화된 fact의 confidence를 0으로
        for (const fact of dedupedFacts) {
          if (fact.action === 'INVALIDATE' && fact.invalidate_key) {
            await connection.query(
              `UPDATE extracted_fact 
               SET confidence = 0
               WHERE card_id = ? AND fact_key = ? AND confidence > 0`,
              [sourceEvent.card_id, fact.invalidate_key]
            );
            console.log(`Fact 무효화: card_id=${sourceEvent.card_id}, ${fact.invalidate_key}`);
          }
        }

        // DB 저장 (UPSERT: 같은 card_id + fact_type + fact_key면 UPDATE)
        for (const fact of dedupedFacts) {
          // 기존 fact 존재 여부 확인
          const [existingRows] = await connection.query(
            `SELECT id, confidence FROM extracted_fact 
             WHERE card_id = ? AND fact_type = ? AND fact_key = ?`,
            [sourceEvent.card_id, fact.fact_type, fact.fact_key]
          );
          
          if (existingRows && existingRows.length > 0) {
            // 기존 fact가 있으면 UPDATE (confidence가 더 높거나 같으면 갱신)
            const existing = existingRows[0];
            if (fact.confidence >= existing.confidence) {
              await connection.query(
                `UPDATE extracted_fact 
                 SET source_event_id = ?, polarity = ?, confidence = ?, evidence = ?, extracted_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [sourceEvent.id, fact.polarity || 0, fact.confidence, fact.evidence, existing.id]
              );
              console.log(`Fact 업데이트: card_id=${sourceEvent.card_id}, ${fact.fact_type}/${fact.fact_key} (polarity: ${fact.polarity || 0}, confidence: ${existing.confidence} → ${fact.confidence})`);
            } else {
              console.log(`Fact 스킵: card_id=${sourceEvent.card_id}, ${fact.fact_type}/${fact.fact_key} (기존 confidence ${existing.confidence} > 새 ${fact.confidence})`);
            }
          } else {
            // 새 fact INSERT
            await connection.query(
              `INSERT INTO extracted_fact 
               (source_event_id, user_id, card_id, fact_type, fact_key, polarity, confidence, evidence)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                sourceEvent.id,
                sourceEvent.user_id,
                sourceEvent.card_id,
                fact.fact_type,
                fact.fact_key,
                fact.polarity || 0,
                fact.confidence,
                fact.evidence,
              ]
            );
            console.log(`Fact 신규: card_id=${sourceEvent.card_id}, ${fact.fact_type}/${fact.fact_key} (polarity: ${fact.polarity || 0})`);
          }
          totalSaved++;
        }

        // 처리 완료 표시
        await connection.query(
          `UPDATE source_event SET is_processed = TRUE, processed_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [sourceEvent.id]
        );

        // Rate limiting
        await new Promise((r) => setTimeout(r, 500));
      } catch (error) {
        console.error(`Fact 추출 오류 (source_event ${sourceEvent.id}):`, error.message);
      }
    }

    return {
      processed: pendingEvents.length,
      totalExtracted,
      totalSaved,
    };
  } finally {
    connection.release();
  }
}

export default {
  generateDummyData,
  populateSourceEvents,
  extractFactsForUser,
};

