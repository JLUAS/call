const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const twilio = require("twilio");
const fetch = require("node-fetch");
const fs = require("fs");
const dotenv = require("dotenv");
const { OpenAI } = require("openai");
const path = require("path");
const { v4: uuidv4 } = require("uuid"); // Para generar nombres únicos de archivos
const cors = require("cors");

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const PORT = process.env.PORT || 3000;

// Configuración Twilio y OpenAI
const twilioPhoneNumber = process.env.TWILIO_PHONE;
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL_ID;
const VoiceResponse = twilio.twiml.VoiceResponse;
const client = new twilio(accountSid, authToken);
const openai = new OpenAI({ apiKey });

const publicDir = path.join(__dirname, "public");
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
  console.log('Directorio "public" creado.');
}

app.use(cors());
app.use("/public", express.static(publicDir));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Configuración de Socket.io
io.on("connection", (socket) => {
  console.log("a user connected");

  socket.on("make-call", async(phone) => {
    console.log(phone)
    client.calls.create({
      to: '+528662367673', // Número de destino proporcionado
      from: twilioPhoneNumber, // Tu número de Twilio
      url: "https://call-t0fi.onrender.com/voice" // URL que Twilio usará para obtener las instrucciones
    })
      .then(call => {
        console.log(`Llamada realizada con SID: ${call.sid}`);
      })
      .catch(err => {
        console.log("Error")
    })
  })

  socket.on(("call"), async (tri) => {
    console.log("Llamada en ws call")
    const response = new VoiceResponse();
    let botResponse = "";
    try {
      const gptResponse = await openai.chat.completions.create({
        model: model,
        messages: [
          {
            role: "system",
            content: "Eres un asistente del banco Choche.",
          },
          {
            role: "user",
            content: "Hola, buen día. Le llamo del banco Choche.",
          },
        ],
      });

      botResponse = gptResponse.choices[0].message.content;
      console.log(`Respuesta generada por OpenAI: ${botResponse}`);

      const audioResponse = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "tts-1",
          voice: "shimmer",
          input: botResponse,
        }),
      });

      const audioBuffer = await audioResponse.buffer();
      const audioFileName = `${uuidv4()}.mp3`;
      const audioFilePath = path.join(publicDir, audioFileName);
      fs.writeFileSync(audioFilePath, audioBuffer);
      console.log(`Audio guardado en: ${audioFilePath}`);

      response.play(`https://call-t0fi.onrender.com/public/${audioFileName}`);
      response.gather({
        input: "speech",
        action: "/process-speech",
        language: "es-MX",
      });
    } catch (error) {
      console.error("Error al generar la respuesta con OpenAI:", error);
      response.say({ voice: "alice", language: "es-MX" }, "Error. Intenta más tarde.");
    }
  })

  socket.on("message", async (message) => {
    console.log(message);
    const response = new VoiceResponse();
    let botResponse = "";
    try {
      const gptResponse = await openai.chat.completions.create({
        model: model,
        messages: [
          {
            role: "system",
            content: "Eres un asistente del banco Santander.",
          },
          {
            role: "user",
            content: message,
          },
        ],
      });

    botResponse = gptResponse.choices[0].message.content;
    io.emit("message", `${socket.id.substr(0, 2)} said ${botResponse}`);
  }catch (error) {
    console.error("Error al generar la respuesta con OpenAI:", error);
  }
  });
  socket.on("disconnect", () => {
    console.log("a user disconnected");
  });
});
app.post("/voice", async (req, res) => {
  io.emit("call", 2)
  res.status(200).send({ message: 'Llamada realizada con éxito' });

});

app.post('/make-call', (req, res) => {
  io.emit("make-call", +528662367673)
  console.log("hola?")
  res.status(200).send({ message: 'Llamada realizada con éxito' });
})


// Iniciar servidor
server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
