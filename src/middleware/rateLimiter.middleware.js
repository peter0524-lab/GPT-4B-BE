import { logger } from "../utils/logger.js";

/**
 * 간단한 Rate Limiting 미들웨어
 * 프로덕션에서는 express-rate-limit 사용 권장
 */
class RateLimiter {
  constructor() {
    // 메모리 기반 저장소 (개발용)
    // 프로덕션에서는 Redis 사용 권장
    this.requests = new Map();
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000); // 1분마다 정리
  }

  /**
   * 만료된 요청 기록 정리
   */
  cleanup() {
    const now = Date.now();
    for (const [key, data] of this.requests.entries()) {
      if (data.expiresAt < now) {
        this.requests.delete(key);
      }
    }
  }

  /**
   * Rate limit 체크
   * @param {Object} options - 옵션
   * @param {number} options.windowMs - 시간 윈도우 (밀리초)
   * @param {number} options.maxRequests - 최대 요청 수
   * @returns {Function} Express 미들웨어
   */
  createLimiter({ windowMs = 15 * 60 * 1000, maxRequests = 5 } = {}) {
    return (req, res, next) => {
      try {
        // IP 주소 또는 이메일을 키로 사용
        const identifier = req.body?.email || req.ip || "unknown";
        const key = `${identifier}:${Math.floor(Date.now() / windowMs)}`;
        const now = Date.now();

        // 기존 요청 기록 확인
        const record = this.requests.get(key);

        if (record) {
          if (record.count >= maxRequests) {
            logger.warn("Rate limit exceeded", {
              identifier,
              count: record.count,
              maxRequests,
            });
            return res.status(429).json({
              success: false,
              message: "너무 많은 요청이 발생했습니다. 잠시 후 다시 시도해주세요.",
            });
          }
          record.count += 1;
        } else {
          this.requests.set(key, {
            count: 1,
            expiresAt: now + windowMs,
          });
        }

        next();
      } catch (error) {
        logger.error("Rate limiter error", { error: error.message });
        // 에러 발생 시 요청 허용 (fail-open)
        next();
      }
    };
  }
}

// 싱글톤 인스턴스
const rateLimiter = new RateLimiter();

/**
 * 아이디 찾기용 Rate Limiter (15분에 3회)
 */
export const findUsernameLimiter = rateLimiter.createLimiter({
  windowMs: 15 * 60 * 1000, // 15분
  maxRequests: 3,
});

/**
 * 비밀번호 재설정용 Rate Limiter (1시간에 3회)
 */
export const resetPasswordLimiter = rateLimiter.createLimiter({
  windowMs: 60 * 60 * 1000, // 1시간
  maxRequests: 3,
});
