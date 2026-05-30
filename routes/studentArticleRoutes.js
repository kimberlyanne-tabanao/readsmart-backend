const express = require("express");
const router = express.Router();
const StudentArticle = require("../models/StudentArticle");

function generateSummary(text) {
  const sentences = text
    .split(".")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sentences.length === 0) return "No summary generated.";

  return sentences.slice(0, 2).join(". ") + ".";
}

function getImportantDetails(text) {
  const sentences = text
    .split(".")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return sentences.slice(0, 5);
}

router.post("/", async (req, res) => {
  try {
    const { studentName, articleText } = req.body;

    const summary = generateSummary(articleText);
    const importantDetails = getImportantDetails(articleText);

    const savedArticle = await StudentArticle.create({
      studentName,
      articleText,
      summary,
      importantDetails,
    });

    res.json(savedArticle);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const articles = await StudentArticle.find().sort({ createdAt: -1 });
    res.json(articles);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;