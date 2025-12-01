import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  timezone: '+09:00', // 한국 시간대 설정
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'peter0524!',
  database: process.env.DB_NAME || 'backendTest',
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
    console.log('✅ MySQL connected successfully');
    connection.release();
    return true;
  } catch (error) {
    console.error('❌ MySQL connection error:', error.message);
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
        password VARCHAR(255),
        name VARCHAR(255),
        phone VARCHAR(50),
        profileImage VARCHAR(500),
        oauthProvider ENUM('google', 'apple') NULL,
        oauthId VARCHAR(255),
        subscription ENUM('free', 'premium') DEFAULT 'free',
        cardLimit INT DEFAULT 200,
        isActive BOOLEAN DEFAULT TRUE,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_email (email),
        INDEX idx_oauth (oauthProvider, oauthId)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

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

    connection.release();
    console.log('✅ Database tables created/verified successfully');
  } catch (error) {
    console.error('❌ Error creating tables:', error.message);
    throw error;
  }
};

export { pool, testConnection, createTables };
export default pool;

