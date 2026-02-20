import React, { useState } from "react";
import axios from "axios";

function App() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState('');
  const [link, setLink] = useState(''); // New state for the Google Slides link

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!file) return alert("Please select a file!");

    const formData = new FormData();
    formData.append("file", file);

    setLoading(true);
    setResponse("");
    setLink("");

    try {
      const res = await axios.post("http://localhost:3000/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        // ✅ responseType: 'json' is the default and can be omitted
      });

      const cleanedTextHeader = res.headers["x-cleaned-text"];
      const cleanedText = cleanedTextHeader
        ? decodeURIComponent(cleanedTextHeader)
        : "No text received";
      setResponse(cleanedText);
      setLink(res.data.link); // Store the link from the JSON response

    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || "Error processing file.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>Upload Document</h1>
      <input type="file"  accept=".txt,.pdf,.docx" onChange={handleFileChange} />
      <button
        onClick={handleUpload}
        style={{ marginLeft: 10 }}
        disabled={loading}
      >
        {loading ? "Generating..." : "Generate Slides"}
      </button>
      {loading && <p>⏳ Please wait, generating presentation...</p>}
      {link && (
        <div style={{ marginTop: 20 }}>
          <p>✅ Presentation created successfully!</p>
          <a href={link} target="_blank" rel="noopener noreferrer">
            Open Google Slides
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