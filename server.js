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

// Add these at the top with your other imports
const crypto = require("crypto");
const fetch = require('node-fetch'); // If not using built-in fetch
const session = require("express-session"); // You need a session middleware for PKCE

const app = express();
const upload = multer({ dest: "uploads/" });
const PORT = 3000;
app.use(bodyParser.json());
app.use(cors());

// Add this line after your other app.use() calls
app.use(session({
  secret: "a-very-secret-string", // A long, random string for signing the session cookie
  resave: false,
  saveUninitialized: true,
}));

// --- Google OAuth configuration ---
const SCOPES = ["https://www.googleapis.com/auth/presentations", "https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/drive"];
const TOKEN_PATH = path.join(process.cwd(), "token.json");
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");

let oAuth2Client;

// --- Initialize Gemini API ---
require("dotenv").config();
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const API_KEY = process.env.GEMINI_API_KEY;

// Add these with your other API keys and paths
const CANVA_CLIENT_ID = process.env.CANVA_CLIENT_ID;
const CANVA_CLIENT_SECRET = process.env.CANVA_CLIENT_SECRET;
const CANVA_REDIRECT_URI = process.env.CANVA_REDIRECT_URI; // Must match your dev portal setting

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

// A. Generate PKCE codes
function generatePkceCodes() {
  const codeVerifier = crypto.randomBytes(96).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return { codeVerifier, codeChallenge };
}

// B. Exchange authorization code for tokens
async function exchangeCodeForTokens(code, codeVerifier) {
  const tokenResponse = await fetch("https://api.canva.com/rest/v1/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${CANVA_CLIENT_ID}:${CANVA_CLIENT_SECRET}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      redirect_uri: CANVA_REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  });

  const data = await tokenResponse.json();
  if (data.error) {
    throw new Error(`Canva Token Exchange Error: ${data.error_description}`);
  }
  return data;
}

// C. Create a Canva design
async function createCanvaDesign(accessToken, slides) {
  const designRequests = slides.map(slide => ({
    type: "TEXT",
    text: slide.body.join("\n"),
    // Add logic to position text within the template
  }));

  const response = await fetch("https://api.canva.com/rest/v1/designs", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      design: {
        templateId: "PAB9r1dEa2I", // Replace with a valid presentation template ID
        pages: [{
          elements: designRequests,
        }],
      },
      export: {
        type: "PRESENTATION",
      },
    }),
  });

  const data = await response.json();
  if (data.error) {
    throw new Error(`Canva API Error: ${data.error_description}`);
  }
  return data;
}

// D
// Function to refresh the Canva access token
async function refreshCanvaToken(refreshToken) {
  const tokenResponse = await fetch("https://api.canva.com/rest/v1/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // Use Basic Authentication with your client ID and secret
      Authorization: `Basic ${Buffer.from(`${CANVA_CLIENT_ID}:${CANVA_CLIENT_SECRET}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token", // This is the key change!
      refresh_token: refreshToken,
    }),
  });

  const data = await tokenResponse.json();
  if (data.error) {
    throw new Error(`Canva Token Refresh Error: ${data.error_description}`);
  }
  return data;
}

// Canva Authorization endpoint
app.get("/auth/canva", (req, res) => {
  const { codeVerifier, codeChallenge } = generatePkceCodes();

  // Store the verifier in the session (you'll need to set up a session middleware)
  req.session.canvaCodeVerifier = codeVerifier;
  const authUrl = `https://www.canva.com/api/oauth/authorize?` +
    `response_type=code` +
    `&client_id=${CANVA_CLIENT_ID}` +
    `&redirect_uri=${CANVA_REDIRECT_URI}` +
    `&scope=user.info:read designs.manage` + // Set required scopes
    `&code_challenge_method=S256` +
    `&code_challenge=${codeChallenge}`;

  res.redirect(authUrl);
});

// Canva Callback endpoint
app.get("/canva/callback", async (req, res) => {
  const authCode = req.query.code;
  const codeVerifier = req.session.canvaCodeVerifier;

  if (!authCode || !codeVerifier) {
    return res.status(400).send("Authorization failed: Missing code or verifier.");
  }

  try {
    const data = await exchangeCodeForTokens(authCode, codeVerifier);

    // TODO: Store tokens securely in your database, associated with the user
    // Save the tokens and expiry to the user's session
    req.session.canva = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    console.log("Canva tokens received:", data);

    // Redirect to a success page or your frontend
    res.send("Canva authorization successful! You can now use the API.");
  } catch (error) {
    console.error("Token exchange failed:", error);
    res.status(500).send("Authorization failed.");
  }
});



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

// New route to handle file upload and Canva design creation
app.post("/upload-to-canva", upload.single("file"), async (req, res) => {
  try {
     // 1. Check if the user has a valid Canva token in their session
    const canvaSession = req.session.canva;
    if (!canvaSession || !canvaSession.accessToken) {
      // Respond with an error or redirect them to authorize
      return res.status(401).json({ error: "Canva not authorized. Please authorize first." });
    }

    // 2. Refresh the token if it's expired
    if (Date.now() >= canvaSession.expiresAt) {
      // This part is more advanced. You would use the refresh_token to get a new access_token.
      // This often involves another POST request to Canva's token endpoint with grant_type='refresh_token'
      console.log("Access token expired. Attempting to refresh...");
      // ... (Refresh token logic here) ...
       try {
        const refreshData = await refreshCanvaToken(canvaSession.refreshToken);

        // Update the session with the new tokens and expiry
        req.session.canva.accessToken = refreshData.access_token;
        req.session.canva.refreshToken = refreshData.refresh_token; // Canva issues a new refresh token
        req.session.canva.expiresAt = Date.now() + refreshData.expires_in * 1000;
        
        console.log("Tokens successfully refreshed and session updated.");
        // The rest of the code will now use the new accessToken
      } catch (refreshError) {
        console.error("Token refresh failed:", refreshError);
        // If refreshing fails, force the user to re-authorize
        return res.status(401).json({ error: "Authentication expired. Please re-authorize Canva." });
      }
    }

    const accessToken = canvaSession.accessToken;

    const filePath = req.file.path;
    const fileName = req.file.originalname;

    // 3. Extract content from the file (same as before)
    const fileContent = await extractFileContent(filePath, fileName);
    await fs.unlink(filePath);
    if (!fileContent) {
      throw new Error("Could not extract content from file");
    }

    // 4. Send to Gemini for formatting (same as before)
    const geminiResponse = await fetch(`${GEMINI_URL}?key=${API_KEY}`, { /* ... */ });
    const geminiData = await geminiResponse.json();
    const cleanedText = cleanGeminiResponse(geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "No content");
    const slides = processTextForSlides(cleanedText);

    // 3. Get the user's Canva access token (from your database)
    // const accessToken = "YOUR_STORED_CANVA_ACCESS_TOKEN"; // You must retrieve this from your database

    // 5. Create a new Canva design using the access token
    const canvaDesign = await createCanvaDesign(accessToken, slides);

    res.status(200).json({
      message: "Canva design created successfully",
      link: canvaDesign.edit_url,
    });
  } catch (err) {
    console.error("❌ FULL ERROR:", err);
    res.status(500).json({ error: err.message || "Unknown error" });
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));