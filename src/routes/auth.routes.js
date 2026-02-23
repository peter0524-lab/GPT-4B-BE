import express from "express";
import { body, validationResult } from "express-validator";
import User from "../models/User.model.js";
import { generateToken } from "../utils/jwt.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { AuthCodeManager, ResetTokenManager } from "../utils/authCodes.js";
import emailService from "../services/email.service.js";
import { findUsernameLimiter, resetPasswordLimiter } from "../middleware/rateLimiter.middleware.js";

const router = express.Router();

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post(
  "/register",
  [
    body("username")
      .trim()
      .isLength({ min: 4 })
      .withMessage("Username must be at least 4 characters long")
      .matches(/^[a-zA-Z][a-zA-Z0-9]*$/)
      .withMessage("Username must start with a letter and contain only letters and numbers"),
    body("email").isEmail().normalizeEmail(),
    body("password").isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters long"),
    body("name").optional().trim(),
    body("phone").optional().trim(),
    body("company").optional().trim(),
    body("position").optional().trim(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const { email, username, password, name, phone, company, position } =
        req.body;

      // Check if email already exists
      const existingEmail = await User.findByEmail(email);
      if (existingEmail) {
        return res.status(400).json({
          success: false,
          message: "이미 사용 중인 이메일입니다.",
        });
      }

      // Check if username already exists
      const existingUsername = await User.findByUsername(username);
      if (existingUsername) {
        return res.status(400).json({
          success: false,
          message: "이미 사용 중인 아이디입니다.",
        });
      }

      // Hash password
      const bcrypt = await import("bcryptjs");
      const hashedPassword = await bcrypt.default.hash(password, 10);

      // Create user
      let user;
      try {
        user = await User.create({
          email,
          username,
          password: hashedPassword,
          name: name || username,
          phone,
          company,
          position,
        });
      } catch (dbError) {
        // DB 제약조건 위반 체크 (UNIQUE 제약조건 등)
        if (dbError.code === 'ER_DUP_ENTRY') {
          const errorMessage = dbError.sqlMessage || dbError.message;
          if (errorMessage.includes('username')) {
            return res.status(400).json({
              success: false,
              message: "이미 사용 중인 아이디입니다.",
            });
          } else if (errorMessage.includes('email')) {
            return res.status(400).json({
              success: false,
              message: "이미 사용 중인 이메일입니다.",
            });
          }
        }
        // 기타 DB 에러는 그대로 throw
        throw dbError;
      }

      const token = generateToken(user.id);

      res.status(201).json({
        success: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          name: user.name,
          subscription: user.subscription,
        },
      });
    } catch (error) {
      // 에러 로깅
      console.error("회원가입 에러:", error);
      
      // 이미 처리된 에러는 그대로 반환
      if (error.statusCode || error.response) {
        throw error;
      }

      // DB 제약조건 위반 에러 처리
      if (error.code === 'ER_DUP_ENTRY') {
        const errorMessage = error.sqlMessage || error.message;
        if (errorMessage.includes('username')) {
          return res.status(400).json({
            success: false,
            message: "이미 사용 중인 아이디입니다.",
          });
        } else if (errorMessage.includes('email')) {
          return res.status(400).json({
            success: false,
            message: "이미 사용 중인 이메일입니다.",
          });
        }
      }

      res.status(500).json({
        success: false,
        message: error.message || "회원가입에 실패했습니다.",
      });
    }
  }
);

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post(
  "/login",
  [body("username").exists(), body("password").exists()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const { username, password } = req.body;

      // Find user
      const user = await User.findByUsername(username);
      if (!user) {
        return res.status(401).json({
          success: false,
          message: "Invalid credentials",
        });
      }

      // Check password
      const bcrypt = await import("bcryptjs");
      const isMatch = await bcrypt.default.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: "Invalid credentials",
        });
      }

      const token = generateToken(user.id);

      res.json({
        success: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          name: user.name,
          subscription: user.subscription,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// @route   GET /api/auth/me
// @desc    Get current user
// @access  Private
router.get("/me", authenticate, async (req, res) => {
  try {
    res.json({
      success: true,
      user: req.user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// @route   GET /api/auth/check-username/:username
// @desc    Check if username is available
// @access  Public
router.get("/check-username/:username", async (req, res) => {
  try {
    const { username } = req.params;

    if (!username || username.trim().length === 0) {
      return res.status(400).json({
        success: false,
        available: false,
        message: "아이디를 입력해주세요.",
      });
    }

    // 아이디 형식 검증
    const usernameRegex = /^[a-zA-Z][a-zA-Z0-9]*$/;
    if (username.length < 4) {
      return res.status(400).json({
        success: false,
        available: false,
        message: "아이디는 4자 이상이어야 합니다.",
      });
    }
    if (!usernameRegex.test(username)) {
      return res.status(400).json({
        success: false,
        available: false,
        message: "아이디는 영문으로 시작하며 영문 또는 영문+숫자 조합이어야 합니다.",
      });
    }

    // 중복 체크
    const existingUser = await User.findByUsername(username);

    if (existingUser) {
      return res.json({
        success: true,
        available: false,
        message: "이미 사용 중인 아이디입니다.",
      });
    }

    res.json({
      success: true,
      available: true,
      message: "사용 가능한 아이디입니다.",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      available: false,
      message: "아이디 확인 중 오류가 발생했습니다.",
    });
  }
});

// @route   POST /api/auth/google
// @desc    Google OAuth login
// @access  Public
router.post("/google", async (req, res) => {
  try {
    // TODO: Implement Google OAuth verification
    // const { idToken } = req.body;
    // Verify Google token and create/find user

    res.status(501).json({
      success: false,
      message: "Google OAuth not implemented yet",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// @route   POST /api/auth/apple
// @desc    Apple OAuth login
// @access  Public
router.post("/apple", async (req, res) => {
  try {
    // TODO: Implement Apple OAuth verification

    res.status(501).json({
      success: false,
      message: "Apple OAuth not implemented yet",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// @route   POST /api/auth/find-username/send-code
// @desc    아이디 찾기용 인증 코드 발송
// @access  Public
router.post(
  "/find-username/send-code",
  findUsernameLimiter,
  [body("email").isEmail().normalizeEmail()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const { email } = req.body;

      // 보안: 이메일 존재 여부를 노출하지 않음
      // 이메일이 존재하는지 확인 (실제로는 항상 성공 메시지 반환)
      const user = await User.findByEmail(email);

      if (user) {
        // 인증 코드 생성 및 저장
        const code = AuthCodeManager.generateCode();
        await AuthCodeManager.saveCode(email, code, 10); // 10분 만료

        // 이메일 발송
        await emailService.sendVerificationCode(email, code);
      }

      // 보안: 이메일 존재 여부와 관계없이 동일한 응답
      res.json({
        success: true,
        message: "인증 코드가 발송되었습니다.",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "인증 코드 발송에 실패했습니다.",
      });
    }
  }
);

// @route   POST /api/auth/find-username/verify-code
// @desc    인증 코드 검증 및 아이디 반환
// @access  Public
router.post(
  "/find-username/verify-code",
  [body("email").isEmail().normalizeEmail(), body("code").isLength({ min: 6, max: 6 }).isNumeric()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const { email, code } = req.body;

      // 인증 코드 검증
      const verification = await AuthCodeManager.verifyAndMarkCode(email, code);

      if (!verification.valid) {
        return res.status(400).json({
          success: false,
          message: verification.message,
        });
      }

      // 사용자 조회
      const user = await User.findByEmail(email);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "사용자를 찾을 수 없습니다.",
        });
      }

      // 아이디 반환 (일부 마스킹)
      const username = user.username;
      const maskedUsername = username.length > 2
        ? username.substring(0, 2) + "*".repeat(username.length - 2)
        : "*".repeat(username.length);

      res.json({
        success: true,
        username: maskedUsername,
        fullUsername: username, // 개발 환경에서만 전체 반환
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "인증 코드 검증에 실패했습니다.",
      });
    }
  }
);

// @route   POST /api/auth/reset-password/request
// @desc    비밀번호 재설정 요청 (토큰 발송)
// @access  Public
router.post(
  "/reset-password/request",
  resetPasswordLimiter,
  [
    body("username").optional().trim(),
    body("email").optional().isEmail().normalizeEmail(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const { username, email } = req.body;

      if (!username && !email) {
        return res.status(400).json({
          success: false,
          message: "아이디 또는 이메일을 입력해주세요.",
        });
      }

      // 사용자 조회
      let user = null;
      if (username) {
        user = await User.findByUsername(username);
      } else if (email) {
        user = await User.findByEmail(email);
      }

      // 보안: 사용자 존재 여부와 관계없이 동일한 응답
      if (user) {
        // 재설정 토큰 생성 및 저장
        const token = ResetTokenManager.generateToken();
        await ResetTokenManager.saveToken(user.id, token, 1); // 1시간 만료

        // 이메일 발송
        await emailService.sendPasswordResetLink(user.email, token);
      }

      res.json({
        success: true,
        message: "비밀번호 재설정 링크가 이메일로 발송되었습니다.",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "비밀번호 재설정 요청에 실패했습니다.",
      });
    }
  }
);

// @route   POST /api/auth/reset-password/confirm
// @desc    비밀번호 재설정 확인 (토큰 검증 및 비밀번호 변경)
// @access  Public
router.post(
  "/reset-password/confirm",
  [
    body("token").exists().withMessage("토큰이 필요합니다."),
    body("password").isLength({ min: 6 }).withMessage("비밀번호는 최소 6자 이상이어야 합니다."),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const { token, password } = req.body;

      // 토큰 검증 및 사용자 ID 조회
      const verification = await ResetTokenManager.verifyTokenAndGetUserId(token);

      if (!verification.valid) {
        return res.status(400).json({
          success: false,
          message: verification.message,
        });
      }

      // 비밀번호 해시
      const bcrypt = await import("bcryptjs");
      const hashedPassword = await bcrypt.default.hash(password, 10);

      // 비밀번호 업데이트
      await User.update(verification.userId, { password: hashedPassword });

      res.json({
        success: true,
        message: "비밀번호가 성공적으로 변경되었습니다.",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "비밀번호 재설정에 실패했습니다.",
      });
    }
  }
);

export default router;
