require("dotenv").config();

const axios = require("axios");
const cheerio = require("cheerio");
const express = require("express");
const cors = require("cors");
const Groq = require("groq-sdk");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = process.env.PORT || 5050;

app.use(cors());
app.use(express.json());

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

const groq = new Groq({
  apiKey: GROQ_API_KEY,
});

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
        earnedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    history: [
      {
        title: String,
        type: String,
        summary: String,
        link: String,
        date: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    favorites: [
      {
        title: String,
        link: String,
        summary: String,
        date: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
};

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

app.post("/api/ai/summary", async (req, res) => {
  try {
    const { text, url } = req.body;

    let articleText = text || "";

    if (url && url.trim()) {
      const page = await axios.get(url.trim(), {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      const $ = cheerio.load(page.data);

      $("script").remove();
      $("style").remove();
      $("nav").remove();
      $("header").remove();
      $("footer").remove();
      $("aside").remove();

      articleText = $("p")
        .map((i, el) => $(el).text())
        .get()
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    }

    if (!articleText || articleText.length < 50) {
      return res.status(400).json({
        error:
          "Unable to extract article text. Try another article link or paste the article manually.",
      });
    }

    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        {
          role: "system",
          content: `
You are READSMART Academic Assistant.

When given an article, provide:

1. Article Title (if identifiable)
2. Short Summary
3. Student-Friendly Explanation
4. Main Idea
5. Important Details
6. Key Vocabulary and Meanings
7. Reading Difficulty
8. Study Notes
9. One Quiz Question and Answer

Explain clearly for Senior High School STEM students.
`,
        },
        {
          role: "user",
          content: articleText,
        },
      ],
      temperature: 0.5,
      max_tokens: 1200,
    });

    res.json({
      summary: completion.choices[0].message.content,
      mode: "groq-llama",
      extractedLength: articleText.length,
    });
  } catch (error) {
    console.log("SUMMARY ERROR:", error);

    res.status(500).json({
      error: "Failed to summarize article.",
      details: error.message,
    });
  }
});

app.get("/api/students", async (req, res) => {
  try {
    const students = await User.find({ role: "student" })
      .select("-password")
      .sort({ createdAt: -1 });

    return res.json({
      students,
    });
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

    return res.json({
      student,
    });
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
      max_tokens: 350,
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

app.post("/api/ai/summary", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({
        error: "Text is required.",
      });
    }

    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are READSMART AI Summary Assistant. Create clear academic summaries for Senior High School students.",
        },
        {
          role: "user",
          content: `Summarize this text. Include:
1. Summary
2. Main idea
3. Important details
4. Vocabulary
5. Reading level
6. One quiz question

Text:
${text}`,
        },
      ],
      temperature: 0.5,
      max_tokens: 700,
    });

    return res.json({
      summary: completion.choices[0].message.content,
      mode: "groq-llama",
    });
  } catch (error) {
    console.log("GROQ SUMMARY ERROR:", error);

    return res.status(500).json({
      error: "Groq summary failed.",
      details: error.message,
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`READSMART backend running at http://0.0.0.0:${PORT}`);
});