import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Database file setup
const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

function initDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify({ applicants: [], inquiries: [] }, null, 2),
      "utf-8"
    );
  }
}

function readDb() {
  initDb();
  try {
    const content = fs.readFileSync(DB_FILE, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error("Error reading database:", error);
    return { applicants: [], inquiries: [] };
  }
}

function writeDb(data: { applicants: any[]; inquiries: any[] }) {
  initDb();
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error("Error writing database:", error);
  }
}

// Lazy Gemini API Client
let aiClient: GoogleGenAI | null = null;

function getAIClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey.includes("MY_GEMINI")) {
    return null;
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// --- API Endpoints ---

// 1. Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// 2. Submit Application (Job Seeker Registration)
app.post("/api/apply", (req, res) => {
  try {
    const {
      name,
      phone,
      email,
      state,
      district,
      age,
      passportStatus,
      passportNumber,
      trade,
      subTrade,
      preferredCountries,
      experience,
      skills,
    } = req.body;

    if (!name || !phone || !district || !trade || !preferredCountries) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const db = readDb();
    const newApplicant = {
      id: "APP-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
      name,
      phone,
      email: email || "",
      state: state || "Bihar",
      district,
      age: Number(age) || 25,
      passportStatus,
      passportNumber: passportNumber || "",
      trade,
      subTrade: subTrade || "",
      preferredCountries: Array.isArray(preferredCountries) ? preferredCountries : [preferredCountries],
      experience: Number(experience) || 0,
      skills: skills || "",
      status: "Applied",
      appliedAt: new Date().toISOString(),
    };

    db.applicants.push(newApplicant);
    writeDb(db);

    res.status(201).json({ success: true, applicant: newApplicant });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Fetch Applications (Filterable for Owner Panel)
app.get("/api/applications", (req, res) => {
  try {
    const { trade, district, passportStatus, search } = req.query;
    const db = readDb();
    let list = db.applicants;

    if (trade) {
      list = list.filter((a: any) => a.trade.toLowerCase() === (trade as string).toLowerCase());
    }
    if (district) {
      list = list.filter((a: any) => a.district.toLowerCase() === (district as string).toLowerCase());
    }
    if (passportStatus) {
      list = list.filter((a: any) => a.passportStatus === passportStatus);
    }
    if (search) {
      const q = (search as string).toLowerCase();
      list = list.filter(
        (a: any) =>
          a.name.toLowerCase().includes(q) ||
          a.phone.includes(q) ||
          (a.subTrade && a.subTrade.toLowerCase().includes(q))
      );
    }

    // Sort by most recent application first
    list.sort((a: any, b: any) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime());

    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Update Application Status (Admin Action)
app.post("/api/applications/:id/status", (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: "Missing status field" });
    }

    const db = readDb();
    const idx = db.applicants.findIndex((a: any) => a.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: "Applicant not found" });
    }

    db.applicants[idx].status = status;
    writeDb(db);

    res.json({ success: true, applicant: db.applicants[idx] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Submit Question / Inquiry
app.post("/api/inquiries", (req, res) => {
  try {
    const { name, phone, question } = req.body;

    if (!name || !phone || !question) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const db = readDb();
    const newInquiry = {
      id: "INQ-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
      name,
      phone,
      question,
      status: "Pending",
      createdAt: new Date().toISOString(),
    };

    db.inquiries.push(newInquiry);
    writeDb(db);

    res.status(201).json({ success: true, inquiry: newInquiry });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 6. Fetch Inquiries
app.get("/api/inquiries", (req, res) => {
  try {
    const db = readDb();
    const list = db.inquiries;

    // Sort by most recent first
    list.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 7. Reply to Inquiry (Admin Action)
app.post("/api/inquiries/:id/reply", (req, res) => {
  try {
    const { id } = req.params;
    const { answer } = req.body;

    if (!answer) {
      return res.status(400).json({ error: "Missing answer field" });
    }

    const db = readDb();
    const idx = db.inquiries.findIndex((i: any) => i.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: "Inquiry not found" });
    }

    db.inquiries[idx].answer = answer;
    db.inquiries[idx].status = "Answered";
    writeDb(db);

    res.json({ success: true, inquiry: db.inquiries[idx] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 8. AI Careers Advisor Sarthi
app.post("/api/ai/chat", async (req, res) => {
  try {
    const { history, message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const client = getAIClient();
    if (!client) {
      // Elegant fallback response if API Key is not set or placeholder
      const hindiFallbackAnswers = [
        "नमस्ते! मैं आपका बीईओ साथी (BEO AI Sarthi) हूँ। वर्तमान में एआई सेवा सक्रिय नहीं है क्योंकि जेमिनी एपीआई कुंजी सेट नहीं है। लेकिन मैं आपको बता सकता हूँ कि बिहार एम्प्लॉयमेंट ओवरसीज (Bihar Employment Overseas) गल्फ देशों (दुबई, सऊदी अरब, कतर), रूस और मलेशिया के लिए सर्वश्रेष्ठ और सुरक्षित वर्क वीजा सेवाएं प्रदान करता है!",
        "प्रणाम! क्या आप विदेश में जॉब पाना चाहते हैं? जैसे ही आपके एडमिन यहाँ Secrets में जेमिनी एपीआई की जोड़ेंगे, मैं आपको प्रत्येक ट्रेड, सैलरी और वीजा प्रोसेस की पूरी जानकारी दूंगा। तब तक आप हमारे मुख्य पृष्ठ पर जाकर ट्रेड चुन सकते हैं और सीधे अपना फॉर्म भर सकते हैं!",
        "जय बिहार! हमारे पास इलेक्ट्रिशियन, सिविल वर्कर, मैकेनिकल फिटर, वेयरहाउस और होटल मैनेजमेंट (हॉस्पिटैलिटी) के लिए रूस, मलेशिया और खाड़ी देशों में बेहतरीन जॉब्स उपलब्ध हैं। आप हमारी वेबसाइट पर निःशुल्क रजिस्ट्रेशन फॉर्म भरकर आवेदन कर सकते हैं।"
      ];
      const randomAns = hindiFallbackAnswers[Math.floor(Math.random() * hindiFallbackAnswers.length)];
      return res.json({ text: randomAns });
    }

    // Format chat history for the SDK
    const formattedContents = [];
    if (history && Array.isArray(history)) {
      for (const msg of history) {
        formattedContents.push({
          role: msg.role === "user" ? "user" : "model",
          parts: [{ text: msg.text }],
        });
      }
    }
    formattedContents.push({ role: "user", parts: [{ text: message }] });

    const response = await client.models.generateContent({
      model: "gemini-3.5-flash",
      contents: formattedContents,
      config: {
        systemInstruction: `You are "BEO AI Sarthi" (बीईओ एआई सारथी), the official bilingual recruitment assistant for Bihar Employment Overseas (BEO).
Your goal is to guide job seekers from Bihar who are looking for work visa opportunities in overseas markets like Dubai/UAE, Saudi Arabia, Qatar, Oman, Russia, Malaysia, and other countries.

Key Guidelines:
1. Speak in a helpful, respectful, and friendly mix of Hindi and English (Hinglish/Bihari tone). Be warm, encouraging, and clear.
2. Provide details about the primary trades we recruit for:
   - Electrician (House wiring, Industrial electrician, Control panel wiring)
   - Civil works (Mason, Painter, Steel fixer, Carpenter, Plumber, Civil helper, Supervisor)
   - Mechanical Trades (Welder - Arc/Argon, Fitter - Pipe/Structural, CNC Operator, AC Technician, Auto Mechanic)
   - Warehousing (Loader, Packer, Forklift operator, Storekeeper)
   - Hospitality (Waiter, Commis chef, Housekeeper, Cleaner, Hotel staff)
   - Other jobs: Heavy & Light Drivers, Security Guards.
3. Inform users about critical document requirements:
   - Original Passport (valid for at least 6 months)
   - GAMCA Medical test (for Gulf countries)
   - Police Clearance Certificate (PCC) (from the local Bihar district police station)
   - 4-8 passport size photos with white background
   - Trade Test Certificate (if available, showing technical skills)
4. Address common doubts:
   - Process time: Usually 30 to 45 days.
   - Salaries: Range from ₹25,000 to ₹65,000 INR depending on trade, experience, and country. Overtime (OT) and free food/accommodation are provided in most Gulf/Russia/Malaysia contracts.
   - Siwan, Gopalganj, Patna, and Gopalganj are huge hotspots for overseas recruitment in Bihar.
5. If the user asks general or unrelated questions, gently pivot back to helping them with overseas jobs and encouraging them to fill out the registration form on our website so the owner can contact them!
6. Keep answers concise, formatted with clear bullet points, and highly readable on a mobile screen.`,
      },
    });

    res.json({ text: response.text });
  } catch (error: any) {
    console.error("AI Sarthi Error:", error);
    res.status(500).json({ error: "AI Assistant is resting. Please try again soon!" });
  }
});

// --- Vite and SPA Fallback Configuration ---

async function startServer() {
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
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
