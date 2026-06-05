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
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true },
    role: { type: String, enum: ["student", "admin"], default: "student" },
    lastLogin: {
  type: Date,
  default: null,
},

loginCount: {
  type: Number,
  default: 0,
},

registeredDevice: {
  type: String,
  default: "",
},

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
  jwt.sign(
    {
      id: user._id,
      email: user.email,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

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

  if ((user.xp || 0) >= 100) {
    addAchievement(
      "100 XP Milestone",
      "Earned at least 100 XP from learning activities.",
      100,
      "⭐"
    );
  }

  if ((user.level || 1) >= 2) {
    addAchievement(
      "Level Up",
      "Reached Level 2 by using READSMART learning tools.",
      150,
      "🏅"
    );
  }

  if ((user.scores?.summaries || 0) >= 1) {
    addAchievement(
      "First Summary",
      "Generated the first academic summary.",
      50,
      "📝"
    );
  }

  if ((user.scores?.reading || 0) >= 1) {
    addAchievement(
      "First Reading",
      "Completed the first reading activity.",
      50,
      "📘"
    );
  }

  if ((user.scores?.quizzes || 0) >= 50) {
    addAchievement(
      "Quiz Achiever",
      "Reached at least 50 quiz points.",
      75,
      "🧠"
    );
  }

  if ((user.scores?.writing || 0) >= 1) {
    addAchievement(
      "Writing Starter",
      "Completed the first writing activity.",
      50,
      "✍️"
    );
  }

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
      return res.status(400).json({
        message: "Full name, email, and password are required.",
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existingUser = await User.findOne({ email: cleanEmail });

    if (existingUser) {
      return res.status(400).json({
        message: "This email already has an account.",
      });
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

    return res.status(500).json({
      message: "Registration failed.",
      details: error.message,
    });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required.",
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      return res.status(401).json({
        message: "Invalid email or password.",
      });
    }

    if (role && user.role !== role) {
      return res.status(403).json({
        message: "Invalid role for this account.",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    

    if (!isMatch) {
      return res.status(401).json({
        message: "Invalid email or password.",
      });
    }

    user.lastLogin = new Date();
user.loginCount = (user.loginCount || 0) + 1;

await user.save();

    return res.json({
      message: "Login successful.",
      token: generateToken(user),
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.log("LOGIN ERROR:", error);

    return res.status(500).json({
      message: "Login failed.",
      details: error.message,
    });
  }
});

app.post("/api/progress/update", async (req, res) => {
  try {
    const { email, activityType, score = 0, historyItem } = req.body;

    if (!email || !activityType) {
      return res.status(400).json({
        message: "Email and activity type are required.",
      });
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() });

    if (!user) {
      return res.status(404).json({
        message: "Student not found.",
      });
    }

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

    if (newAchievements.length > 0) {
      user.achievements.push(...newAchievements);
    }

    await user.save();

    return res.json({
      message: "Progress updated successfully.",
      user: sanitizeUser(user),
      newAchievements,
    });
  } catch (error) {
    console.log("PROGRESS UPDATE ERROR:", error);

    return res.status(500).json({
      message: "Progress update failed.",
      details: error.message,
    });
  }
});

app.get("/api/students", async (req, res) => {
  try {
    const students = await User.find({ role: "student" })
      .select("-password")
      .sort({ createdAt: -1 });

    return res.json({ students });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch students.",
      details: error.message,
    });
  }
});

app.get("/api/students/:email", async (req, res) => {
  try {
    const student = await User.findOne({
      email: req.params.email.toLowerCase(),
      role: "student",
    }).select("-password");

    if (!student) {
      return res.status(404).json({
        message: "Student not found.",
      });
    }

    return res.json({ student });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch student.",
      details: error.message,
    });
  }
});

app.post("/api/ai/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({
        error: "Message is required.",
      });
    }

    if (!GROQ_API_KEY) {
      return res.status(500).json({
        error: "Groq API key is missing.",
      });
    }

    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are READSMART Chatbot, a helpful academic assistant for Senior High School STEM students. Answer clearly, naturally, and specifically. Keep answers concise but useful. Help with STEM, reading comprehension, vocabulary, summaries, essays, and study questions.",
        },
        {
          role: "user",
          content: message,
        },
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    return res.json({
      reply: completion.choices[0].message.content,
      mode: "groq-llama",
    });
  } catch (error) {
    console.log("GROQ CHAT ERROR:", error);

    return res.status(500).json({
      error: "Groq chat failed.",
      details: error.message,
    });
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
    $("meta[property='og:title']").attr("content") ||
    $("title").first().text().trim() ||
    $("h1").first().text().trim() ||
    "Article from URL";

  const description =
    $("meta[name='description']").attr("content") ||
    $("meta[property='og:description']").attr("content") ||
    "";

  const siteName =
    $("meta[property='og:site_name']").attr("content") ||
    new URL(url).hostname.replace("www.", "");

  const paragraphs = $("p")
    .map((i, el) => $(el).text())
    .get()
    .filter((paragraph) => paragraph.trim().length > 40);

  const articleText = paragraphs
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    title,
    description,
    siteName,
    sourceUrl: url,
    articleText,
  };
};

const summarizeWithGroq = async ({
  articleText,
  sourceType,
  title = "",
  description = "",
  siteName = "",
  sourceUrl = "",
}) => {
  if (!articleText || articleText.trim().length < 50) {
    throw new Error(
      "No readable content found. Try another link, another PDF, or paste the article text manually."
    );
  }

  const safeText = articleText.slice(0, 14000);
  const estimatedReadingTime = Math.max(1, Math.ceil(articleText.split(/\s+/).length / 200));

  const completion = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are READSMART AI Academic Research Assistant. Produce professional, structured, student-friendly academic article explanations for Senior High School STEM students. Do not invent citations. Use only the provided article text and source metadata. If facts, numbers, dates, or names are not present, say 'Not specified in the provided article.'",
      },
      {
        role: "user",
        content: `Analyze this learning material professionally.

SOURCE METADATA:
Source Type: ${sourceType}
Article Title: ${title || "Not specified"}
Website/Publisher: ${siteName || "Not specified"}
Source URL: ${sourceUrl || "Not provided"}
Description: ${description || "Not specified"}
Estimated Reading Time: ${estimatedReadingTime} minute(s)

REQUIRED OUTPUT FORMAT:

ARTICLE INFORMATION
- Title:
- Source/Publisher:
- Source Type:
- Reference URL:
- Estimated Reading Time:
- Suggested Subject Area:
- Difficulty Level:

EXECUTIVE SUMMARY
Write a polished 150–200 word summary.

DETAILED ARTICLE EXPLANATION
Explain the article clearly and professionally. Expand the important ideas for a student.

MAIN IDEA
State the central idea in 1–2 sentences.

IMPORTANT INFORMATION
List the most important facts, findings, dates, people, concepts, causes, effects, or processes found in the article.

KEY CONCEPTS
List and explain the key concepts.

STEM RELEVANCE
Explain how the article connects to Science, Technology, Engineering, or Mathematics.

REAL-WORLD APPLICATIONS
Explain how the topic is used or observed in real life.

CRITICAL ANALYSIS
- Strengths of the article:
- Limitations or missing information:
- Future implications:

IMPORTANT VOCABULARY
Provide important words from the article with simple meanings and example usage.

STUDY NOTES
Create short study notes that a student can review before a quiz.

DISCUSSION QUESTIONS
Give 3 discussion questions.

COMPREHENSION QUIZ

Generate 5 multiple-choice comprehension questions.

IMPORTANT RULES:
- Do NOT reveal the correct answer.
- Do NOT include "Answer:"
- Do NOT include "Correct Answer:"
- Each question must have choices A, B, C, and D.
- Questions must be based on the article.
- Questions should test reading comprehension and critical thinking.

Format:

Question 1:
A.
B.
C.
D.

Question 2:
A.
B.
C.
D.

Question 3:
A.
B.
C.
D.

Question 4:
A.
B.
C.
D.

Question 5:
A.
B.
C.
D.

REFERENCES
Only include the given source URL and publisher if provided. Do not invent fake references.

ARTICLE CONTENT:
${safeText}`,
      },
    ],
    temperature: 0.45,
    max_tokens: 1800,
  });

  return {
    summary: completion.choices[0].message.content,
    estimatedReadingTime,
  };
};

app.post("/api/ai/summary", upload.single("pdf"), async (req, res) => {
  try {
    const { text, url } = req.body;

    let articleText = "";
    let sourceType = "Pasted Text";
    let title = "Pasted Article Text";
    let description = "";
    let siteName = "READSMART User Input";
    let sourceUrl = "";

    if (req.file) {
      sourceType = "PDF Upload";
      title = req.file.originalname || "Uploaded PDF";
      siteName = "Uploaded Document";

      const pdfData = await pdfParse(req.file.buffer);
      articleText = pdfData.text || "";
    } else if (url && url.trim()) {
      sourceType = "Article URL";
      sourceUrl = url.trim();

      const extracted = await extractArticleFromUrl(sourceUrl);

      title = extracted.title;
      description = extracted.description;
      siteName = extracted.siteName;
      articleText = extracted.articleText;
    } else if (text && text.trim()) {
      sourceType = "Pasted Text";
      articleText = text.trim();
    }

    if (!articleText || articleText.trim().length < 50) {
      return res.status(400).json({
        error:
          "No readable article content found. Paste article text, upload a readable text-based PDF, or use another article URL.",
      });
    }

    const aiResult = await summarizeWithGroq({
      articleText,
      sourceType,
      title,
      description,
      siteName,
      sourceUrl,
    });

    return res.json({
      summary: aiResult.summary,
      title,
      sourceType,
      siteName,
      sourceUrl,
      description,
      estimatedReadingTime: aiResult.estimatedReadingTime,
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
app.get("/api/admin/students", async (req, res) => {
  try {
    const students = await User.find({
      role: "student",
    })
      .select("-password")
      .sort({ lastLogin: -1 });

    res.json(students);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch students",
      error: error.message,
    });
  }
});
app.get("/api/seed-admin", async (req, res) => {
  try {
    const existingAdmin = await User.findOne({
      email: "admin@readsmart.com",
    });

    if (existingAdmin) {
      return res.json({
        message: "Admin already exists.",
        email: "admin@readsmart.com",
        password: "admin123",
      });
    }

    const hashedPassword = await bcrypt.hash("admin123", 10);

    const admin = await User.create({
      fullName: "READSMART Administrator",
      age: "25",
      strand: "Administrator",
      email: "admin@readsmart.com",
      password: hashedPassword,
      role: "admin",
      xp: 0,
      level: 1,
    });

    res.json({
      message: "Admin account created successfully.",
      email: "admin@readsmart.com",
      password: "admin123",
      admin: sanitizeUser(admin),
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to create admin account.",
      error: error.message,
    });
  }
});
app.delete("/api/admin/students/:email", async (req, res) => {
  try {
    const email = req.params.email.trim().toLowerCase();

    const deletedStudent = await User.findOneAndDelete({
      email,
      role: "student",
    });

    if (!deletedStudent) {
      return res.status(404).json({
        message: "Student not found.",
      });
    }

    res.json({
      message: "Student deleted successfully.",
      student: sanitizeUser(deletedStudent),
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to delete student.",
      error: error.message,
    });
  }
});
app.listen(PORT, "0.0.0.0", () => {
  console.log(`READSMART backend running at http://0.0.0.0:${PORT}`);
});