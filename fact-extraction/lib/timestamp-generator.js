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
    this.baseDate = new Date('2024-01-01T00:00:00.000Z');
    this.maxDate = new Date('2026-01-26T23:59:59.999Z');
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
   * ⚠️ 같은 날짜에 여러 이벤트가 생성되지 않도록 보장
   */
  generateEventTimes(cardCreationTime, count = 10) {
    const events = [];
    let lastEventTime = new Date(cardCreationTime);
    const usedDates = new Set(); // 같은 날짜 중복 방지용
    
    for (let i = 0; i < count; i++) {
      // 이전 일정으로부터 최소 7일, 최대 30일 후 (더 넓게 분산)
      let startDate = this.generateRealisticTimestamp(lastEventTime, 7, 30);
      
      // 같은 날짜에 이미 이벤트가 있는지 체크 (날짜만 비교)
      let dateKey = this.getDateKey(startDate);
      let attempts = 0;
      while (usedDates.has(dateKey) && attempts < 50) {
        // 최소 하루씩 뒤로 밀기
        startDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
        dateKey = this.getDateKey(startDate);
        attempts++;
      }
      
      // 고유성 보장: 이전 일정과 최소 7일 이상 차이
      if (i > 0 && events.length > 0) {
        const prevStartTime = new Date(events[events.length - 1].startDate);
        const minDiff = 7 * 24 * 60 * 60 * 1000; // 최소 7일
        if (startDate.getTime() - prevStartTime.getTime() < minDiff) {
          startDate = new Date(prevStartTime.getTime() + minDiff + Math.random() * 14 * 24 * 60 * 60 * 1000); // 7~21일 후
          dateKey = this.getDateKey(startDate);
          // 같은 날짜 체크 다시 수행
          while (usedDates.has(dateKey) && attempts < 50) {
            startDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
            dateKey = this.getDateKey(startDate);
            attempts++;
          }
          // 비즈니스 시간으로 재조정
          startDate = this.adjustToBusinessHours(startDate);
          startDate = this.ensureUnique(startDate);
          this.usedTimestamps.add(startDate.getTime());
        }
      }
      
      // 날짜 등록
      usedDates.add(dateKey);
      
      // 1~3시간 후 종료 (최소 1시간 보장)
      const duration = (1 + Math.random() * 2) * 60 * 60 * 1000; // 1-3시간
      let endDate = new Date(startDate.getTime() + duration);
      
      // endDate가 startDate와 최소 30분 이상 차이나도록 보장
      const minDuration = 30 * 60 * 1000; // 30분
      if (endDate.getTime() - startDate.getTime() < minDuration) {
        endDate = new Date(startDate.getTime() + minDuration + Math.random() * 2.5 * 60 * 60 * 1000);
      }
      
      // endDate도 고유성 보장
      endDate = this.ensureUnique(endDate);
      this.usedTimestamps.add(endDate.getTime());
      
      events.push({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      });
      
      lastEventTime = startDate;
    }
    
    return events;
  }

  /**
   * 메모 작성 시간들 생성 (일정의 endDate 기준으로 각 메모가 4분 후, 메모 간 차이는 일정 간 차이와 동일)
   * ⚠️ 같은 날짜에 여러 메모가 생성되지 않도록 보장
   */
  generateMemoTimes(eventTimes, count = 10) {
    const memos = [];
    const baseOffsetMinutes = 4; // 각 메모는 해당 일정의 endDate + 4분
    const minDaysBetweenEvents = 7; // 일정 간 최소 간격 (1주일) - 메모 간 차이도 동일하게 적용
    const usedMemoDates = new Set(); // 메모 날짜 중복 방지용
    
    // 일정이 있는 경우: 각 일정의 endDate + 4분에 메모 생성
    // 이렇게 하면 메모 간 차이가 일정 간 차이(1주일)와 자연스럽게 동일해짐
    for (let i = 0; i < Math.min(count, eventTimes.length); i++) {
      const eventEndDate = new Date(eventTimes[i].endDate);
      // 각 메모는 해당 일정의 endDate + 4분
      let memoTime = new Date(eventEndDate.getTime() + baseOffsetMinutes * 60 * 1000);
      
      // 같은 날짜에 이미 메모가 있는지 체크
      let dateKey = this.getDateKey(memoTime);
      let attempts = 0;
      while (usedMemoDates.has(dateKey) && attempts < 50) {
        // 최소 하루씩 뒤로 밀기
        memoTime = new Date(memoTime.getTime() + 24 * 60 * 60 * 1000);
        dateKey = this.getDateKey(memoTime);
        attempts++;
      }
      
      // 고유성 보장
      memoTime = this.ensureUnique(memoTime);
      this.usedTimestamps.add(memoTime.getTime());
      usedMemoDates.add(dateKey);
      
      memos.push({
        created_at: memoTime.toISOString(),
        updated_at: memoTime.toISOString()
      });
    }
    
    // 나머지 메모들은 마지막 일정의 endDate 기준으로 일정 간격(1주일)과 동일하게 추가
    const remainingCount = count - memos.length;
    if (remainingCount > 0 && eventTimes.length > 0) {
      const lastEventEndDate = new Date(eventTimes[eventTimes.length - 1].endDate);
      let lastMemoTime = memos.length > 0 ? new Date(memos[memos.length - 1].created_at) : lastEventEndDate;
      
      for (let i = 0; i < remainingCount; i++) {
        // 일정 간격(1주일)과 동일한 간격으로 메모 생성
        const daysToAdd = minDaysBetweenEvents + Math.random() * 7; // 1주일 ~ 2주일
        let memoTime = new Date(lastMemoTime.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
        // endDate + 4분과 유사하게 시간 조정
        memoTime = new Date(memoTime.getTime() + baseOffsetMinutes * 60 * 1000);
        
        // 같은 날짜에 이미 메모가 있는지 체크
        let dateKey = this.getDateKey(memoTime);
        let attempts = 0;
        while (usedMemoDates.has(dateKey) && attempts < 50) {
          // 최소 하루씩 뒤로 밀기
          memoTime = new Date(memoTime.getTime() + 24 * 60 * 60 * 1000);
          dateKey = this.getDateKey(memoTime);
          attempts++;
        }
        
        // 비즈니스 시간으로 조정
        memoTime = this.adjustToBusinessHours(memoTime);
        
        // 고유성 보장
        memoTime = this.ensureUnique(memoTime);
        this.usedTimestamps.add(memoTime.getTime());
        usedMemoDates.add(dateKey);
        
        memos.push({
          created_at: memoTime.toISOString(),
          updated_at: memoTime.toISOString()
        });
        
        lastMemoTime = memoTime;
      }
    }
    
    // 일정이 없는 경우: baseDate 기준으로 일정 간격(1주일)과 동일하게 생성
    if (eventTimes.length === 0 && count > 0) {
      let lastMemoTime = new Date(this.baseDate);
      for (let i = 0; i < count; i++) {
        // 일정 간격(1주일)과 동일한 간격으로 메모 생성
        const daysToAdd = minDaysBetweenEvents + Math.random() * 7; // 1주일 ~ 2주일
        let memoTime = new Date(lastMemoTime.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
        // endDate + 4분과 유사하게 시간 조정
        memoTime = new Date(memoTime.getTime() + baseOffsetMinutes * 60 * 1000);
        
        // 같은 날짜에 이미 메모가 있는지 체크
        let dateKey = this.getDateKey(memoTime);
        let attempts = 0;
        while (usedMemoDates.has(dateKey) && attempts < 50) {
          // 최소 하루씩 뒤로 밀기
          memoTime = new Date(memoTime.getTime() + 24 * 60 * 60 * 1000);
          dateKey = this.getDateKey(memoTime);
          attempts++;
        }
        
        // 비즈니스 시간으로 조정
        memoTime = this.adjustToBusinessHours(memoTime);
        
        // 고유성 보장
        memoTime = this.ensureUnique(memoTime);
        this.usedTimestamps.add(memoTime.getTime());
        usedMemoDates.add(dateKey);
        
        memos.push({
          created_at: memoTime.toISOString(),
          updated_at: memoTime.toISOString()
        });
        
        lastMemoTime = memoTime;
      }
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
   * ⚠️ 시간 분산을 더 넓게 (1분 단위로 다양하게)
   */
  adjustToBusinessHours(date) {
    const hours = 9 + Math.random() * 9; // 9-18시
    const minutes = Math.floor(Math.random() * 60); // 0-59분 (더 다양하게)
    // 초와 밀리초도 랜덤하게 설정하여 고유성 보장
    const seconds = Math.floor(Math.random() * 60);
    const milliseconds = Math.floor(Math.random() * 1000);
    
    date.setHours(Math.floor(hours));
    date.setMinutes(minutes);
    date.setSeconds(seconds);
    date.setMilliseconds(milliseconds);
    
    return date;
  }

  /**
   * 날짜 키 생성 (YYYY-MM-DD 형식)
   * 같은 날짜 체크용
   */
  getDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * 중복 방지 (이미 사용된 시간이면 조정)
   * ⚠️ 최소 1시간 이상 차이를 보장하여 같은 날짜에 여러 이벤트가 몰리지 않도록
   */
  ensureUnique(date) {
    let attempts = 0;
    let newDate = new Date(date);
    
    while (this.usedTimestamps.has(newDate.getTime()) && attempts < 100) {
      // 최소 1시간씩 뒤로 밀기 (같은 날짜에 여러 이벤트 방지)
      const offset = (1 + Math.random()) * 60 * 60 * 1000; // 1-2시간
      newDate = new Date(newDate.getTime() + offset);
      // 밀리초도 랜덤하게 조정하여 고유성 보장
      newDate.setMilliseconds(newDate.getMilliseconds() + Math.floor(Math.random() * 1000));
      attempts++;
    }
    
    if (attempts >= 100) {
      console.warn('타임스탬프 중복 해결 실패, 강제로 고유 시간 생성');
      // 최소 하루 뒤로 밀기
      newDate = new Date(date.getTime() + 24 * 60 * 60 * 1000);
      newDate.setMilliseconds(Math.floor(Math.random() * 1000));
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
