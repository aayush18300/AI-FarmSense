import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { protect } from "../middleware/auth.js";
import Detection from "../models/Detection.js";

const router = express.Router();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "uploads/diseases";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp/;
    if (allowed.test(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

// POST /api/disease/detect
router.post("/detect", protect, upload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No image uploaded" });
  }

  try {
    const imageData = fs.readFileSync(req.file.path);

    const prompt = `
Analyze this crop/plant image as an expert plant pathologist.

Return ONLY valid JSON.

{
  "disease": "",
  "confidence": "",
  "severity": "",
  "affected_part": "",
  "cause": "",
  "symptoms": [],
  "treatment": [],
  "prevention": [],
  "organic_solution": "",
  "urgency": ""
}
`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: imageData.toString("base64"),
          mimeType: req.file.mimetype,
        },
      },
    ]);

    const text = result.response.text();

    let analysis;

    try {
      analysis = JSON.parse(
        text.replace(/```json/g, "").replace(/```/g, "").trim()
      );
    } catch {
      analysis = {
        disease: "Unknown",
        raw: text,
      };
    }

    await Detection.create({
      user: req.user._id,
      disease: analysis.disease,
      severity: analysis.severity || null,
      confidence: analysis.confidence || null,
      affected_part: analysis.affected_part || null,
      cause: analysis.cause || null,
      urgency: analysis.urgency || null,
      symptoms: analysis.symptoms || [],
      treatment: analysis.treatment || [],
      prevention: analysis.prevention || [],
      organic_solution: analysis.organic_solution || null,
      crop: req.body.crop || null,
    });

    res.json({
      result: analysis,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: err.message,
    });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

// GET history
router.get("/history", protect, async (req, res) => {
  try {
    const detections = await Detection.find({
      user: req.user._id,
    })
      .sort({ createdAt: -1 })
      .limit(20);

    res.json(detections);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
});

export default router;
