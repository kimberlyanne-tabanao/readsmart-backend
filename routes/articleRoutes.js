const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const router = express.Router();

router.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "Article route is working",
  });
});

router.post("/summarize-link", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.json({
        success: false,
        message: "Please enter an article link.",
      });
    }

    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
      timeout: 15000,
    });

    const $ = cheerio.load(response.data);

    let articleText = "";

    $("p").each((i, el) => {
      articleText += $(el).text() + " ";
    });

    if (articleText.length < 100) {
      return res.json({
        success: false,
        message: "This website blocks automatic reading. Try another link.",
      });
    }

    const sentences = articleText
      .split(".")
      .map((s) => s.trim())
      .filter((s) => s.length > 40);

    const summary = sentences.slice(0, 5).join(". ") + ".";

    res.json({
      success: true,
      summary,
    });
  } catch (error) {
    res.json({
      success: false,
      message: "This website cannot be summarized automatically. Try another link.",
    });
  }
});

module.exports = router;