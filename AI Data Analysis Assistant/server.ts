import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '20mb' }));

// Lazy initializer for Gemini Client
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is not configured.');
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
  }
  return aiClient;
}

// API Route: Generate AI Data Insights & Executive Summary
app.post('/api/ai/insights', async (req, res) => {
  try {
    const { sampleRows, columnMeta, datasetName } = req.body;

    const ai = getGeminiClient();

    const prompt = `
You are an expert Data Analyst & Business Intelligence Lead.
Analyze the following dataset snippet (${datasetName || 'Excel Upload'}):

Columns and Types:
${JSON.stringify(columnMeta, null, 2)}

Sample Data Rows (up to 10 rows):
${JSON.stringify(sampleRows, null, 2)}

Generate a structured business analysis containing:
1. Executive Summary
2. Key Trends & Observations
3. Anomalies or Data Quality Issues Detected
4. High-Impact Strategic Opportunities/Recommendations

Respond strictly in JSON format matching this schema:
{
  "summary": "Short 2-3 sentence overall overview of the dataset.",
  "insights": [
    {
      "id": "insight-1",
      "title": "Title of the insight",
      "category": "trend" | "anomaly" | "correlation" | "opportunity" | "summary",
      "description": "Detailed observation with numeric references from the sample.",
      "impact": "high" | "medium" | "low",
      "metricHighlight": "e.g., +28% growth or 3 duplicates found",
      "recommendation": "Actionable recommendation"
    }
  ],
  "suggestedCharts": [
    {
      "id": "chart-1",
      "title": "Chart Title",
      "chartType": "bar" | "line" | "area" | "pie" | "scatter",
      "xAxis": "Column_Name_For_X",
      "yAxis": "Column_Name_For_Y",
      "aggregation": "sum" | "avg" | "count" | "min" | "max"
    }
  ]
}
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            insights: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  title: { type: Type.STRING },
                  category: { type: Type.STRING },
                  description: { type: Type.STRING },
                  impact: { type: Type.STRING },
                  metricHighlight: { type: Type.STRING },
                  recommendation: { type: Type.STRING }
                }
              }
            },
            suggestedCharts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  title: { type: Type.STRING },
                  chartType: { type: Type.STRING },
                  xAxis: { type: Type.STRING },
                  yAxis: { type: Type.STRING },
                  aggregation: { type: Type.STRING }
                }
              }
            }
          }
        }
      }
    });

    const jsonText = response.text || '{}';
    const parsed = JSON.parse(jsonText);
    res.json(parsed);
  } catch (err: any) {
    console.error('AI Insights error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate AI Insights' });
  }
});

// API Route: AI Predictive Analysis & Scenario Forecast
app.post('/api/ai/predict', async (req, res) => {
  try {
    const { targetColumn, timeColumn, summaryStats, sampleValues } = req.body;

    const ai = getGeminiClient();

    const prompt = `
You are a Senior Predictive Data Scientist.
Provide predictive insights and growth driver analysis for metric: "${targetColumn}" ${timeColumn ? `over time variable "${timeColumn}"` : ''}.

Statistical summary of target:
${JSON.stringify(summaryStats, null, 2)}

Sample history values:
${JSON.stringify(sampleValues, null, 2)}

Predict future behavior, key growth drivers, and strategic risk factors.

Respond in JSON format:
{
  "aiAnalysis": "Detailed narrative explaining future trajectory, key driver hypothesis, and market factors.",
  "keyDrivers": ["Driver 1", "Driver 2", "Driver 3"],
  "recommendedAction": "Top strategic advice based on forecast",
  "confidenceScore": 0.85
}
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            aiAnalysis: { type: Type.STRING },
            keyDrivers: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            recommendedAction: { type: Type.STRING },
            confidenceScore: { type: Type.NUMBER }
          }
        }
      }
    });

    const parsed = JSON.parse(response.text || '{}');
    res.json(parsed);
  } catch (err: any) {
    console.error('AI Predict error:', err);
    res.status(500).json({ error: err.message || 'Failed to compute AI prediction' });
  }
});

async function startServer() {
  // Vite middleware setup
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AI Data Analysis Assistant server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
