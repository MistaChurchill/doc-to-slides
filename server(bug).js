const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const bodyParser = require("body-parser");
const { authenticate } = require("@google-cloud/local-auth");
const { google } = require("googleapis");
const path = require("path");

const app = express();
const upload = multer({ dest: "uploads/" });
const PORT = 4000;
app.use(bodyParser.json());
app.use(cors());

// ✅ Google OAuth scopes
const SCOPES = ["https://www.googleapis.com/auth/presentations", "https://www.googleapis.com/auth/drive.file"];

// --- File extraction ---
async function extractFileContent(filePath, originalName) {
  const ext = originalName.split(".").pop().toLowerCase();

  if (ext === "txt") return fs.readFileSync(filePath, "utf8");
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

// --- Upload route ---
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const filePath = req.file.path;
    const fileName = req.file.originalname;

    // 1. Extract content
    const fileContent = await extractFileContent(filePath, fileName);
    fs.unlinkSync(filePath);

    if (!fileContent) throw new Error("Could not extract content from file");

    // 2. Authenticate with Google
    // ✅ Use service account instead of local-auth
    const auth = new google.auth.GoogleAuth({
      keyFile: path.join(__dirname, "credentials.json"), // your service account key
      scopes: SCOPES,
    });
     //Initialize APIs
    const authClient = await auth.getClient();
    const driveApi = google.drive({ version: "v3", auth: authClient });
    const slidesApi = google.slides({ version: "v1", auth: authClient });

    // 🔑 Replace with the folder you shared with the service account
    const folderId = "1YtppjBO9fUdir8i3WG2DlS8ctEwTfPD6";

    // 3. Create a new Slides presentation inside that folder
    const file = await driveApi.files.create({
      requestBody: {
        name: "Generated Slides",
        mimeType: "application/vnd.google-apps.presentation",
        parents: [folderId],
      },
      fields: "id",
    });

    console.log(`Created presentation: https://docs.google.com/presentation/d/${file.data.id}`);
    const presentationId = file.data.id;

    // 4. Split text into slides (simple split, refine later)
    const slideTexts = fileContent.split(/\n\s*\n/);

// 5. For each chunk, create a slide + insert text
    for (let i = 0; i < slideTexts.length; i++) {
      // (a) Create slide
      const createResponse = await slidesApi.presentations.batchUpdate({
        presentationId,
        requestBody: {
          requests: [
            {
              createSlide: {
                slideLayoutReference: { predefinedLayout: "TITLE_AND_BODY" },
              },
            },
          ],
        },
      });

      // Get the new slideId
      const slideId =
        createResponse.data.replies[0].createSlide.objectId;

      // (b) Fetch slide elements (to find TITLE & BODY placeholders)
      const presentation = await slidesApi.presentations.get({
        presentationId,
      });
      const slide = presentation.data.slides.find((s) => s.objectId === slideId);

      let titleId = null;
      let bodyId = null;

      slide.pageElements.forEach((el) => {
        if (el.shape?.placeholder?.type === "TITLE") {
          titleId = el.objectId;
        }
        if (el.shape?.placeholder?.type === "BODY") {
          bodyId = el.objectId;
        }
      });

      // (c) Insert text into title and body
      let requests = [];
      if (titleId) {
        requests.push({
          insertText: {
            objectId: titleId,
            insertionIndex: 0,
            text: `Slide ${i + 1}`,
          },
        });
      }
      if (bodyId) {
        requests.push({
          insertText: {
            objectId: bodyId,
            insertionIndex: 0,
            text: slideTexts[i],
          },
        });
      }

      // 6 Batch update to insert text
      if (requests.length > 0) {
        await slidesApi.presentations.batchUpdate({
          presentationId,
          requestBody: { requests },
        });
      }
    }

    // 7. Return link
    res.json({
      message: "Slides created successfully",
      link: `https://docs.google.com/presentation/d/${presentationId}/edit`,
    });
  } catch (err) {
    console.error("❌ FULL ERROR:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || "Unknown error" });
    }
  }

});

app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);
