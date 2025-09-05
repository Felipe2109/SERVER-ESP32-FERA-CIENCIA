// server.js
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const morgan = require("morgan");
const { WebSocketServer } = require("ws");
const multer = require("multer");
const OpenAI = require("openai");

// Carrega variáveis de ambiente
require("dotenv").config();

// ===== OpenAI =====
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY // pega do Render
});

// ===== App =====
const app = express();
const PORT = process.env.PORT || 3000; // Render define a porta

// Logs e CORS
app.use(morgan("dev"));
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Pasta temporária de uploads
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// Multer para multipart/form-data
const upload = multer({ dest: uploadsDir });

// Rota raiz
app.get("/", (req, res) => {
  res.send("Servidor do Assistente Virtual rodando 🚀");
});

// Salva Buffer em arquivo WAV temporário
function salvarBufferComoWav(buffer) {
  const filePath = path.join(uploadsDir, `audio_${Date.now()}.wav`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

// Handler de /voice
async function handleVoice(req, res) {
  let filePathToProcess = null;

  try {
    if (req.file && req.file.path) {
      filePathToProcess = path.resolve(req.file.path);
    } else if (req.body && Buffer.isBuffer(req.body) && req.body.length > 0) {
      filePathToProcess = salvarBufferComoWav(req.body);
    } else {
      return res.status(400).json({ error: "Nenhum áudio recebido" });
    }

    // Transcrição com Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePathToProcess),
      model: "whisper-1"
    });

    const textoUsuario = (transcription?.text) ? transcription.text : "";

    if (!textoUsuario.trim()) {
      return res.json({ text: "Desculpe, não consegui entender. Pode repetir?" });
    }

    // ChatGPT
    const chat = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Você é um assistente de voz útil e educado. Responda sempre em português do Brasil." },
        { role: "user", content: textoUsuario }
      ],
      temperature: 0.7
    });

    const resposta = chat.choices?.[0]?.message?.content?.trim() || "Certo!";
    res.json({ text: resposta });

  } catch (err) {
    console.error("Erro em /voice:", err);
    res.status(500).json({ error: "Erro ao processar áudio" });
  } finally {
    if (filePathToProcess && fs.existsSync(filePathToProcess)) {
      try { fs.unlinkSync(filePathToProcess); } catch (_) {}
    }
  }
}

// POST /voice
app.post(
  "/voice",
  (req, res, next) => {
    if (req.is("multipart/form-data")) return upload.single("audio")(req, res, next);
    return express.raw({
      type: ["audio/wav", "audio/*", "application/octet-stream"],
      limit: "25mb"
    })(req, res, next);
  },
  handleVoice
);

// GET /tts?text=...
app.get("/tts", async (req, res) => {
  try {
    const texto = (req.query.text || "").toString();
    if (!texto) return res.status(400).send("Parâmetro 'text' é obrigatório");

    const key = process.env.VOICERSS_KEY;
    if (!key) return res.status(500).send("VOICERSS_KEY não configurada");

    const ttsUrl = `https://api.voicerss.org/?key=${key}&hl=pt-br&c=MP3&src=${encodeURIComponent(texto)}`;
    const resp = await fetch(ttsUrl);

    if (!resp.ok) {
      const msg = await resp.text().catch(() => "");
      return res.status(502).send(`Falha no TTS: ${resp.status} ${msg}`);
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");

    if (resp.body.pipe) {
      resp.body.pipe(res);
    } else {
      const arrayBuf = await resp.arrayBuffer();
      res.end(Buffer.from(arrayBuf));
    }
  } catch (err) {
    console.error("Erro em /tts:", err);
    res.status(500).send("Erro ao gerar TTS");
  }
});

// ===== WebSocket =====
const server = app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("ESP32 conectado ✅");
  ws.on("message", (message) => {
    console.log("Mensagem do ESP32:", message.toString());
    ws.send("Servidor recebeu sua mensagem!");
  });
  ws.on("close", () => console.log("ESP32 desconectado ❌"));
});
