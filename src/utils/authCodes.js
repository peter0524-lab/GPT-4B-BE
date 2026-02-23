import pool from "../config/database.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { logger } from "./logger.js";

/**
 * 인증 코드 생성 및 관리
 */
export class AuthCodeManager {
  /**
   * 6자리 숫자 인증 코드 생성
   */
  static generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * 인증 코드 해시
   */
  static async hashCode(code) {
    return await bcrypt.hash(code, 10);
  }

  /**
   * 인증 코드 검증
   */
  static async verifyCode(code, hash) {
    return await bcrypt.compare(code, hash);
  }

  /**
   * 인증 코드 저장
   * @param {string} email - 이메일
   * @param {string} code - 인증 코드
   * @param {number} expiresInMinutes - 만료 시간 (분)
   */
  static async saveCode(email, code, expiresInMinutes = 10) {
    try {
      const codeHash = await this.hashCode(code);
      const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

      // 기존 코드 삭제 (같은 이메일의 미사용 코드)
      await pool.query(
        `DELETE FROM auth_codes WHERE email = ? AND verified = FALSE`,
        [email]
      );

      // 새 코드 저장
      await pool.query(
        `INSERT INTO auth_codes (email, code_hash, expires_at) VALUES (?, ?, ?)`,
        [email, codeHash, expiresAt]
      );

      logger.debug("인증 코드 저장 완료", { email });
      return true;
    } catch (error) {
      logger.error("인증 코드 저장 실패", { email, error: error.message });
      throw error;
    }
  }

  /**
   * 인증 코드 검증
   * @param {string} email - 이메일
   * @param {string} code - 인증 코드
   */
  static async verifyAndMarkCode(email, code) {
    try {
      // 만료되지 않은 코드 조회
      const [rows] = await pool.query(
        `SELECT id, code_hash, attempts FROM auth_codes 
         WHERE email = ? AND verified = FALSE AND expires_at > NOW() 
         ORDER BY created_at DESC LIMIT 1`,
        [email]
      );

      if (!rows || rows.length === 0) {
        return { valid: false, message: "인증 코드가 없거나 만료되었습니다." };
      }

      const record = rows[0];

      // 시도 횟수 확인 (최대 5회)
      if (record.attempts >= 5) {
        return { valid: false, message: "인증 코드 시도 횟수를 초과했습니다." };
      }

      // 코드 검증
      const isValid = await this.verifyCode(code, record.code_hash);

      if (!isValid) {
        // 시도 횟수 증가
        await pool.query(
          `UPDATE auth_codes SET attempts = attempts + 1 WHERE id = ?`,
          [record.id]
        );
        return { valid: false, message: "인증 코드가 일치하지 않습니다." };
      }

      // 검증 완료 표시
      await pool.query(
        `UPDATE auth_codes SET verified = TRUE WHERE id = ?`,
        [record.id]
      );

      logger.debug("인증 코드 검증 완료", { email });
      return { valid: true };
    } catch (error) {
      logger.error("인증 코드 검증 실패", { email, error: error.message });
      throw error;
    }
  }
}

/**
 * 비밀번호 재설정 토큰 관리
 */
export class ResetTokenManager {
  /**
   * 재설정 토큰 생성
   */
  static generateToken() {
    return crypto.randomBytes(32).toString("hex");
  }

  /**
   * 토큰 해시
   */
  static async hashToken(token) {
    return await bcrypt.hash(token, 10);
  }

  /**
   * 토큰 검증
   */
  static async verifyToken(token, hash) {
    return await bcrypt.compare(token, hash);
  }

  /**
   * 재설정 토큰 저장
   * @param {number} userId - 사용자 ID
   * @param {string} token - 토큰
   * @param {number} expiresInHours - 만료 시간 (시간)
   */
  static async saveToken(userId, token, expiresInHours = 1) {
    try {
      const tokenHash = await this.hashToken(token);
      const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

      // 기존 토큰 무효화
      await pool.query(
        `UPDATE password_reset_tokens SET used = TRUE WHERE user_id = ? AND used = FALSE`,
        [userId]
      );

      // 새 토큰 저장
      await pool.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
        [userId, tokenHash, expiresAt]
      );

      logger.debug("재설정 토큰 저장 완료", { userId });
      return true;
    } catch (error) {
      logger.error("재설정 토큰 저장 실패", { userId, error: error.message });
      throw error;
    }
  }

  /**
   * 재설정 토큰 검증 및 사용자 ID 반환
   * @param {string} token - 토큰
   */
  static async verifyTokenAndGetUserId(token) {
    try {
      // 만료되지 않은 미사용 토큰 조회
      const [rows] = await pool.query(
        `SELECT id, user_id, token_hash FROM password_reset_tokens 
         WHERE used = FALSE AND expires_at > NOW() 
         ORDER BY created_at DESC`,
        []
      );

      if (!rows || rows.length === 0) {
        return { valid: false, message: "토큰이 없거나 만료되었습니다." };
      }

      // 토큰 검증 (모든 토큰과 비교)
      for (const record of rows) {
        const isValid = await this.verifyToken(token, record.token_hash);
        if (isValid) {
          // 토큰 사용 표시
          await pool.query(
            `UPDATE password_reset_tokens SET used = TRUE WHERE id = ?`,
            [record.id]
          );

          logger.debug("재설정 토큰 검증 완료", { userId: record.user_id });
          return { valid: true, userId: record.user_id };
        }
      }

      return { valid: false, message: "유효하지 않은 토큰입니다." };
    } catch (error) {
      logger.error("재설정 토큰 검증 실패", { error: error.message });
      throw error;
    }
  }
}
