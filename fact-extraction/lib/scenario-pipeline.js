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
import TimestampGenerator from "./timestamp-generator.js";

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
    
    // TimestampGenerator 인스턴스 생성 및 기존 데이터 로드
    const tsGen = new TimestampGenerator();
    
    // 기존 데이터의 시간 정보를 등록 (중복 방지용)
    const [existingCards] = await connection.query(
      `SELECT createdAt FROM business_cards WHERE userId = ?`,
      [userId]
    );
    const [existingMemos] = await connection.query(
      `SELECT created_at, updated_at FROM memo WHERE user_id = ?`,
      [userId]
    );
    const [existingEvents] = await connection.query(
      `SELECT startDate, endDate, createdAt FROM events WHERE userId = ?`,
      [userId]
    );
    const [existingGifts] = await connection.query(
      `SELECT purchaseDate, createdAt FROM gifts WHERE userId = ?`,
      [userId]
    );
    const [existingChats] = await connection.query(
      `SELECT createdAt FROM chats WHERE userId = ?`,
      [userId]
    );
    
    tsGen.registerExistingTimestamps({
      cards: existingCards,
      memos: existingMemos,
      events: existingEvents,
      gifts: existingGifts,
      chats: existingChats
    });
    
    // ⚠️ userId=1이 users 테이블에 실제 존재하는지 확인
    const [userCheck] = await connection.query(
      `SELECT id FROM users WHERE id = ?`,
      [userId]
    );
    if (!userCheck || userCheck.length === 0) {
      throw new Error(`userId=${userId}가 users 테이블에 존재하지 않습니다. 먼저 사용자를 생성해주세요.`);
    }
    console.log(`사용자 ID 확인 완료: ${userId}`);

    // 2. 명함 생성 (시간 자동 할당)
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
      
      // 명함 생성 시간 자동 할당
      const cardCreationTime = tsGen.generateCardCreationTime();
      
      const [cardResult] = await connection.query(
        `INSERT INTO business_cards (userId, name, position, company, phone, email, memo, gender, isFavorite, design, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          "design-1", // 항상 고정값
          cardCreationTime.toISOString(),
        ]
      );
      
      // insertId 확인 및 디버깅
      const insertId = cardResult?.insertId;
      if (!insertId) {
        console.error(`❌ 명함 생성 실패: cardResult=`, cardResult);
        throw new Error(`명함 생성 실패: insertId를 가져올 수 없습니다. (index=${i}, name=${card.name})`);
      }
      
      cardIdMap[i] = insertId;
      console.log(`명함 생성: index=${i} → DB id=${insertId} (${card.name}) at ${cardCreationTime.toISOString()}`);
      console.log(`  cardIdMap 상태:`, cardIdMap);
    }

    // 3. 일정 생성 (시간 자동 할당)
    let eventsCount = 0;
    let eventTimes = [];
    let firstCardTime = new Date(); // 기본값
    
    // 🔧 FIX: 실제로 생성된 첫 번째 명함의 시간 사용
    if (Object.keys(cardIdMap).length > 0) {
      const [firstCardData] = await connection.query(
        `SELECT createdAt FROM business_cards WHERE id = ? LIMIT 1`,
        [Object.values(cardIdMap)[0]]
      );
      if (firstCardData && firstCardData.length > 0) {
        firstCardTime = new Date(firstCardData[0].createdAt);
      }
    }
    
    if (generatedData.events) {
      // 모든 일정의 시간을 미리 생성
      eventTimes = tsGen.generateEventTimes(firstCardTime, generatedData.events.length);
      
      // 첫 번째 (유일한) 명함의 실제 DB ID 가져오기
      const firstCardDbId = Object.values(cardIdMap)[0];
      
      for (let eventIdx = 0; eventIdx < generatedData.events.length; eventIdx++) {
        const event = generatedData.events[eventIdx];
        
        // 🔧 간단하게: INSERT된 명함의 실제 DB ID 직접 사용
        const linkedCardIds = String(firstCardDbId);
        
        // 필수 필드 검증
        if (!event.title) {
          console.log(`스킵: event[${eventIdx}], title이 없음`);
          continue;
        }

        // category 유효성 검사 (enum: '미팅','업무','개인','기타')
        const validCategories = ["미팅", "업무", "개인", "기타"];
        const category = validCategories.includes(event.category) ? event.category : "기타";
        
        // 시간 자동 할당 (미리 생성된 시간 사용)
        const eventTime = eventTimes[eventIdx] || {
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1시간 후
        };

        // participants 처리: 배열이면 문자열로 변환
        let participantsStr = null;
        if (event.participants) {
          if (Array.isArray(event.participants)) {
            participantsStr = event.participants.join(', ');
          } else {
            participantsStr = String(event.participants);
          }
        }

        await connection.query(
          `INSERT INTO events (userId, title, startDate, endDate, category, color, description, location, participants, memo, isAllDay, linked_card_ids)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userId,
            event.title,
            eventTime.startDate,
            eventTime.endDate,
            category,
            event.color || "#9ca3af",
            event.description || null,
            event.location || null,
            participantsStr,
            event.memo || null,
            event.isAllDay ? 1 : 0,
            linkedCardIds,
          ]
        );
        console.log(`일정 생성: event[${eventIdx}] → ${eventTime.startDate} - ${eventTime.endDate} (${event.title})`);
        eventsCount++;
      }
    }

    // 4. 선물 생성 (시간 자동 할당)
    let giftsCount = 0;
    let giftTimes = [];
    
    if (generatedData.gifts) {
      // 모든 선물의 시간을 미리 생성 (채팅 + 구매 시간) - 이미 설정된 firstCardTime 사용
      giftTimes = tsGen.generateGiftTimes(firstCardTime, generatedData.gifts.length);
      
      // 첫 번째 (유일한) 명함의 실제 DB ID 가져오기
      const giftCardDbId = Object.values(cardIdMap)[0];
      
      for (let giftIdx = 0; giftIdx < generatedData.gifts.length; giftIdx++) {
        const gift = generatedData.gifts[giftIdx];
        
        // 🔧 간단하게: INSERT된 명함의 실제 DB ID 직접 사용
        const cardId = giftCardDbId;

        // 필수 필드 검증
        if (!gift.giftName) {
          console.log(`스킵: gift[${giftIdx}], giftName이 없음`);
          continue;
        }

        // 시간 자동 할당 (미리 생성된 시간 사용)
        const giftTime = giftTimes[giftIdx] || {
          purchaseDate: new Date().toISOString(),
          chatTime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() // 1일 전
        };
        const year = new Date(giftTime.purchaseDate).getFullYear();

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
            giftTime.purchaseDate,
            gift.occasion || '기타',
            gift.notes || null,
            year,
          ]
        );
        console.log(`선물 생성: gift[${giftIdx}] → cardId=${cardId} at ${giftTime.purchaseDate} (${gift.giftName})`);
        giftsCount++;
      }
    }

    // 5. 채팅 생성 (선물과 연동된 시간 사용, cardId 연결)
    let chatsCount = 0;
    // 채팅에 연결할 cardId (선물과 동일한 명함)
    // cardIdMap[0]을 직접 사용하여 더 안전하게 처리
    const chatCardDbId = cardIdMap[0] || (Object.values(cardIdMap).length > 0 ? Object.values(cardIdMap)[0] : null);
    
    console.log(`채팅 생성 준비: cardIdMap=`, cardIdMap, `chatCardDbId=`, chatCardDbId);
    
    if (!chatCardDbId) {
      console.error('❌ chatCardDbId가 없습니다. cardIdMap:', cardIdMap);
      console.error('  cardIdMap 타입:', typeof cardIdMap, 'keys:', Object.keys(cardIdMap));
      throw new Error('명함이 생성되지 않아 채팅에 연결할 cardId를 찾을 수 없습니다.');
    }
    
    if (generatedData.chats) {
      for (let chatIdx = 0; chatIdx < generatedData.chats.length; chatIdx++) {
        const chat = generatedData.chats[chatIdx];
        
        // 필수 필드 검증
        if (!chat.messages || !Array.isArray(chat.messages)) {
          console.log(`스킵: chat[${chatIdx}], messages가 없거나 배열이 아님`);
          continue;
        }
        
        const messagesJson = JSON.stringify(chat.messages);
        
        // 시간 자동 할당 (해당하는 선물의 채팅 시간 사용)
        const chatTime = giftTimes[chatIdx] ? giftTimes[chatIdx].chatTime : 
          new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(); // 최근 30일 내 랜덤

        await connection.query(
          `INSERT INTO chats (userId, cardId, llmProvider, title, messages, isActive, createdAt)
           VALUES (?, ?, 'gpt', ?, ?, TRUE, ?)`,
          [userId, chatCardDbId, chat.title || '선물 추천 대화', messagesJson, chatTime]
        );
        console.log(`채팅 생성: chat[${chatIdx}] → cardId=${chatCardDbId} at ${chatTime} (${chat.title || '선물 추천 대화'})`);
        chatsCount++;
      }
    }

    // 6. 메모 생성 (일정과 연동된 시간 자동 할당)
    let memosCount = 0;
    const memoData = generatedData.memos || generatedData.memo || [];
    
    // 첫 번째 (유일한) 명함의 실제 DB ID 가져오기
    const memoCardDbId = Object.values(cardIdMap)[0];
    
    if (memoData.length > 0) {
      // 일정들의 시간을 기준으로 메모 시간들 생성
      const memoTimes = tsGen.generateMemoTimes(eventTimes, memoData.length);
      
      for (let memoIdx = 0; memoIdx < memoData.length; memoIdx++) {
        const memo = memoData[memoIdx];
        
        // 🔧 간단하게: INSERT된 명함의 실제 DB ID 직접 사용
        const cardId = memoCardDbId;

        // 필수 필드 검증
        if (!memo.content || memo.content.trim() === '') {
          console.log(`스킵: memo[${memoIdx}], content가 없음`);
          continue;
        }

        // 시간 자동 할당 (미리 생성된 시간 사용)
        const memoTime = memoTimes[memoIdx] || {
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        await connection.query(
          `INSERT INTO memo (user_id, business_card_id, content, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
          [userId, cardId, memo.content.trim(), memoTime.created_at, memoTime.updated_at]
        );
        console.log(`메모 생성: memo[${memoIdx}] → cardId=${cardId} at ${memoTime.created_at}`);
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
    // 실제 존재하는 모든 card_id 목록 (userId의 모든 명함 - 필터와 무관하게)
    const allCardsForUser = await query(`SELECT id FROM business_cards WHERE userId = ?`, [userId]);
    const validCardIds = new Set(allCardsForUser.map(c => c.id));
    console.log(`유효한 card_id 목록 (총 ${validCardIds.size}개):`, [...validCardIds]);
    
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
    // 모든 명함 정보를 가져와서 cardMap 생성 (필터와 무관하게)
    const allCardsDetails = await query(`SELECT * FROM business_cards WHERE userId = ?`, [userId]);
    const cardMap = new Map(allCardsDetails.map((c) => [c.id, c]));
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

    // CHAT 처리 (cardId가 직접 저장되어 있으면 사용, 없으면 추론)
    const chatExisting = await getExisting("CHAT");
    const chats = await query(
      `SELECT * FROM chats WHERE userId = ? AND isActive = TRUE`,
      [userId]
    );
    for (const chat of chats) {
      // createdAfter 필터 (채팅은 createdAt 기준)
      if (!isCreatedAfter(chat.createdAt)) continue;
      
      // 🔧 cardId가 DB에 저장되어 있으면 직접 사용, 없으면(기존 데이터) 추론
      let chatCardIds;
      if (chat.cardId && chat.cardId > 0 && validCardIds.has(chat.cardId)) {
        // cardId가 직접 저장되어 있는 경우 (신규 데이터)
        chatCardIds = [chat.cardId];
      } else {
        // cardId가 없는 경우 (기존 데이터) - 이름 기반 추론 fallback
        const inferredCardIds = inferCardIdsFromChat(chat, allCardsDetails);
        chatCardIds = inferredCardIds.length > 0 ? inferredCardIds : allCardsDetails.length > 0 ? [allCardsDetails[0].id] : [];
      }
      
      for (const cardId of chatCardIds) {
        // card_id가 유효하지 않거나 실제 business_cards에 존재하지 않으면 스킵
        if (!cardId || cardId <= 0 || !validCardIds.has(cardId)) {
          continue;
        }
        // cardIds 필터가 있으면 대상 명함만 처리
        if (!isTargetCard(cardId)) continue;
        
        const key = `${chat.id}:${cardId}`;
        if (chatExisting.has(key)) continue;
        const card = cardMap.get(cardId);
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

