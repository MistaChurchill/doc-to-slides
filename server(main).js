const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const bodyParser = require("body-parser");
const PPTXGenJS = require("pptxgenjs");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const upload = multer({ dest: "uploads/" });
const PORT = 3000;
app.use(bodyParser.json());
app.use(cors());


// ✅ Initialize Gemini
require("dotenv").config();
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const API_KEY = process.env.GEMINI_API_KEY;

async function extractFileContent(filePath, originalName) {
  const ext = originalName.split(".").pop().toLowerCase();

  if (ext === "txt") {
    return fs.readFileSync(filePath, "utf8");
  }
  if (ext === "docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }
  if (ext === "pdf") {
    const dataBuffer = fs.readFileSync(filePath);
    const result = await pdfParse(dataBuffer);
    return result.text;
  }

  throw new Error("Unsupported file type: " + ext);
}

// --- Cleaning function to remove Gemini's intro/outro texts ---
function cleanGeminiResponse(text) {
  if (!text) return "";
  return text
    .replace(/^Here is.*?:/i, "") // remove Gemini intros
    .replace(/```(?:\w+)?/g, "") // remove code fences
    .replace(/[*#>-]/g, "") // remove markdown symbols
    .trim();
}

// --- Route to upload and process document ---
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const filePath = req.file.path;
    const fileName = req.file.originalname;

    // Extract content
    const fileContent = await extractFileContent(filePath, fileName);
    fs.unlinkSync(filePath); // delete temp file

    if (!fileContent) {
      throw new Error("Could not extract content from file");
    }

      // Send to Gemini
    const response = await fetch(`${GEMINI_URL}?key=${API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                // text: `Convert this document into professional slides:\n\n${fileContent}`,
                // Ask Gemini to break down into slide-friendly content
                text: 
                `Break the following text into a presentation outline with:
                - A title slide
                - Headings for each main point
                - 3–5 concise bullet points per slide
                Text:
                ${fileContent}`,
              },
            ],
          },
        ],
      }),
    });



    const data = await response.json();
    const cleanedResponse = cleanGeminiResponse( data.candidates?.[0]?.content?.parts?.[0]?.text ||
        data.error?.message ||
        "No content generated");

    // --- Convert to PowerPoint ---
    const pptx = new PPTXGenJS();

    // Split slides by double newlines or "Slide X"
    const slides = cleanedResponse.split(/\n\s*\n|Slide \d+/i);

    slides.forEach((slideText) => {
      const slide = pptx.addSlide();
      const lines = slideText.split("\n").filter(Boolean);

      if (lines.length > 0) {
        // First line → title
        slide.addText(lines[0], { x: 1, y: 0.5, fontSize: 24, bold: true });

        if (lines.length > 1) {
          slide.addText(
            lines.slice(1).map((l) => ({ text: l, options: { bullet: true } })),
            { x: 1, y: 1.5, fontSize: 18 }
          );
        }
        
        // Rest → bullets
        // if (lines.length > 1) {
        //    const bulletPoints = lines.slice(1).map((line) => ({
        //     text: line.trim(),
        //     options: { fontSize: 18, color: "363636" },
        //   }));

        //   slide.addText(bulletPoints, {
        //     x: 1,
        //     y: 1.5,
        //     fontSize: 18,
        //     bullet: true,
        //   });
        // }
      }
    });

    // Generate buffer
    const buffer = await pptx.write("nodebuffer");

    // Expose header so frontend can read it
    res.setHeader("Access-Control-Expose-Headers", "X-Cleaned-Text");

    // Add cleaned text as a header (encode to avoid header issues)
    res.setHeader("X-Cleaned-Text", encodeURIComponent(cleanedResponse));

     // Send as download
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="slides.pptx"'
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    );
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error processing file");
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
