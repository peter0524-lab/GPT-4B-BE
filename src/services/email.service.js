import { logger } from "../utils/logger.js";
import nodemailer from "nodemailer";

/**
 * 이메일 발송 서비스
 * nodemailer를 사용하여 실제 이메일 발송
 */
class EmailService {
  constructor() {
    this.transporter = null;
    this.initTransporter();
  }

  /**
   * Nodemailer transporter 초기화
   */
  initTransporter() {
    // SMTP 설정이 있으면 실제 이메일 발송, 없으면 콘솔 출력만
    if (
      process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS
    ) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || "587"),
        secure: process.env.SMTP_SECURE === "true", // true for 465, false for other ports
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      logger.info("이메일 서비스 초기화 완료 (SMTP)", {
        host: process.env.SMTP_HOST,
        user: process.env.SMTP_USER,
      });
    } else {
      logger.warn(
        "SMTP 설정이 없어 콘솔 출력 모드로 동작합니다. .env에 SMTP 설정을 추가하세요."
      );
    }
  }

  /**
   * 인증 코드 이메일 발송
   * @param {string} email - 수신자 이메일
   * @param {string} code - 인증 코드
   */
  async sendVerificationCode(email, code) {
    try {
      const subject = "[GPT-4b] 아이디 찾기 인증 코드";
      const html = `
        <div style="font-family: 'Noto Sans KR', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #584CDC; margin-bottom: 20px;">GPT-4b 아이디 찾기</h2>
          <p style="font-size: 16px; line-height: 1.6; color: #333;">
            안녕하세요,<br><br>
            아이디 찾기를 위한 인증 코드입니다.
          </p>
          <div style="background-color: #f5f5f5; padding: 20px; border-radius: 10px; text-align: center; margin: 30px 0;">
            <p style="font-size: 14px; color: #666; margin: 0 0 10px 0;">인증 코드</p>
            <p style="font-size: 32px; font-weight: bold; color: #584CDC; letter-spacing: 5px; margin: 0;">
              ${code}
            </p>
          </div>
          <p style="font-size: 14px; color: #999; line-height: 1.6;">
            이 코드는 10분간 유효합니다.<br>
            본인이 요청하지 않은 경우 이 이메일을 무시하셔도 됩니다.
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          <p style="font-size: 12px; color: #999; text-align: center;">
            © GPT-4b. All rights reserved.
          </p>
        </div>
      `;

      if (this.transporter) {
        // 실제 이메일 발송
        await this.transporter.sendMail({
          from: `"GPT-4b" <${process.env.SMTP_USER}>`,
          to: email,
          subject: subject,
          html: html,
        });

        logger.info("인증 코드 이메일 발송 완료", { to: email });
        return { success: true };
      } else {
        // 개발 모드: 콘솔 출력
        logger.info("📧 [개발 모드] 인증 코드 이메일 발송", {
          to: email,
          code: code,
        });
        console.log("\n=== 인증 코드 이메일 ===");
        console.log(`받는 사람: ${email}`);
        console.log(`인증 코드: ${code}`);
        console.log(`제목: ${subject}`);
        console.log("=====================\n");
        return { success: true };
      }
    } catch (error) {
      logger.error("이메일 발송 실패", { email, error: error.message });
      throw error;
    }
  }

  /**
   * 비밀번호 재설정 링크 이메일 발송
   * @param {string} email - 수신자 이메일
   * @param {string} resetToken - 재설정 토큰
   */
  async sendPasswordResetLink(email, resetToken) {
    try {
      const resetUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/reset-password/${resetToken}`;
      const subject = "[GPT-4b] 비밀번호 재설정";
      const html = `
        <div style="font-family: 'Noto Sans KR', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #584CDC; margin-bottom: 20px;">비밀번호 재설정</h2>
          <p style="font-size: 16px; line-height: 1.6; color: #333;">
            안녕하세요,<br><br>
            비밀번호 재설정을 요청하셨습니다. 아래 버튼을 클릭하여 새 비밀번호를 설정하세요.
          </p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" 
               style="display: inline-block; background-color: #584CDC; color: white; 
                      padding: 15px 30px; text-decoration: none; border-radius: 10px; 
                      font-weight: bold; font-size: 16px;">
              비밀번호 재설정하기
            </a>
          </div>
          <p style="font-size: 14px; color: #666; line-height: 1.6;">
            버튼이 동작하지 않는 경우 아래 링크를 복사하여 브라우저에 붙여넣으세요:<br>
            <a href="${resetUrl}" style="color: #584CDC; word-break: break-all;">${resetUrl}</a>
          </p>
          <p style="font-size: 14px; color: #999; line-height: 1.6; margin-top: 30px;">
            이 링크는 1시간간 유효합니다.<br>
            본인이 요청하지 않은 경우 이 이메일을 무시하셔도 됩니다.
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          <p style="font-size: 12px; color: #999; text-align: center;">
            © GPT-4b. All rights reserved.
          </p>
        </div>
      `;

      if (this.transporter) {
        // 실제 이메일 발송
        await this.transporter.sendMail({
          from: `"GPT-4b" <${process.env.SMTP_USER}>`,
          to: email,
          subject: subject,
          html: html,
        });

        logger.info("비밀번호 재설정 링크 이메일 발송 완료", { to: email });
        return { success: true };
      } else {
        // 개발 모드: 콘솔 출력
        logger.info("📧 [개발 모드] 비밀번호 재설정 링크 이메일 발송", {
          to: email,
          resetUrl: resetUrl,
        });
        console.log("\n=== 비밀번호 재설정 이메일 ===");
        console.log(`받는 사람: ${email}`);
        console.log(`재설정 링크: ${resetUrl}`);
        console.log(`제목: ${subject}`);
        console.log("===========================\n");
        return { success: true };
      }
    } catch (error) {
      logger.error("이메일 발송 실패", { email, error: error.message });
      throw error;
    }
  }
}

export default new EmailService();
