/**
 * 시나리오 기반 더미 데이터 생성 스크립트
 * 
 * 사용법:
 *   node scripts/generate-scenario-data.js "시나리오 텍스트"
 *   node scripts/generate-scenario-data.js --file scenario.txt
 *   node scripts/generate-scenario-data.js --interactive
 */

import { query, execute, closePool, getConnection } from "../lib/db.js";
import { generateScenarioData } from "../lib/llm-client.js";
import readline from "readline";

/**
 * 기본 시나리오 (테스트용)
 */
const DEFAULT_SCENARIO = `
나는 스타트업 CEO 김민준이다. 최근 6개월간 다양한 비즈니스 파트너들을 만났다.

1. 박서연 (VC 심사역, 블루벤처스)
   - 첫 미팅: 투자 피칭
   - 커피를 매우 좋아함, 특히 스페셜티 원두
   - 알레르기: 견과류 (중요!)
   - 생일: 5월 15일
   - 두 번째 미팅에서 포트폴리오 회사 소개받음
   - 와인보다 맥주 선호
   - 승진 축하 선물로 고급 원두 세트 선물함

2. 이준호 (CTO, 테크놀로지플러스)
   - 기술 협력 파트너십 논의
   - 캠핑과 아웃도어 활동 좋아함
   - 채식주의자
   - 아이가 둘, 주말에는 가족과 시간 보냄
   - 크리스마스에 캠핑 장비 선물함
   - 늦은 저녁 미팅 피해달라고 요청 (퇴근 후 가족 시간)

3. 최지은 (마케팅 디렉터, 그로스에이전시)
   - 마케팅 캠페인 협업
   - 디자인/아트에 관심 많음
   - 라벤더 향 싫어함
   - 채식은 아니지만 해산물 못 먹음
   - 연말 선물로 미술관 전시회 티켓 선물함
   - 매우 바빠서 점심 미팅 선호

4. 정현우 (변호사, 법률사무소 정의)
   - 계약 검토 및 법률 자문
   - 골프 좋아함
   - 위스키 컬렉터
   - 건강 문제로 단 음식 제한
   - 감사 선물로 싱글몰트 위스키 선물함

5. 한수진 (HR 디렉터, 글로벌테크)
   - 채용 연계 미팅
   - 요가와 명상에 관심
   - 유기농/친환경 제품 선호
   - 딸 대학 입학 축하 (3월)
   - 크리스마스에 오가닉 티 세트 선물함
`;

/**
 * 대화형 입력 받기
 */
async function getInteractiveInput() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    console.log("\n시나리오를 입력하세요 (빈 줄 두 번 입력하면 완료):\n");
    
    let input = "";
    let emptyLineCount = 0;

    rl.on("line", (line) => {
      if (line === "") {
        emptyLineCount++;
        if (emptyLineCount >= 2) {
          rl.close();
          resolve(input.trim());
        } else {
          input += "\n";
        }
      } else {
        emptyLineCount = 0;
        input += line + "\n";
      }
    });
  });
}

/**
 * 생성된 데이터를 DB에 저장
 */
async function saveGeneratedData(data, userId = null) {
  const connection = await getConnection();

  try {
    await connection.beginTransaction();

    // 1. 사용자 생성 (또는 기존 사용자 사용)
    let finalUserId = userId;

    if (!finalUserId && data.user) {
      const [existingUser] = await connection.query(
        "SELECT id FROM users WHERE email = ?",
        [data.user.email]
      );

      if (existingUser.length > 0) {
        finalUserId = existingUser[0].id;
        console.log(`기존 사용자 사용: ID ${finalUserId}`);
      } else {
        const [userResult] = await connection.query(
          `INSERT INTO users (email, username, password, name, phone, position, company)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            data.user.email,
            data.user.username,
            data.user.password,
            data.user.name,
            data.user.phone,
            data.user.position,
            data.user.company,
          ]
        );
        finalUserId = userResult.insertId;
        console.log(`새 사용자 생성: ID ${finalUserId}`);
      }
    }

    if (!finalUserId) {
      throw new Error("User ID가 필요합니다");
    }

    // 2. 명함 생성
    const cardIdMap = {}; // index -> actual ID

    for (let i = 0; i < data.business_cards.length; i++) {
      const card = data.business_cards[i];
      const [cardResult] = await connection.query(
        `INSERT INTO business_cards (userId, name, position, company, phone, email, memo, gender)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          finalUserId,
          card.name,
          card.position,
          card.company,
          card.phone,
          card.email,
          card.memo,
          card.gender,
        ]
      );
      cardIdMap[i] = cardResult.insertId;
      console.log(`명함 생성: ${card.name} (ID: ${cardResult.insertId})`);
    }

    // 3. 일정 생성
    for (const event of data.events) {
      // linked_card_ids 변환 (인덱스 -> 실제 ID)
      const linkedCardIds = event.linked_card_ids
        ? event.linked_card_ids.map((idx) => cardIdMap[idx]).filter(Boolean).join(",")
        : null;

      await connection.query(
        `INSERT INTO events (userId, title, startDate, endDate, category, description, location, participants, memo, isAllDay, linked_card_ids)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          finalUserId,
          event.title,
          event.startDate,
          event.endDate,
          event.category || "기타",
          event.description,
          event.location,
          event.participants,
          event.memo,
          event.isAllDay ? 1 : 0,
          linkedCardIds,
        ]
      );
    }
    console.log(`일정 ${data.events.length}개 생성`);

    // 4. 선물 생성
    for (const gift of data.gifts) {
      const cardId = cardIdMap[gift.cardIndex];
      if (!cardId) continue;

      await connection.query(
        `INSERT INTO gifts (userId, cardId, giftName, giftDescription, price, category, purchaseDate, occasion, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          finalUserId,
          cardId,
          gift.giftName,
          gift.giftDescription,
          gift.price,
          gift.category,
          gift.purchaseDate,
          gift.occasion,
          gift.notes,
        ]
      );
    }
    console.log(`선물 ${data.gifts.length}개 생성`);

    // 5. 채팅 생성
    for (const chat of data.chats) {
      const messagesJson = JSON.stringify(chat.messages);
      
      await connection.query(
        `INSERT INTO chats (userId, llmProvider, title, messages, isActive)
         VALUES (?, 'gpt', ?, ?, TRUE)`,
        [finalUserId, chat.title, messagesJson]
      );
    }
    console.log(`채팅 ${data.chats.length}개 생성`);

    // 6. 메모 생성
    for (const memo of data.memos) {
      const cardId = cardIdMap[memo.cardIndex];
      if (!cardId) continue;

      await connection.query(
        `INSERT INTO memo (user_id, business_card_id, content)
         VALUES (?, ?, ?)`,
        [finalUserId, cardId, memo.content]
      );
    }
    console.log(`메모 ${data.memos.length}개 생성`);

    await connection.commit();

    console.log("\n=== 데이터 저장 완료 ===");
    console.log(`User ID: ${finalUserId}`);
    console.log(`명함 ID 매핑:`, cardIdMap);

    return { userId: finalUserId, cardIdMap };

  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * 메인 실행
 */
async function main() {
  const args = process.argv.slice(2);

  let scenario = DEFAULT_SCENARIO;

  if (args.includes("--interactive")) {
    scenario = await getInteractiveInput();
  } else if (args.includes("--file")) {
    const fileIndex = args.indexOf("--file") + 1;
    if (fileIndex < args.length) {
      const fs = await import("fs");
      scenario = fs.readFileSync(args[fileIndex], "utf8");
    }
  } else if (args.length > 0 && !args[0].startsWith("--")) {
    scenario = args.join(" ");
  }

  console.log("=== 시나리오 기반 데이터 생성 시작 ===\n");
  console.log("시나리오 (일부):", scenario.substring(0, 200) + "...\n");

  try {
    // 1. LLM으로 데이터 생성
    console.log("LLM에 데이터 생성 요청 중...\n");
    const generatedData = await generateScenarioData(scenario);

    console.log("생성된 데이터 요약:");
    console.log(`  - 사용자: ${generatedData.user?.name || "N/A"}`);
    console.log(`  - 명함: ${generatedData.business_cards?.length || 0}개`);
    console.log(`  - 일정: ${generatedData.events?.length || 0}개`);
    console.log(`  - 선물: ${generatedData.gifts?.length || 0}개`);
    console.log(`  - 채팅: ${generatedData.chats?.length || 0}개`);
    console.log(`  - 메모: ${generatedData.memos?.length || 0}개`);

    // 2. DB에 저장
    console.log("\nDB에 데이터 저장 중...\n");
    const result = await saveGeneratedData(generatedData);

    console.log("\n=== 완료 ===");
    console.log("다음 단계: node scripts/populate-source-events.js 실행");

  } catch (error) {
    console.error("\n오류 발생:", error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();

