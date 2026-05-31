require("dotenv").config();

const axios = require("axios");
const cheerio = require("cheerio");
const multer = require("multer");
const pdfParse = require("pdf-parse");

const express = require("express");
const cors = require("cors");
const Groq = require("groq-sdk");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = process.env.PORT || 5050;

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || "READSMART_SECRET";

console.log("Groq API Key Loaded:", !!GROQ_API_KEY);
console.log("Groq Model:", GROQ_MODEL);
console.log("MongoDB URI Loaded:", !!MONGODB_URI);

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("MongoDB connected successfully"))
  .catch((error) => console.log("MongoDB connection error:", error.message));

const groq = new Groq({ apiKey: GROQ_API_KEY });

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true },
    age: { type: String, default: "" },
    strand: { type: String, default: "" },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["student", "admin"], default: "student" },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    scores: {
      reading: { type: Number, default: 0 },
      quizzes: { type: Number, default: 0 },
      writing: { type: Number, default: 0 },
      summaries: { type: Number, default: 0 },
    },
    achievements: [
      {
        title: String,
        description: String,
        points: Number,
        badge: String,
        earnedAt: { type: Date, default: Date.now },
      },
    ],
    history: [
      {
        title: String,
        type: String,
        summary: String,
        link: String,
        date: { type: Date, default: Date.now },
      },
    ],
    favorites: [
      {
        title: String,
        link: String,
        summary: String,
        date: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

const generateToken = (user) =>
  jwt.sign({ id: user._id, email: user.email, role: user.role }, JWT_SECRET, {
    expiresIn: "7d",
  });

const sanitizeUser = (user) => {
  const obj = user.toObject ? user.toObject() : user;
  delete obj.password;
  return obj;
};

const buildAchievements = (user) => {
  const existingTitles = new Set(
    (user.achievements || []).map((achievement) => achievement.title)
  );

  const newAchievements = [];

  const addAchievement = (title, description, points, badge) => {
    if (!existingTitles.has(title)) {
      newAchievements.push({
        title,
        description,
        points,
        badge,
        earnedAt: new Date(),
      });
    }
  };

  if ((user.xp || 0) >= 100) addAchievement("100 XP Milestone", "Earned at least 100 XP.", 100, "⭐");
  if ((user.level || 1) >= 2) addAchievement("Level Up", "Reached Level 2.", 150, "🏅");
  if ((user.scores?.summaries || 0) >= 1) addAchievement("First Summary", "Generated first summary.", 50, "📝");
  if ((user.scores?.reading || 0) >= 1) addAchievement("First Reading", "Completed first reading.", 50, "📘");
  if ((user.scores?.quizzes || 0) >= 50) addAchievement("Quiz Achiever", "Reached 50 quiz points.", 75, "🧠");
  if ((user.scores?.writing || 0) >= 1) addAchievement("Writing Starter", "Completed first writing.", 50, "✍️");

  return newAchievements;
};

app.get("/", (req, res) => {
  res.json({
    message: "READSMART backend is running with Groq + Llama + MongoDB.",
    groq: GROQ_API_KEY ? "API key loaded" : "API key missing",
    mongodb: MONGODB_URI ? "MongoDB URI loaded" : "MongoDB URI missing",
    model: GROQ_MODEL,
  });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { fullName, age, strand, email, password, role } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({ message: "Full name, email, and password are required." });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existingUser = await User.findOne({ email: cleanEmail });

    if (existingUser) {
      return res.status(400).json({ message: "This email already has an account." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      fullName: fullName.trim(),
      age: age || "",
      strand: strand || "",
      email: cleanEmail,
      password: hashedPassword,
      role: role === "admin" ? "admin" : "student",
    });

    return res.status(201).json({
      message: "Account created successfully.",
      token: generateToken(newUser),
      user: sanitizeUser(newUser),
    });
  } catch (error) {
    console.log("REGISTER ERROR:", error);
    return res.status(500).json({ message: "Registration failed.", details: error.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() });

    if (!user) return res.status(401).json({ message: "Invalid email or password." });

    if (role && user.role !== role) {
      return res.status(403).json({ message: "Invalid role for this account." });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) return res.status(401).json({ message: "Invalid email or password." });

    return res.json({
      message: "Login successful.",
      token: generateToken(user),
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.log("LOGIN ERROR:", error);
    return res.status(500).json({ message: "Login failed.", details: error.message });
  }
});

app.post("/api/progress/update", async (req, res) => {
  try {
    const { email, activityType, score = 0, historyItem } = req.body;

    if (!email || !activityType) {
      return res.status(400).json({ message: "Email and activity type are required." });
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() });

    if (!user) return res.status(404).json({ message: "Student not found." });

    if (activityType === "reading") {
      user.scores.reading += 1;
      user.xp += 20;
    }

    if (activityType === "summary") {
      user.scores.summaries += 1;
      user.xp += 15;
    }

    if (activityType === "quiz") {
      user.scores.quizzes += Number(score) || 0;
      user.xp += 30;
    }

    if (activityType === "writing") {
      user.scores.writing += Number(score) || 1;
      user.xp += 25;
    }

    user.level = Math.floor(user.xp / 100) + 1;

    if (historyItem) {
      user.history.unshift({
        title: historyItem.title || "Learning Activity",
        type: historyItem.type || activityType,
        summary: historyItem.summary || "",
        link: historyItem.link || "",
      });
    }

    const newAchievements = buildAchievements(user);
    if (newAchievements.length > 0) user.achievements.push(...newAchievements);

    await user.save();

    return res.json({
      message: "Progress updated successfully.",
      user: sanitizeUser(user),
      newAchievements,
    });
  } catch (error) {
    console.log("PROGRESS UPDATE ERROR:", error);
    return res.status(500).json({ message: "Progress update failed.", details: error.message });
  }
});

app.get("/api/students", async (req, res) => {
  try {
    const students = await User.find({ role: "student" })
      .select("-password")
      .sort({ createdAt: -1 });

    return res.json({ students });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch students.", details: error.message });
  }
});

app.get("/api/students/:email", async (req, res) => {
  try {
    const student = await User.findOne({
      email: req.params.email.toLowerCase(),
      role: "student",
    }).select("-password");

    if (!student) return res.status(404).json({ message: "Student not found." });

    return res.json({ student });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch student.", details: error.message });
  }
});

app.post("/api/ai/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Message is required." });
    }

    if (!GROQ_API_KEY) {
      return res.status(500).json({ error: "Groq API key is missing." });
    }

    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are READSMART Chatbot, a helpful academic assistant for Senior High School STEM students. Answer clearly, naturally, and specifically. Keep answers concise but useful.",
        },
        { role: "user", content: message },
      ],
      temperature: 0.7,
      max_tokens: 350,
    });

    return res.json({
      reply: completion.choices[0].message.content,
      mode: "groq-llama",
    });
  } catch (error) {
    console.log("GROQ CHAT ERROR:", error);
    return res.status(500).json({ error: "Groq chat failed.", details: error.message });
  }
});

const extractArticleFromUrl = async (url) => {
  const page = await axios.get(url, {
    timeout: 15000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  const $ = cheerio.load(page.data);

  $("script, style, nav, footer, header, aside, noscript").remove();

  const title =
    $("title").first().text().trim() ||
    $("h1").first().text().trim() ||
    "Article from URL";

  const articleText = $("p")
    .map((i, el) => $(el).text())
    .get()
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    title,
    articleText,
  };
};

const summarizeWithGroq = async (articleText, sourceType, title = "") => {
  if (!articleText || articleText.trim().length < 50) {
    throw new Error(
      "No readable content found. Try another link, another PDF, or paste the article text manually."
    );
  }

  const safeText = articleText.slice(0, 12000);

  const completion = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are READSMART AI Academic Summary Assistant. Explain articles clearly for Senior High School STEM students.",
      },
      {
        role: "user",
        content: `Analyze this learning material.

Source Type: ${sourceType}
Title: ${title || "Not provided"}

Provide:
1. Short Summary
2. Student-Friendly Explanation
3. Main Idea
4. Important Details
5. Important Vocabulary with simple meanings
6. Reading Difficulty
7. Study Notes
8. One Quiz Question with Answer

Content:
${safeText}`,
      },
    ],
    temperature: 0.5,
    max_tokens: 1200,
  });

  return completion.choices[0].message.content;
};

app.post("/api/ai/summary", upload.single("pdf"), async (req, res) => {
  try {
    const { text, url } = req.body;

    let articleText = "";
    let sourceType = "Text";
    let title = "";

    if (req.file) {
      sourceType = "PDF Upload";
      title = req.file.originalname || "Uploaded PDF";

      const pdfData = await pdfParse(req.file.buffer);
      articleText = pdfData.text || "";
    } else if (url && url.trim()) {
      sourceType = "Article URL";

      const extracted = await extractArticleFromUrl(url.trim());
      title = extracted.title;
      articleText = extracted.articleText;
    } else if (text && text.trim()) {
      sourceType = "Pasted Text";
      title = "Pasted Article Text";
      articleText = text.trim();
    }

    if (!articleText || articleText.trim().length < 50) {
      return res.status(400).json({
        error:
          "No readable article content found. Paste article text, upload a readable PDF, or use another article URL.",
      });
    }

    const summary = await summarizeWithGroq(articleText, sourceType, title);

    return res.json({
      summary,
      title,
      sourceType,
      extractedLength: articleText.length,
      preview: articleText.slice(0, 500),
      mode: "groq-llama",
    });
  } catch (error) {
    console.log("SUMMARY ERROR:", error);

    return res.status(500).json({
      error:
        "Failed to summarize this material. Try another link, another PDF, or paste the article text manually.",
      details: error.message,
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`READSMART backend running at http://0.0.0.0:${PORT}`);
});