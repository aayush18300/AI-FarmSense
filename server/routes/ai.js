import express from "express";
import { GoogleGenAI } from "@google/genai";
import { protect } from "../middleware/auth.js";
import ChatMessage from "../models/ChatMessage.js";

const router = express.Router();
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const SYSTEM_PROMPT = `
You are "FarmSense AI", an expert agricultural assistant for Indian farmers.

You have deep knowledge of:
- Indian crops such as wheat, rice, cotton, tomato, onion, soybean, and sugarcane
- Pest and disease management using organic and chemical solutions
- Irrigation techniques and water management
- Soil health and fertilizer recommendations
- Government schemes such as PM-Kisan, PMFBY, and KCC
- Mandi prices and market timing
- Weather-based farming decisions
- Kharif, Rabi, and Zaid crop seasons

RESPONSE RULES:

1. Be practical, concise, and actionable.
2. Use the farmer's location, active crops, and current season when relevant.
3. If the user writes in Hindi, respond in Hindi.
4. If the user writes in Marathi, respond in Marathi.
5. Otherwise respond in simple English.
6. Prefer cost-effective solutions first.
7. Give specific quantities and timings only when they can be responsibly determined.
8. If important information is missing, ask a short follow-up question.
9. Do not invent current mandi prices, weather conditions, government scheme rules, or guaranteed crop profits.
10. Clearly state when advice depends on soil testing, local weather, crop variety, irrigation, or market conditions.

FORMATTING RULES:

- Format responses in clean Markdown.
- Use short paragraphs.
- Use ### headings only when the response has multiple sections.
- Use bullet points for recommendations.
- Use numbered lists for step-by-step actions.
- Use **bold text** only for important terms and recommendations.
- Put every bullet point on a separate line.
- Add a blank line between sections.
- Never create Markdown tables unless the user explicitly asks for a table.
- Do not put multiple recommendations on the same line.
- Avoid unnecessary emojis.
- Keep normal responses under 150 words unless detailed explanation is necessary.

When comparing crops, prefer this structure:

### Recommendation

**Crop name**
- Water requirement: ...
- Time to harvest: ...
- Main advantage: ...
- Main risk: ...

### Suggested Plan

- Recommendation 1
- Recommendation 2
- Recommendation 3

End with one useful follow-up question only when additional farmer information would materially improve the advice.
`;

// POST /api/ai/chat
router.post("/chat", protect, async (req, res) => {
  try {
    const { messages, context, saveToHistory } = req.body;

    const systemWithContext = context
      ? `${SYSTEM_PROMPT}

FARMER CONTEXT:
- Location: ${context.location || "India"}
- Active crops: ${context.crops?.join(", ") || "Unknown"}
- Current season: ${context.season || "Current"}

Use this context only when relevant to the farmer's question.`
      : SYSTEM_PROMPT;

    const prompt = `
${systemWithContext}

Conversation:
${messages.map((m) => `${m.role}: ${m.content}`).join("\n")}

Assistant:
`;

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const reply = result.text;

    if (saveToHistory) {
      const userMessage = messages[messages.length - 1];

      await ChatMessage.insertMany([
        {
          user: req.user._id,
          role: userMessage.role,
          content: userMessage.content,
        },
        {
          user: req.user._id,
          role: "assistant",
          content: reply,
        },
      ]);
    }

    res.json({ reply });

  } catch (err) {
    console.error("CHAT ERROR:");
    console.error(err);

    res.status(500).json({
      message: err.message,
      error: err,
    });
  }
});



// GET HISTORY
router.get("/history", protect, async (req, res) => {
  try {
    const messages = await ChatMessage.find({
      user: req.user._id,
    })
      .sort({ createdAt: 1 })
      .limit(50);

    res.json(messages);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: err.message,
    });
  }
});



// CROP ADVICE
router.post("/crop-advice", protect, async (req, res) => {
  try {
    const { crop, issue, weather } = req.body;

    const prompt = `
${SYSTEM_PROMPT}

Crop:
${crop}

Issue:
${issue}

Weather:
${JSON.stringify(weather || {})}

Give:
Problem
Cause
Solution
Prevention
`;

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    res.json({
      advice: result.text,
    });

  } catch (err) {
    console.error("CROP ERROR:");
    console.error(err);

    res.status(500).json({
      message: err.message,
      error: err,
    });
  }
});




// SELL ADVICE
router.post("/sell-advice", protect, async (req, res) => {
  try {
    const {
      crop,
      quantity,
      currentPrice,
      priceHistory,
      location,
    } = req.body;

    const prompt = `
${SYSTEM_PROMPT}

Crop: ${crop}

Quantity: ${quantity}

Current Price: ₹${currentPrice}

Location: ${location}

Price History:
${JSON.stringify(priceHistory)}

Should I sell now or wait?
Explain your reasoning.
`;

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    res.json({
      advice: result.text,
    });

  } catch (err) {
    console.error("SELL ERROR:");
    console.error(err);

    res.status(500).json({
      message: err.message,
      error: err,
    });
  }
});

export default router;