// server.js
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const morgan = require("morgan");
const { WebSocketServer } = require("ws");
const multer = require("multer");
const OpenAI = require("openai");
require("dotenv").config();

// ===== OpenAI =====
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ===== Diretórios =====
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// ===== Express/HTTP =====
const app = express();
const PORT_HTTP = process.env.PORT || 3000;

app.use(morgan("dev"));
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const upload = multer({ dest: uploadsDir });

app.get("/", (req, res) => {
  res.send("Servidor do Assistente Virtual rodando 🚀");
});

// Função utilitária para salvar buffer como WAV
function salvarBufferComoWav(buffer) {
  const filePath = path.join(uploadsDir, `audio_${Date.now()}.wav`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

// Handler principal de /voice
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

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePathToProcess),
      model: "whisper-1",
    });

    const textoUsuario = transcription?.text?.trim() || "";

    if (!textoUsuario) return res.json({ text: "Desculpe, não consegui entender. Pode repetir?" });

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

// Rota /voice
app.post(
  "/voice",
  (req, res, next) => {
    if (req.is("multipart/form-data")) return upload.single("audio")(req, res, next);
    return express.raw({ type: ["audio/wav", "audio/*", "application/octet-stream"], limit: "25mb" })(req, res, next);
  },
  handleVoice
);

// Rota /tts
app.get("/tts", async (req, res) => {
  try {
    const texto = (req.query.text || "").toString();
    if (!texto) return res.status(400).send("Parâmetro 'text' é obrigatório");

    const key = process.env.VOICERSS_KEY;
    if (!key) return res.status(500).send("VOICERSS_KEY não configurada no servidor");

    const ttsUrl = `https://api.voicerss.org/?key=${key}&hl=pt-br&c=MP3&src=${encodeURIComponent(texto)}`;
    const resp = await fetch(ttsUrl);
    if (!resp.ok) return res.status(502).send(`Falha no TTS: ${resp.status}`);

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
const PORT_WS = 10000;
const wss = new WebSocketServer({ port: PORT_WS });
console.log(`Servidor WebSocket rodando na porta ${PORT_WS}`);

wss.on("connection", (ws) => {
  console.log("ESP32 conectado ✅");
  ws.on("message", (message) => {
    console.log("Mensagem do ESP32:", message.toString());
    ws.send("Servidor recebeu sua mensagem!");
  });
  ws.on("close", () => console.log("ESP32 desconectado ❌"));
});

// Inicia HTTP
app.listen(PORT_HTTP, () => {
  console.log(`Servidor HTTP rodando na porta ${PORT_HTTP}`);
});
