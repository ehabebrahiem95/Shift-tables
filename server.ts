import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Gemini API Route
  app.post("/api/suggest-shifts", async (req, res) => {
    try {
      const { employees, shiftRequests } = req.body;
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        return res.status(500).json({ error: "Gemini API Key is missing on the server" });
      }

      const ai = new GoogleGenAI(apiKey);
      const model = ai.getGenerativeModel({ model: "gemini-2.0-flash" });

      const prompt = `
        تحليل وتوزيع الشيفتات الذكية.
        الموظفين: ${JSON.stringify(employees)}
        الشيفتات المطلوبة: ${JSON.stringify(shiftRequests)}
        الرجاء توزيع الموظفين على الشيفتات بطريقة عادلة مع مراعاة التخصصات.
        أرجع النتيجة بصيغة JSON فقط: [{"title": "shift_title", "userId": "user_id"}]
      `;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      const suggestions = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
      
      res.json(suggestions);
    } catch (error) {
      console.error("Gemini Server Error:", error);
      res.status(500).json({ error: "Failed to generate suggestions" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
