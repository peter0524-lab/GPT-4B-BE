/**
 * events 테이블 파서
 * 
 * events.linked_card_ids는 콤마로 구분된 명함 ID 문자열
 * event 1개가 여러 명함과 연결될 수 있으므로,
 * event 1개 → source_event 여러 행이 될 수 있음
 */

/**
 * linked_card_ids 문자열을 배열로 파싱
 * @param {string|null} linkedCardIds - "1,2,3" 형태의 문자열
 * @returns {Array<number>} card_id 배열
 */
export const parseLinkedCardIds = (linkedCardIds) => {
  if (!linkedCardIds) {
    return [];
  }

  if (typeof linkedCardIds !== "string") {
    return [];
  }

  return linkedCardIds
    .split(",")
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id) && id > 0);
};

/**
 * event 레코드를 raw_text로 변환
 * @param {Object} event - events 테이블 레코드
 * @param {Object} card - 연결된 business_card 레코드 (선택)
 * @returns {string} raw_text
 */
export const eventToRawText = (event, card = null) => {
  const parts = [];

  // 제목
  parts.push(`[일정] ${event.title}`);

  // 시간 정보
  const startDate = new Date(event.startDate);
  const endDate = new Date(event.endDate);
  const dateStr = formatDateRange(startDate, endDate, event.isAllDay);
  parts.push(`[시간] ${dateStr}`);

  // 카테고리
  if (event.category) {
    parts.push(`[카테고리] ${event.category}`);
  }

  // 장소
  if (event.location) {
    parts.push(`[장소] ${event.location}`);
  }

  // 참석자
  if (event.participants) {
    parts.push(`[참석자] ${event.participants}`);
  }

  // 연결된 명함 정보
  if (card) {
    const cardInfo = [card.name];
    if (card.position) cardInfo.push(card.position);
    if (card.company) cardInfo.push(card.company);
    parts.push(`[관련인물] ${cardInfo.join(", ")}`);
  }

  // 설명
  if (event.description) {
    parts.push(`[설명] ${event.description}`);
  }

  // 메모
  if (event.memo) {
    parts.push(`[메모] ${event.memo}`);
  }

  return parts.join("\n");
};

/**
 * 날짜 범위 포맷팅
 */
const formatDateRange = (start, end, isAllDay) => {
  const options = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  };

  const timeOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };

  const startDateStr = start.toLocaleDateString("ko-KR", options);
  const endDateStr = end.toLocaleDateString("ko-KR", options);

  if (isAllDay) {
    if (startDateStr === endDateStr) {
      return `${startDateStr} (종일)`;
    }
    return `${startDateStr} ~ ${endDateStr} (종일)`;
  }

  const startTimeStr = start.toLocaleTimeString("ko-KR", timeOptions);
  const endTimeStr = end.toLocaleTimeString("ko-KR", timeOptions);

  if (startDateStr === endDateStr) {
    return `${startDateStr} ${startTimeStr} ~ ${endTimeStr}`;
  }

  return `${startDateStr} ${startTimeStr} ~ ${endDateStr} ${endTimeStr}`;
};

export default { parseLinkedCardIds, eventToRawText };

