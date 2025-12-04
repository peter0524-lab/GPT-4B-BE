import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";

// Routes
import authRoutes from "./routes/auth.routes.js";
import cardRoutes from "./routes/card.routes.js";
import ocrRoutes from "./routes/ocr.routes.js";
import giftRoutes from "./routes/gift.routes.js";
import calendarRoutes from "./routes/calendar.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import userRoutes from "./routes/user.routes.js";

// Middleware
import { errorHandler } from "./middleware/errorHandler.js";
import { notFound } from "./middleware/notFound.js";

// Database
import { testConnection, createTables } from "./config/database.js";

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(
  cors({
    origin: [
      process.env.FRONTEND_URL,
      "http://localhost:5173",
      "http://localhost:3000",
    ].filter(Boolean), // 유효한 값만 필터링
    credentials: true,
  })
);
app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "GPT-4b Backend API is running" });
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/cards", cardRoutes);
app.use("/api/ocr", ocrRoutes);
app.use("/api/gifts", giftRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/users", userRoutes);

// Error handling
app.use(notFound);
app.use(errorHandler);

// Database connection and initialization
const initializeDatabase = async () => {
  const isConnected = await testConnection();
  if (!isConnected) {
    console.error("❌ Failed to connect to database");
    process.exit(1);
  }

  // Create tables if they don't exist
  await createTables();

  // Start server
  app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
    console.log(`📝 Environment: ${process.env.NODE_ENV || "development"}`);
  });
};

initializeDatabase().catch((error) => {
  console.error("❌ Database initialization error:", error);
  process.exit(1);
});

export default app;
