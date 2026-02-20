const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs").promises;
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const bodyParser = require("body-parser");
const { google } = require("googleapis");
const path = require("path");
const open = require("open");

const app = express();
const upload = multer({ dest: "uploads/" });
const PORT = 3000;
app.use(bodyParser.json());
app.use(cors());

// --- Google OAuth configuration ---
const SCOPES = ["https://www.googleapis.com/auth/presentations", "https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/drive"];
const TOKEN_PATH = path.join(process.cwd(), "token.json");
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");

let oAuth2Client;

// --- Initialize Gemini API ---
require("dotenv").config();
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const API_KEY = process.env.GEMINI_API_KEY;

// --- Load client secrets and handle authentication ---
async function authorize() {
  const credentials = await fs.readFile(CREDENTIALS_PATH);
  const { client_secret, client_id, redirect_uris } = JSON.parse(credentials).web;
  oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  try {
    const token = await fs.readFile(TOKEN_PATH);
    oAuth2Client.setCredentials(JSON.parse(token));
  } catch (err) {
    console.log("No token found, starting authorization flow.");
    await getNewToken(oAuth2Client);
  }
  return oAuth2Client;
}

// --- Get a new token if one is not available ---
async function getNewToken(client) {
  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });
  console.log("Authorize this app by visiting this url:", authUrl);
  open(authUrl);
}

// --- Route to handle the redirect from Google for OAuth ---
app.get("/oauth2callback", async (req, res) => {
  const code = req.query.code;
  if (!code) {
    res.status(400).send("Authorization code not found.");
    return;
  }
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
    console.log("Authorization successful! Tokens saved to token.json");
    res.send("Authorization successful! You can close this window now.");
  } catch (err) {
    console.error("Error retrieving access token", err);
    res.status(500).send("Error during authorization.");
  }
});

// --- File extraction ---
async function extractFileContent(filePath, originalName) {
  const ext = originalName.split(".").pop().toLowerCase();
  if (ext === "txt") return fs.readFile(filePath, "utf8");
  if (ext === "docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }
  if (ext === "pdf") {
    const dataBuffer = await fs.readFile(filePath);
    const result = await pdfParse(dataBuffer);
    return result.text;
  }
  throw new Error("Unsupported file type: " + ext);
}

// --- Cleaning function to remove Gemini's intro/outro texts ---
function cleanGeminiResponse(text) {
  if (!text) return "";
  return text
    .replace(/^Here is.*?:/i, "")
    .replace(/```(?:\w+)?/g, "")
    .trim();
}

// --- New text-to-slide processing function ---
function processTextForSlides(text) {
  if (!text) return [];

  const slides = [];
  const sections = text.split(/(?:Slide\s*\d+:|^)(?=\s*[A-Z])/im); 
  // split by "Slide X:" OR by a new section starting with uppercase

  sections.forEach((section, index) => {
    const lines = section
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean);

    if (lines.length === 0) return;

    // First non-empty line becomes title
    const title = lines.shift();

    slides.push({
      title: title.replace(/^(Title:|Heading:)/i, "").trim(),
      body: lines.map(l => l.replace(/^[-*•]\s*/, "").trim()) // cleanup bullets
    });
  });

  return slides;
}

// --- Upload route ---
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const filePath = req.file.path;
    const fileName = req.file.originalname;

    // 1. Extract content from the uploaded file
    const fileContent = await extractFileContent(filePath, fileName);
    await fs.unlink(filePath);

    if (!fileContent) {
      throw new Error("Could not extract content from file");
    }

    // 2. Send content to Gemini for formatting
    const geminiResponse = await fetch(`${GEMINI_URL}?key=${API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [{
              text: `Break the following text into a presentation outline with:
                - A title slide with a title and subtitle
                - A heading for each main point
                - 3–5 concise bullet points per slide
                Use the format "Slide X: [Title]" for each slide.
                Text:
                ${fileContent}`,
            }],
          },
        ],
      }),
    });

    const geminiData = await geminiResponse.json();
    const cleanedText = cleanGeminiResponse(
      geminiData.candidates?.[0]?.content?.parts?.[0]?.text ||
      geminiData.error?.message ||
      "No content generated"
    );

    // 3. Process the cleaned text into a structured slide array
    const slides = processTextForSlides(cleanedText);

    // 4. Authenticate and initialize Google APIs
    const authClient = await authorize();
    const driveApi = google.drive({ version: "v3", auth: authClient });
    const slidesApi = google.slides({ version: "v1", auth: authClient });

    // 🔑 Replace with the folder you want to create the presentation in
    const folderId = "1YtppjBO9fUdir8i3WG2DlS8ctEwTfPD6";

    // 5. Create a new Slides presentation
    const file = await driveApi.files.create({
      requestBody: {
        name: "Generated Slides",
        mimeType: "application/vnd.google-apps.presentation",
        parents: [folderId],
      },
      fields: "id",
    });
    const presentationId = file.data.id;
    console.log(`Created presentation: https://docs.google.com/presentation/d/${presentationId}`);

    // 6. Build the batchUpdate requests
    const requests = [];

    // Create an empty slide for each slideContent
    slides.forEach((slideContent, i) => {
      requests.push({
        createSlide: {
          slideLayoutReference: { predefinedLayout: "TITLE_AND_BODY" }
        }
      });

      // Insert title
      requests.push({
        insertText: {
          objectId: "TITLE", // placeholder
          text: slideContent.title,
          insertionIndex: 0
        }
      });

      // Insert body
      requests.push({
        insertText: {
          objectId: "BODY", // placeholder
          text: slideContent.body.join("\n"),
          insertionIndex: 0
        }
      });
    });

    // 7. Execute the batchUpdate to populate slides
    // Step 1: Create slides first
    const createRequests = slides.map(() => ({
      createSlide: {
        slideLayoutReference: { predefinedLayout: "TITLE_AND_BODY" }
      }
    }));

    const createResponse = await slidesApi.presentations.batchUpdate({
      presentationId,
      requestBody: { requests: createRequests }
    });

    // Step 2: Collect slide objectIds
    const slideObjectIds = createResponse.data.replies.map(r => r.createSlide.objectId);

    // Step 3: Get presentation details (to find placeholder IDs)
    const presentation = await slidesApi.presentations.get({ presentationId });

    const textRequests = [];

    slides.forEach((slideContent, i) => {
      const slideId = slideObjectIds[i];

      // Find placeholders inside this slide
      const slide = presentation.data.slides.find(s => s.objectId === slideId);
      if (!slide) return;

      let titleId, bodyId;
      slide.pageElements.forEach(el => {
        if (el.shape?.placeholder?.type === "TITLE") {
          titleId = el.objectId;
        }
        if (el.shape?.placeholder?.type === "BODY") {
          bodyId = el.objectId;
        }
      });

      if (titleId) {
        textRequests.push({
          insertText: {
            objectId: titleId,
            text: slideContent.title,
            insertionIndex: 0
          }
        });
      }

      if (bodyId) {
        textRequests.push({
          insertText: {
            objectId: bodyId,
            text: slideContent.body.join("\n"),
            insertionIndex: 0
          }
        });
      }
    });

    // Step 4: Apply text updates
    if (textRequests.length > 0) {
      await slidesApi.presentations.batchUpdate({
        presentationId,
        requestBody: { requests: textRequests }
      });
    }

    res.setHeader("Access-Control-Expose-Headers", "X-Cleaned-Text");
    res.setHeader("X-Cleaned-Text", encodeURIComponent(cleanedText));
    res.status(200).json({
      message: "Slides created successfully",
      link: `https://docs.google.com/presentation/d/${presentationId}/edit`,
    });
  } catch (err) {
    console.error("❌ FULL ERROR:", err);
    res.status(500).json({ error: err.message || "Unknown error" });
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));