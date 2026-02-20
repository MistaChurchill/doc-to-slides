import React, { useState } from "react";
import axios from "axios";

function App() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [slidesLink, setSlidesLink] = useState(""); // ✅ store Google Slides link
  const [error, setError] = useState("");

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!file) return alert("Please select a file!");

    const formData = new FormData();
    formData.append("file", file);

    setLoading(true);
    setSlidesLink("");
    setError("");

    try {
      const res = await axios.post("http://localhost:3000/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      // ✅ Backend now returns { message, link }
      if (res.data.link) {
        setSlidesLink(res.data.link);
      } else {
        setError("No link received from backend");
      }
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>Upload Document → Google Slides</h1>
      <input type="file" onChange={handleFileChange} />
      <button
        onClick={handleUpload}
        style={{ marginLeft: 10 }}
        disabled={loading}
      >
        {loading ? "Generating..." : "Generate Slides"}
      </button>

      {loading && <p>⏳ Please wait, generating presentation...</p>}

      {slidesLink && (
        <p>
          ✅ Slides created!{" "}
          <a href={slidesLink} target="_blank" rel="noopener noreferrer">
            Open in Google Slides
          </a>
        </p>
      )}

      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}

export default App;
