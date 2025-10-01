# Doc-to-Slides AI Generator

This project is an AI-powered document-to-presentation generator built with **Node.js/Express** and **React**. It uses the **Gemini API** to process text from uploaded files (DOCX, PDF, TXT) and structure it into a slide outline, then uses the **Google Slides API** or **Canva API** to automatically generate a presentation.

---

## 🚀 Project Setup (For Contributors)

To run this project locally and contribute, you need to set up several external API credentials.

### Prerequisites

* Node.js (v18+)
* npm or yarn
* A Google Cloud Project
* A Canva Developer Account

---

## 1. Local Installation

1.  **Clone the Repository:**
    ```bash
    git clone [YOUR_REPO_URL]
    cd doc-to-slides
    ```

2.  **Install Dependencies:**
    You must install dependencies for both the server and the client (frontend).

    ```bash
    # Install server dependencies (including express-session)
    npm install
    
    # Install client dependencies
    cd frontend
    npm install
    ```

3.  **Create Environment File (`.env`):**
    Create a file named **`.env`** in the root directory of the project and add the following keys.

    ```env
    # --- Gemini API Key ---
    GEMINI_API_KEY=""
    # will be sent on whatsapp group

    # --- Canva Credentials ---
    CANVA_CLIENT_ID=""
    CANVA_CLIENT_SECRET=""
    # NOTE: This MUST match the authorized redirect URI in the Canva Developer Portal exactly
    CANVA_REDIRECT_URI="http://localhost:3030/canva/callback"
    ```

---

## 2. API Credentials & Authentication

### 2.1. 🧠 Gemini API Key (skip)

1.  Go to **Google AI Studio** and generate an API key.
2.  Copy the key and paste it into the `GEMINI_API_KEY` field in your `.env` file.

### 2.2. 🖼️ Canva Developer Setup

1.  Go to the **Canva Developer Portal** and create a new app.
2.  Navigate to your app's **App Settings**.
3.  Under the **OAuth** section, set the **Authorized redirect URI** to:
    ```
    http://localhost:3030/canva/callback
    ```
4.  Copy the **Client ID** and **Client Secret** and add them to your `.env` file:
    * `CANVA_CLIENT_ID`
    * `CANVA_CLIENT_SECRET`
5.  Ensure the necessary **Scopes** are enabled for your app in the portal.
    asset - write
    brandtemplate:content - read
    brandtemplate:meta - read
    design:content - write
    design:meta - read
    profile - read

### 2.3. 🗃️ Google Slides API Setup

This project uses your personal Google account to create slides, requiring local credentials.

#### A. Download `credentials.json`

1.  Go to the **Google Cloud Console** and navigate to your project.
2.  Go to **APIs & Services > Credentials**.
3.  Click **"Create Credentials" > "OAuth client ID"**.
    * **Application type:** **Web application**.
    * **Authorized JavaScript origins:** `http://localhost:3030`
    * **Authorized redirect URIs:** `http://localhost:3030/oauth2callback`
4.  Download the JSON file and rename it to **`credentials.json`**.
5.  Place the **`credentials.json`** file in the **root directory** of your project.

#### B. Generate `token.json` (Authentication)

The `token.json` file holds your personal access and refresh tokens. You must generate this once.

1.  Ensure your `credentials.json` file is in the root directory.
2.  Start the server:
    ```bash
    nodemon server.js
    ```
3.  The console will output a new authorization URL:
    ```
    Authorize this app by visiting this url: [YOUR_GOOGLE_AUTH_URL]
    ```
4.  **Copy and paste the URL** into your web browser.
5.  Log in to your Google account and grant the requested permissions.
6.  Upon success, your server will automatically create the **`token.json`** file in your root directory.

---

## 3. Running the Project

Once all the files (`.env`, `credentials.json`, `token.json`) are correctly placed:

1.  **Start the Server:**
    ```bash
    nodemon server.js
    ```
2.  **Start the Frontend (Client):**
    Run frontend it from its directory:
    ```bash
    cd frontend
    npm start
    ```

The application should now be accessible, typically at `http://localhost:3030`.

