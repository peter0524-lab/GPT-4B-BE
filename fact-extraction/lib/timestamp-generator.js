/**
 * 시간 데이터 자동 생성기
 * LLM이 생성한 내용에 현실적이고 중복 없는 시간을 자동 할당
 */

/**
 * 스마트 타임스탬프 생성기
 */
export class TimestampGenerator {
  constructor() {
    this.usedTimestamps = new Set();
    this.baseDate = new Date('2025-09-01T00:00:00.000Z');
    this.maxDate = new Date('2026-01-17T23:59:59.999Z');
  }

  /**
   * 기존 데이터의 시간들을 등록 (중복 방지용)
   */
  registerExistingTimestamps(existingData = {}) {
    const { memos = [], events = [], gifts = [], chats = [], cards = [] } = existingData;
    
    // 명함 등록 시간
    cards.forEach(card => {
      if (card.createdAt) {
        this.usedTimestamps.add(new Date(card.createdAt).getTime());
      }
    });

    // 메모 작성 시간
    memos.forEach(memo => {
      if (memo.created_at) this.usedTimestamps.add(new Date(memo.created_at).getTime());
      if (memo.updated_at) this.usedTimestamps.add(new Date(memo.updated_at).getTime());
    });

    // 일정 시간
    events.forEach(event => {
      if (event.startDate) this.usedTimestamps.add(new Date(event.startDate).getTime());
      if (event.endDate) this.usedTimestamps.add(new Date(event.endDate).getTime());
      if (event.createdAt) this.usedTimestamps.add(new Date(event.createdAt).getTime());
    });

    // 선물 구매 시간
    gifts.forEach(gift => {
      if (gift.purchaseDate) this.usedTimestamps.add(new Date(gift.purchaseDate).getTime());
      if (gift.createdAt) this.usedTimestamps.add(new Date(gift.createdAt).getTime());
    });

    // 채팅 시간
    chats.forEach(chat => {
      if (chat.createdAt) this.usedTimestamps.add(new Date(chat.createdAt).getTime());
    });

    console.log(`기존 타임스탬프 ${this.usedTimestamps.size}개 등록됨`);
  }

  /**
   * 랜덤하지만 현실적인 시간 생성
   * @param {Date} afterDate - 이 날짜 이후에 생성 (선택사항)
   * @param {number} minDaysAfter - 최소 며칠 후 (기본 1일)
   * @param {number} maxDaysAfter - 최대 며칠 후 (기본 30일)  
   * @returns {Date}
   */
  generateRealisticTimestamp(afterDate = null, minDaysAfter = 1, maxDaysAfter = 30) {
    const startDate = afterDate || this.getRandomStartDate();
    
    // 최소~최대 일수 범위에서 랜덤 선택
    const daysToAdd = minDaysAfter + Math.random() * (maxDaysAfter - minDaysAfter);
    
    let newDate = new Date(startDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
    
    // ⚠️ maxDate 초과 방지
    if (newDate > this.maxDate) {
      newDate = new Date(this.maxDate.getTime() - Math.random() * 7 * 24 * 60 * 60 * 1000); // maxDate 전 일주일 내
    }
    
    // 주말 피하기 (80% 확률)
    if (Math.random() > 0.2) {
      newDate = this.adjustToWeekday(newDate);
    }
    
    // 비즈니스 시간으로 조정
    newDate = this.adjustToBusinessHours(newDate);
    
    // 중복 체크 및 조정
    newDate = this.ensureUnique(newDate);
    
    this.usedTimestamps.add(newDate.getTime());
    return newDate;
  }

  /**
   * 명함 등록 시간 생성 (가장 이른 시간)
   */
  generateCardCreationTime() {
    const startDate = new Date(this.baseDate.getTime() + Math.random() * 90 * 24 * 60 * 60 * 1000); // 첫 3개월 내
    return this.generateRealisticTimestamp(startDate, 0, 7);
  }

  /**
   * 일정 시간들 생성 (시작/종료 시간 쌍)
   */
  generateEventTimes(cardCreationTime, count = 10) {
    const events = [];
    let lastEventTime = new Date(cardCreationTime);
    
    for (let i = 0; i < count; i++) {
      // 이전 일정으로부터 3~21일 후
      const startDate = this.generateRealisticTimestamp(lastEventTime, 3, 21);
      
      // 1~3시간 후 종료
      const duration = (1 + Math.random() * 2) * 60 * 60 * 1000; // 1-3시간
      const endDate = new Date(startDate.getTime() + duration);
      
      events.push({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      });
      
      lastEventTime = startDate;
    }
    
    return events;
  }

  /**
   * 메모 작성 시간들 생성 (일정 후 1-2일 뒤)
   */
  generateMemoTimes(eventTimes, count = 10) {
    const memos = [];
    
    for (let i = 0; i < Math.min(count, eventTimes.length); i++) {
      const eventTime = new Date(eventTimes[i].startDate);
      // 일정 후 1-2일 뒤에 메모 작성
      const memoTime = this.generateRealisticTimestamp(eventTime, 1, 2);
      
      memos.push({
        created_at: memoTime.toISOString(),
        updated_at: memoTime.toISOString()
      });
    }
    
    // 나머지 메모들은 랜덤 시간에
    const remainingCount = count - memos.length;
    let lastTime = eventTimes.length > 0 ? new Date(eventTimes[eventTimes.length - 1].startDate) : new Date(this.baseDate);
    
    for (let i = 0; i < remainingCount; i++) {
      const memoTime = this.generateRealisticTimestamp(lastTime, 7, 30);
      memos.push({
        created_at: memoTime.toISOString(),
        updated_at: memoTime.toISOString()
      });
      lastTime = memoTime;
    }
    
    return memos.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }

  /**
   * 선물 관련 시간 생성 (대화 → 구매)
   */
  generateGiftTimes(cardCreationTime, count = 1) {
    const gifts = [];
    let lastTime = new Date(cardCreationTime);
    
    for (let i = 0; i < count; i++) {
      // 선물 대화 시간 (이전으로부터 30~90일 후)
      const chatTime = this.generateRealisticTimestamp(lastTime, 30, 90);
      
      // 선물 구매 시간 (대화 후 1-5일 뒤)
      const purchaseTime = this.generateRealisticTimestamp(chatTime, 1, 5);
      
      gifts.push({
        chatTime: chatTime.toISOString(),
        purchaseDate: purchaseTime.toISOString()
      });
      
      lastTime = purchaseTime;
    }
    
    return gifts;
  }

  /**
   * 평일로 조정
   */
  adjustToWeekday(date) {
    const dayOfWeek = date.getDay(); // 0=일요일, 6=토요일
    
    if (dayOfWeek === 0) { // 일요일 → 월요일
      date.setDate(date.getDate() + 1);
    } else if (dayOfWeek === 6) { // 토요일 → 금요일
      date.setDate(date.getDate() - 1);
    }
    
    return date;
  }

  /**
   * 비즈니스 시간으로 조정 (9:00-18:00)
   */
  adjustToBusinessHours(date) {
    const hours = 9 + Math.random() * 9; // 9-18시
    const minutes = Math.floor(Math.random() * 4) * 15; // 0, 15, 30, 45분
    
    date.setHours(Math.floor(hours));
    date.setMinutes(minutes);
    date.setSeconds(0);
    date.setMilliseconds(0);
    
    return date;
  }

  /**
   * 중복 방지 (이미 사용된 시간이면 조정)
   */
  ensureUnique(date) {
    let attempts = 0;
    let newDate = new Date(date);
    
    while (this.usedTimestamps.has(newDate.getTime()) && attempts < 100) {
      // 15분씩 뒤로 밀기
      newDate = new Date(newDate.getTime() + 15 * 60 * 1000);
      attempts++;
    }
    
    if (attempts >= 100) {
      console.warn('타임스탬프 중복 해결 실패, 강제로 고유 시간 생성');
      newDate = new Date(Date.now() + Math.random() * 1000000);
    }
    
    return newDate;
  }

  /**
   * 랜덤 시작 날짜 선택
   */
  getRandomStartDate() {
    const range = this.maxDate.getTime() - this.baseDate.getTime();
    return new Date(this.baseDate.getTime() + Math.random() * range * 0.7); // 70% 지점까지만
  }

  /**
   * 생성된 시간 통계 출력
   */
  printStats() {
    console.log(`총 ${this.usedTimestamps.size}개의 고유한 타임스탬프 생성됨`);
  }
}

export default TimestampGenerator;
