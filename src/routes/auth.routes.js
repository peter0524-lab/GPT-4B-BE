import express from "express";
import { body, validationResult } from "express-validator";
import User from "../models/User.model.js";
import { generateToken } from "../utils/jwt.js";
import { authenticate } from "../middleware/auth.middleware.js";

const router = express.Router();

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post(
  "/register",
  [
    body("username")
      .trim()
      .isLength({ min: 3 })
      .withMessage("Username must be at least 3 characters long"),
    body("email").isEmail().normalizeEmail(),
    body("password").isLength({ min: 6 }),
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
          message: "Email already exists",
        });
      }

      // Check if username already exists
      const existingUsername = await User.findByUsername(username);
      if (existingUsername) {
        return res.status(400).json({
          success: false,
          message: "Username already exists",
        });
      }

      // Hash password
      const bcrypt = await import("bcryptjs");
      const hashedPassword = await bcrypt.default.hash(password, 10);

      // Create user
      const user = await User.create({
        email,
        username,
        password: hashedPassword,
        name: name || username,
        phone,
        company,
        position,
      });

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
      res.status(500).json({
        success: false,
        message: error.message,
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

export default router;
