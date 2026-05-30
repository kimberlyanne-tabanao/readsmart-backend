require("dotenv").config();

const express = require("express");
const cors = require("cors");
const Groq = require("groq-sdk");

const app = express();
const PORT = process.env.PORT || 5050;

app.use(cors());
app.use(express.json());

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

console.log("Groq API Key Loaded:", !!GROQ_API_KEY);
console.log("Groq Model:", GROQ_MODEL);

const groq = new Groq({
  apiKey: GROQ_API_KEY,
});

app.get("/", (req, res) => {
  res.json({
    message: "READSMART backend is running with Groq + Llama.",
    groq: GROQ_API_KEY ? "API key loaded" : "API key missing",
    model: GROQ_MODEL,
  });
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
        error: "Groq API key is missing in .env file.",
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
  console.log(`READSMART Groq backend running at http://0.0.0.0:${PORT}`);
});