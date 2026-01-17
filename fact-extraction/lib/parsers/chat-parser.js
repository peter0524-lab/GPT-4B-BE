/**
 * chats.messages JSON 파서
 * 
 * chats.messages 예시:
 * [
 *   { role: "assistant", content: "다음은 상대 정보… 추가 정보: 생일 선물 추천" },
 *   { role: "assistant", content: "추천 리스트..." },
 *   { role: "user", content: "선택한 선물: ..." },
 *   { role: "assistant", content: "저장되었습니다" }
 * ]
 * 
 * 추출 대상:
 * - Additional: "추가 정보: ..." 문장
 * - UserPrompt: user role의 첫 질문
 * - SelectedGift: "선택한 선물: ..." 문장
 */

/**
 * chats.messages를 파싱하여 raw_text용 구조화된 정보 추출
 * @param {Array|string} messages - messages 배열 또는 JSON 문자열
 * @returns {Object} 파싱된 정보
 */
export const parseChatMessages = (messages) => {
  // JSON 문자열이면 파싱
  let msgs = messages;
  if (typeof messages === "string") {
    try {
      msgs = JSON.parse(messages);
    } catch (e) {
      return {
        additional: null,
        userPrompt: null,
        selectedGift: null,
        rawText: messages,
        error: "JSON 파싱 실패",
      };
    }
  }

  if (!Array.isArray(msgs)) {
    return {
      additional: null,
      userPrompt: null,
      selectedGift: null,
      rawText: String(messages),
      error: "messages가 배열이 아님",
    };
  }

  const result = {
    additional: null, // "추가 정보: ..." 문장
    userPrompt: null, // user의 첫 질문
    selectedGift: null, // "선택한 선물: ..." 문장
    allUserMessages: [], // 모든 user 메시지
    rawText: null, // 최종 raw_text
  };

  for (const msg of msgs) {
    const content = msg.content || "";
    const role = msg.role || "";

    // 1. "추가 정보:" 패턴 찾기
    const additionalMatch = content.match(/추가\s*정보\s*[:：]\s*(.+)/i);
    if (additionalMatch && !result.additional) {
      result.additional = additionalMatch[1].trim();
    }

    // 2. user 메시지 수집
    if (role === "user") {
      result.allUserMessages.push(content);

      // 첫 user 질문 저장
      if (!result.userPrompt) {
        result.userPrompt = content.trim();
      }

      // "선택한 선물:" 패턴 찾기
      const selectedMatch = content.match(/선택한\s*선물\s*[:：]\s*(.+)/i);
      if (selectedMatch) {
        result.selectedGift = selectedMatch[1].trim();
      }
    }
  }

  // raw_text 생성
  const parts = [];
  
  if (result.additional) {
    parts.push(`[추가 정보] ${result.additional}`);
  }
  
  if (result.userPrompt) {
    parts.push(`[사용자 질문] ${result.userPrompt}`);
  }
  
  if (result.selectedGift) {
    parts.push(`[선택한 선물] ${result.selectedGift}`);
  }
  
  // 추가 컨텍스트가 있다면
  if (result.allUserMessages.length > 1) {
    const additionalContext = result.allUserMessages
      .slice(1)
      .filter((m) => !m.includes("선택한 선물"))
      .join(" | ");
    if (additionalContext) {
      parts.push(`[추가 대화] ${additionalContext}`);
    }
  }

  result.rawText = parts.length > 0 
    ? parts.join("\n") 
    : "[대화 내용 없음]";

  return result;
};

/**
 * chat 레코드에서 연결된 card_id 추출 시도
 * chats 테이블에는 직접적인 card_id가 없으므로, 
 * messages 내용에서 명함 정보를 찾거나, 
 * 다른 테이블과 조인이 필요할 수 있음
 * 
 * @param {Object} chat - chat 레코드
 * @param {Array} businessCards - 해당 user의 모든 명함 목록
 * @returns {Array<number>} 연결 가능한 card_id 목록
 */
export const inferCardIdsFromChat = (chat, businessCards) => {
  const messages = typeof chat.messages === "string" 
    ? JSON.parse(chat.messages) 
    : chat.messages;
  
  const fullText = messages
    .map((m) => m.content || "")
    .join(" ")
    .toLowerCase();

  const matchedCardIds = [];

  for (const card of businessCards) {
    // 명함 이름이나 회사명이 대화에 언급되었는지 확인
    const cardName = (card.name || "").toLowerCase();
    const cardCompany = (card.company || "").toLowerCase();

    if (
      (cardName && fullText.includes(cardName)) ||
      (cardCompany && fullText.includes(cardCompany))
    ) {
      matchedCardIds.push(card.id);
    }
  }

  return matchedCardIds;
};

export default { parseChatMessages, inferCardIdsFromChat };

