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
const socket = require("websockets/lib/websockets/socket");
const { start } = require("repl");

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
const audioCache = new Map(); // Para almacenar los audios en memoria temporalmente

const publicDir = path.join(__dirname, "public");
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
  console.log('Directorio "public" creado.');
}

app.use(cors());
app.use("/public", express.static(publicDir));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
let welcomeUrl = "";
let welcomeId = ""
let latestAudioUrl = ""; // Variable global para almacenar la URL del último audio generado
let startProcess = false;
let userSpeech = ""
let despedidas = [
  "adiós", "hasta luego", "nos vemos", "bye", "me voy", 
  "gracias, adiós", "eso es todo, hasta luego", "ya terminé, gracias", 
  "me tengo que ir"
];
let welcome = true;
// Configuración de Socket.io
io.on("connection", (socket) => {
  console.log("a user connected");

  socket.on("make-call", async (phone) => {
    console.log(phone)
    welcome = phone
    startProcess = !phone
    io.emit("message", `Phone: ${phone}`);
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
      io.emit("message", "Llamada iniciada.")
    })

  socket.on("call", async (text) => {
    if(welcome){
      console.log("Llamada recibida a través del WebSocket");
      const response = new VoiceResponse();
      let botResponse = "";
    
      try {
        const [gptResponse, audioResponse] = await Promise.all([
          openai.chat.completions.create({
            model: model,
            messages: [
              { role: "assistant", content: "Buen dia, soy Jose Luis, representante del Banco Santander. Estamos ofreciendo terminales punto de venta. ¿Con quién tengo el gusto?" },
            ],
          }),
          fetch("https://api.openai.com/v1/audio/speech", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "tts-1",
              voice: "shimmer",
              input: "Buen dia, soy Jose Luis, representante del Banco Santander. Estamos ofreciendo terminales punto de venta. ¿Con quién tengo el gusto?",
            }),
          }),
        ]);
    
        const audioBuffer = await audioResponse.buffer();
        const audioFileName = `${uuidv4()}.mp3`;
        const audioFilePath = path.join(publicDir, audioFileName);
        fs.writeFileSync(audioFilePath, audioBuffer);
        console.log(`Audio guardado en: ${audioFilePath}`);
        console.log("Audio:", audioFileName);
  
        const audioId = uuidv4(); // Generar un ID único para el audio
        console.log("Audio id: ", audioId);
        audioCache.set(audioId, audioBuffer); // Almacenar en memoria
        welcomeId = audioId
        // Establecer tiempo de vida limitado para el audio (opcional)
        setTimeout(() => audioCache.delete(audioId), 5 * 60 * 1000); // 5 minutos


        welcomeUrl = audioFileName;
      } catch (error) {
        console.error("Error en la generación de la respuesta:", error);
        io.emit("error", { message: "Error al procesar la solicitud." });
      }
    }
  });
  
  socket.on("process-speech", async (text) => {
    if(startProcess){
      io.emit("message", `Usuario: ${userSpeech}`)
      let botResponse = "";
      try {
        const gptResponse = await openai.chat.completions.create({
          model: model,
          messages: [
            { role: "system", content: "Eres un asistente del banco Santander especializado en terminales de pago." },
            { role: "user", content: userSpeech },
          ],
        });
        
        const botResponse = gptResponse.choices[0].message.content;
        
        const [audioResponse] = await Promise.all([
          fetch("https://api.openai.com/v1/audio/speech", {
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
          }),
        ]);
        
        const audioBuffer = await audioResponse.buffer();
        const audioFileName = `${uuidv4()}.mp3`;
        const audioFilePath = path.join(publicDir, audioFileName);
        fs.writeFileSync(audioFilePath, audioBuffer);
        console.log(`Audio guardado en: ${audioFilePath}`);
        latestAudioUrl = audioFileName
        io.emit("message", `Bot: ${botResponse}`);
      } catch (error) {
        console.error("Error al generar respuesta:", error);
        const response = new VoiceResponse();
        response.say({ voice: "alice", language: "es-MX" }, "Lo siento, hubo un problema. Por favor, intenta de nuevo.");
      }
    }
  })

  socket.on("message", async (message) => {
    console.log(message);
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
    io.emit("message", `Bot: ${botResponse}`);
  }catch (error) {
    console.error("Error al generar la respuesta con OpenAI:", error);
  }
  });
  socket.on("disconnect", () => {
    console.log("a user disconnected");
  });
});

// WebSocket actualizando la URL del audio generado
app.get("/dynamic-audio/:idid", (req, res) => {
  const audioId = req.params.id;
  const audioBuffer = audioCache.get(audioId);
  if (!audioBuffer) {
    return res.status(404).send("Audio no encontrado.");
  }
  res.setHeader("Content-Type", "audio/mpeg");
  res.send(audioBuffer);
})
app.post("/voice", async (req, res) => {
  const response = new VoiceResponse();
  let enableResponse =false;
  if(startProcess && userSpeech != req.body.SpeechResult){
    enableResponse = true
    userSpeech =req.body.SpeechResult;
    io.emit("process-speech-trigger")
  }else{
    enableResponse = false
  }
    try{
      if(welcome){
        console.log("Welcome voice")
        response.play(`https://call-t0fi.onrender.com/dynamic-audio/${welcomeId}`);
        response.gather({
          input: "speech",
          action: "/voice",
          language: "es-MX",
        });
        startProcess = true
        welcome = false
      }
      if(startProcess && enableResponse){
        console.log("Process-speech voice")
        response.play(`https://call-t0fi.onrender.com/public/${latestAudioUrl}`);
        response.gather({
          input: "speech",
          action: "/voice",
          language: "es-MX",
        });
        
        if (despedidas.some((despedida) => userSpeech.includes(despedida))) {
          return;
        }
      }
    }catch(error){
      console.error("Error al esperar el audio:", error);
      response.say({ voice: "alice", language: "es-MX" }, "Hubo un error procesando tu solicitud.");
    }
    res.type("text/xml");
    res.send(response.toString());
});

// Iniciar servidor
server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
