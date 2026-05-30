const mongoose = require("mongoose");

const studentArticleSchema = new mongoose.Schema(
  {
    studentName: String,
    articleText: String,
    summary: String,
    importantDetails: [String],
  },
  { timestamps: true }
);

module.exports = mongoose.model("StudentArticle", studentArticleSchema);