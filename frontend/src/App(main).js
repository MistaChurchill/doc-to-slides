import React, { useState } from "react";
import axios from "axios";

function App() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false); // ✅ loader state
  const [response, setResponse] = useState('');

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!file) return alert("Please select a file!");

    const formData = new FormData();
    formData.append("file", file);

    setLoading(true);
    setResponse("");

    try {
      const res = await axios.post("http://localhost:3000/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        responseType: "blob", // ✅ important! expect a file
      });

      const cleanedTextHeader = res.headers["x-cleaned-text"];
      const cleanedText = cleanedTextHeader
        ? decodeURIComponent(cleanedTextHeader)
        : "No text received";
      setResponse(cleanedText);

      // Create a download link
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = "presentation.pptx"; // ✅ file name
      document.body.appendChild(a);
      a.click();
      a.remove();

       // Clean up
      window.URL.revokeObjectURL(url);

      // --- Show text inside <pre> for comparison ---
      setResponse(cleanedText);
    } catch (err) {
      console.error(err);
      alert(err.response?.data);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>Upload Document</h1>
      <input type="file"  accept=".txt,.pdf,.docx" onChange={handleFileChange} />
      <button
        onClick={handleUpload}
        style={{ marginLeft: 10 }}
        disabled={loading}
      >
        {loading ? "Generating..." : "Generate Slides"}
      </button>
      {loading && <p>⏳ Please wait, generating presentation...</p>}
      {response && (
        <div style={{ marginTop: 20 }}>
          <h3>Extracted Text:</h3>
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
