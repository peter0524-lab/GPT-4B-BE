import { logger } from '../utils/logger.js';

/**
 * Redis 클라이언트 설정
 * Redis가 없어도 동작하도록 optional 처리
 */
let redisClient = null;

// Redis가 설치되어 있는지 확인 (선택사항)
if (process.env.REDIS_URL || process.env.REDIS_HOST) {
  try {
    // ioredis는 나중에 설치 가능하도록 주석 처리
    // import Redis from 'ioredis';
    // redisClient = new Redis(process.env.REDIS_URL || {
    //   host: process.env.REDIS_HOST || 'localhost',
    //   port: process.env.REDIS_PORT || 6379,
    //   password: process.env.REDIS_PASSWORD,
    // });
  } catch (error) {
    logger.warn('Redis client initialization failed', error);
  }
}

/**
 * Redis 클라이언트 가져오기 (optional)
 * @returns {Object|null} Redis 클라이언트 또는 null
 */
export const getRedisClient = () => {
  return redisClient;
};

/**
 * Redis 사용 가능 여부 확인
 * @returns {boolean}
 */
export const isRedisAvailable = () => {
  return redisClient !== null;
};

export default redisClient;
