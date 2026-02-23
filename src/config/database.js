import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { logger } from "../utils/logger.js";

dotenv.config();

const pool = mysql.createPool({
  timezone: "+09:00", // 한국 시간대 설정
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  multipleStatements: true, // 여러 SQL 쿼리 실행 허용
  dateStrings: true, // 날짜 데이터를 문자열로 반환
  keepAliveInitialDelay: 10000, // 연결 유지 활성화 전 대기 시간 (ms)
  enableKeepAlive: true, // Keep-Alive 활성화
  connectionLimit: 100, // 최대 연결 수
  waitForConnections: true,
  queueLimit: 0,
});

// 연결 테스트
const testConnection = async () => {
  try {
    const connection = await pool.getConnection();
    logger.info("MySQL connected successfully");
    connection.release();
    return true;
  } catch (error) {
    logger.error("MySQL connection error", error);
    return false;
  }
};

// 테이블 생성 함수
const createTables = async () => {
  try {
    const connection = await pool.getConnection();

    // Users 테이블
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        username VARCHAR(255) UNIQUE,
        password VARCHAR(255),
        name VARCHAR(255),
        phone VARCHAR(50),
        cardDesign VARCHAR(50),
        company VARCHAR(255),
        position VARCHAR(255),
        profileImage VARCHAR(500),
        oauthProvider ENUM('google', 'apple') NULL,
        oauthId VARCHAR(255),
        subscription ENUM('free', 'premium') DEFAULT 'free',
        cardLimit INT DEFAULT 200,
        isActive BOOLEAN DEFAULT TRUE,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_email (email),
        INDEX idx_username (username),
        INDEX idx_oauth (oauthProvider, oauthId)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 기존 users 테이블에 username 필드가 없으면 추가 (마이그레이션)
    try {
      const [usernameCols] = await connection.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'username'`,
        [process.env.DB_NAME || 'HCI_2025']
      );
      if (!usernameCols || usernameCols.length === 0) {
        await connection.query(
          `ALTER TABLE users ADD COLUMN username VARCHAR(255) UNIQUE AFTER email`
        );
        await connection.query(
          `ALTER TABLE users ADD INDEX idx_username (username)`
        );
        logger.info("users.username column added (migration)");
      }
    } catch (migrationErr) {
      logger.warn("users username migration skipped", { message: migrationErr.message });
    }

    // 기존 users 테이블에 cardDesign, company, position 필드가 없으면 추가 (마이그레이션)
    try {
      const [cols] = await connection.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME IN ('cardDesign', 'company', 'position')`,
        [process.env.DB_NAME || 'HCI_2025']
      );
      const existingCols = cols.map(c => c.COLUMN_NAME);
      if (!existingCols.includes('cardDesign')) {
        await connection.query(
          `ALTER TABLE users ADD COLUMN cardDesign VARCHAR(50) AFTER phone`
        );
      }
      if (!existingCols.includes('company')) {
        await connection.query(
          `ALTER TABLE users ADD COLUMN company VARCHAR(255) AFTER cardDesign`
        );
      }
      if (!existingCols.includes('position')) {
        await connection.query(
          `ALTER TABLE users ADD COLUMN position VARCHAR(255) AFTER company`
        );
      }
      if (!existingCols.includes('cardDesign') || !existingCols.includes('company') || !existingCols.includes('position')) {
        logger.info("users cardDesign/company/position columns added (migration)");
      }
    } catch (migrationErr) {
      logger.warn("users cardDesign/company/position migration skipped", { message: migrationErr.message });
    }

    // BusinessCards 테이블
    await connection.query(`
      CREATE TABLE IF NOT EXISTS business_cards (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        position VARCHAR(255),
        company VARCHAR(255),
        phone VARCHAR(50),
        email VARCHAR(255),
        gender VARCHAR(50),
        memo TEXT,
        image TEXT,
        design ENUM('design-1', 'design-2', 'design-3', 'design-4', 'design-5', 'design-6') DEFAULT 'design-1',
        isFavorite BOOLEAN DEFAULT FALSE,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_userId (userId),
        INDEX idx_company (company),
        INDEX idx_name (name),
        INDEX idx_createdAt (createdAt)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 기존 테이블에 gender 컬럼이 없으면 추가 (memo 제거 등 스키마 변경 대응)
    try {
      const [cols] = await connection.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'business_cards' AND COLUMN_NAME = 'gender'`,
        [process.env.DB_NAME || 'HCI_2025']
      );
      if (!cols || cols.length === 0) {
        await connection.query(
          `ALTER TABLE business_cards ADD COLUMN gender VARCHAR(50) NULL AFTER email`
        );
        logger.info("business_cards.gender column added (migration)");
      }
    } catch (migrationErr) {
      logger.warn("business_cards gender migration skipped", { message: migrationErr.message });
    }

    // design 컬럼을 ENUM에서 VARCHAR로 변경 (커스텀 색상 지원)
    try {
      const [designCol] = await connection.query(
        `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'business_cards' AND COLUMN_NAME = 'design'`,
        [process.env.DB_NAME || 'HCI_2025']
      );
      if (designCol && designCol.length > 0 && designCol[0].COLUMN_TYPE.includes('enum')) {
        await connection.query(
          `ALTER TABLE business_cards MODIFY COLUMN design VARCHAR(50) DEFAULT 'design-1'`
        );
        logger.info("business_cards.design column migrated from ENUM to VARCHAR");
      }
    } catch (migrationErr) {
      logger.warn("business_cards design migration skipped", { message: migrationErr.message });
    }

    // Gifts 테이블
    await connection.query(`
      CREATE TABLE IF NOT EXISTS gifts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        cardId INT NOT NULL,
        giftName VARCHAR(255) NOT NULL,
        giftDescription TEXT,
        giftImage VARCHAR(500),
        price DECIMAL(10, 2),
        category VARCHAR(100),
        purchaseDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        occasion VARCHAR(100),
        notes TEXT,
        year VARCHAR(4),
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (cardId) REFERENCES business_cards(id) ON DELETE CASCADE,
        INDEX idx_userId (userId),
        INDEX idx_cardId (cardId),
        INDEX idx_year (year),
        INDEX idx_purchaseDate (purchaseDate)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Events 테이블
    await connection.query(`
      CREATE TABLE IF NOT EXISTS events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        startDate DATETIME NOT NULL,
        endDate DATETIME NOT NULL,
        category ENUM('미팅', '업무', '개인', '기타') DEFAULT '기타',
        color VARCHAR(20) DEFAULT '#9ca3af',
        description TEXT,
        location VARCHAR(255),
        memo TEXT,
        notification VARCHAR(50),
        googleCalendarEventId VARCHAR(255),
        isAllDay BOOLEAN DEFAULT FALSE,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_userId (userId),
        INDEX idx_startDate (startDate),
        INDEX idx_category (category)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Chats 테이블
    await connection.query(`
      CREATE TABLE IF NOT EXISTS chats (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        llmProvider ENUM('gpt', 'claude', 'gemini') DEFAULT 'gpt',
        title VARCHAR(255),
        messages JSON,
        isActive BOOLEAN DEFAULT TRUE,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_userId (userId),
        INDEX idx_createdAt (createdAt),
        INDEX idx_isActive (isActive)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Memo 테이블
    await connection.query(`
      CREATE TABLE IF NOT EXISTS memo (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        business_card_id INT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (business_card_id) REFERENCES business_cards(id) ON DELETE CASCADE,
        INDEX idx_user_id (user_id),
        INDEX idx_business_card_id (business_card_id),
        INDEX idx_updated_at (updated_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Preference Profile 테이블
    await connection.query(`
      CREATE TABLE IF NOT EXISTS preference_profile (
        business_card_id INT PRIMARY KEY,
        likes JSON NULL,
        dislikes JSON NULL,
        uncertain JSON NULL,
        last_source_count INT DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (business_card_id) REFERENCES business_cards(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Preference Event 테이블
    await connection.query(`
      CREATE TABLE IF NOT EXISTS preference_event (
        id INT AUTO_INCREMENT PRIMARY KEY,
        business_card_id INT NOT NULL,
        memo_id INT NOT NULL,
        polarity ENUM('like','dislike','uncertain') NOT NULL,
        item VARCHAR(255) NOT NULL,
        evidence TEXT NOT NULL,
        confidence FLOAT DEFAULT 0.5,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (business_card_id) REFERENCES business_cards(id) ON DELETE CASCADE,
        FOREIGN KEY (memo_id) REFERENCES memo(id) ON DELETE CASCADE,
        INDEX idx_business_card_id (business_card_id),
        INDEX idx_memo_id (memo_id),
        INDEX idx_polarity (polarity)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Card Groups 테이블
    await connection.query(`
      CREATE TABLE IF NOT EXISTS card_groups (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        displayOrder INT DEFAULT 0,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_userId (userId),
        INDEX idx_displayOrder (displayOrder)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Group Cards 테이블 (Many-to-Many)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS group_cards (
        id INT AUTO_INCREMENT PRIMARY KEY,
        groupId INT NOT NULL,
        businessCardId INT NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (groupId) REFERENCES card_groups(id) ON DELETE CASCADE,
        FOREIGN KEY (businessCardId) REFERENCES business_cards(id) ON DELETE CASCADE,
        UNIQUE KEY unique_group_card (groupId, businessCardId),
        INDEX idx_groupId (groupId),
        INDEX idx_businessCardId (businessCardId)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Auth Codes 테이블 (아이디 찾기용 인증 코드)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS auth_codes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        code_hash VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        attempts INT DEFAULT 0,
        verified BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_email (email),
        INDEX idx_expires_at (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Password Reset Tokens 테이블
    await connection.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        token_hash VARCHAR(255) NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_token_hash (token_hash),
        INDEX idx_user_id (user_id),
        INDEX idx_expires_at (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    connection.release();
    logger.info("Database tables created/verified successfully");
  } catch (error) {
    logger.error("Error creating tables", error);
    throw error;
  }
};

export { pool, testConnection, createTables };
export default pool;
