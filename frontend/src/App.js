import React, { useState } from "react";
import axios from "axios";

function App() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState('');
  const [googleLink, setGoogleLink] = useState('');
  const [canvaLink, setCanvaLink] = useState('');
  const [canvaAuthorized, setCanvaAuthorized] = useState(false);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleUploadToGoogle = async () => {
    if (!file) return alert("Please select a file!");

    const formData = new FormData();
    formData.append("file", file);

    setLoading(true);
    setResponse("");
    setGoogleLink("");

    try {
      const res = await axios.post("http://localhost:3000/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const cleanedTextHeader = res.headers["x-cleaned-text"];
      const cleanedText = cleanedTextHeader
        ? decodeURIComponent(cleanedTextHeader)
        : "No text received";
      setResponse(cleanedText);
      setGoogleLink(res.data.link);

    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || "Error processing file.");
    } finally {
      setLoading(false);
    }
  };

  const handleCanvaAuth = () => {
    // Open a new window for the Canva OAuth flow
    const authWindow = window.open("http://localhost:3000/auth/canva", "_blank", "width=600,height=700");
    
    // Listen for messages from the opened window to know when auth is complete
    const checkAuthStatus = setInterval(() => {
      if (authWindow.closed) {
        clearInterval(checkAuthStatus);
        // After the window closes, check if we have a Canva session
        // A real app would have a more robust way to check, like a new endpoint
        setCanvaAuthorized(true); // Assuming success
        alert("Canva authorized! You can now generate a presentation.");
      }
    }, 1000);
  };

  const handleUploadToCanva = async () => {
    if (!file) return alert("Please select a file!");
    if (!canvaAuthorized) return alert("Please authorize Canva first!");

    const formData = new FormData();
    formData.append("file", file);

    setLoading(true);
    setResponse("");
    setCanvaLink("");

    try {
      const res = await axios.post("http://localhost:3000/upload-to-canva", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      // You might not get a cleaned text header back for this endpoint,
      // so we'll just show the link.
      setCanvaLink(res.data.link);

    } catch (err) {
      console.error(err);
      // If authorization expired, we can prompt the user to re-auth
      if (err.response?.status === 401) {
        setCanvaAuthorized(false);
        alert("Canva authorization expired. Please authorize again.");
      } else {
        alert(err.response?.data?.error || "Error processing file.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>Upload Document</h1>
      <input type="file" accept=".txt,.pdf,.docx" onChange={handleFileChange} />
      
      <div style={{ marginTop: 10 }}>
        <button
          onClick={handleUploadToGoogle}
          style={{ marginRight: 10 }}
          disabled={loading || !file}
        >
          {loading ? "Generating..." : "Generate Google Slides"}
        </button>
        <button
          onClick={handleCanvaAuth}
          style={{ marginRight: 10 }}
          disabled={canvaAuthorized}
        >
          {canvaAuthorized ? "Canva Authorized" : "Authorize Canva"}
        </button>
        <button
          onClick={handleUploadToCanva}
          disabled={loading || !file || !canvaAuthorized}
        >
          {loading ? "Generating..." : "Generate Canva Presentation"}
        </button>
      </div>

      {loading && <p>⏳ Please wait, generating presentation...</p>}

      {googleLink && (
        <div style={{ marginTop: 20 }}>
          <p>✅ Google Slides created successfully!</p>
          <a href={googleLink} target="_blank" rel="noopener noreferrer">
            Open Google Slides
          </a>
        </div>
      )}

      {canvaLink && (
        <div style={{ marginTop: 20 }}>
          <p>✅ Canva presentation created successfully!</p>
          <a href={canvaLink} target="_blank" rel="noopener noreferrer">
            Open Canva
          </a>
        </div>
      )}

      {response && (
        <div style={{ marginTop: 20 }}>
          <h3>Gemini-Formatted Text:</h3>
          <pre style={{ 
            whiteSpace: "pre-wrap", 
            wordWrap: "break-word", 
            background: "#f4f4f4", 
            padding: "10px", 
            borderRadius: "5px" 
          }}>
            {response}
          </pre>
        </div>
      )}
    </div>
  );
}

export default App;