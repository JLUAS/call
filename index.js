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

  io.on("connection", (socket) => {
    console.log("Usuario conectado con ID:", socket.id);
  
    // Escuchar eventos de cliente
    socket.on("start-call", async (data) => {
      console.log("Inicio de llamada solicitado:", data);
  
      try {
        // Realizar la llamada usando Twilio
        const call = await client.calls.create({
          to: data.to, // Número de destino
          from: twilioPhoneNumber, // Número Twilio
          url: "https://call-t0fi.onrender.com/voice", // URL para instrucciones
        });
  
        console.log(`Llamada realizada con SID: ${call.sid}`);
        socket.emit("call-started", { callSid: call.sid });
      } catch (err) {
        console.error("Error al realizar la llamada:", err);
        socket.emit("call-error", { error: "Error al realizar la llamada" });
      }
    });
  
    // Evento para finalizar la llamada
    socket.on("end-call", async (data) => {
      console.log("Finalizar llamada solicitado para SID:", data.callSid);
      try {
        await client.calls(data.callSid).update({ status: "completed" });
        socket.emit("call-ended", { message: "Llamada finalizada correctamente" });
      } catch (err) {
        console.error("Error al finalizar la llamada:", err);
        socket.emit("call-error", { error: "Error al finalizar la llamada" });
      }
    });
  
    socket.on("disconnect", () => {
      console.log("Usuario desconectado:", socket.id);
    });
  });

  socket.on("message", (message) => {
    console.log(message);
    io.emit("message", `${socket.id.substr(0, 2)} said ${message}`);
  });

  socket.on("disconnect", () => {
    console.log("a user disconnected");
  });
});

// Endpoint: Procesar respuesta de Twilio (entrada de voz)
app.post("/process-speech", async (req, res) => {
  const userSpeech = req.body.SpeechResult;
  console.log(`Usuario dijo: ${userSpeech}`);
  const despedidas = [
    "adiós", "hasta luego", "nos vemos", "bye", "me voy", 
    "gracias, adiós", "eso es todo, hasta luego", "ya terminé, gracias", 
    "me tengo que ir"
  ];
  let botResponse = "";
  try {
    const gptResponse = await openai.chat.completions.create({
      model: model,
      messages: [
        { role: "system", content: "Eres un asistente del banco Choche especializado en terminales de pago." },
        { role: "user", content: userSpeech },
      ],
    });

    botResponse = gptResponse.choices[0].message.content;
    console.log(`Respuesta generada por ChatGPT: ${botResponse}`);

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

    const response = new VoiceResponse();
    response.play(`https://call-t0fi.onrender.com/public/${audioFileName}`);
    response.gather({
      input: "speech",
      action: "/process-speech",
      language: "es-MX",
      timeout: 2,
    });

    res.type("text/xml");
    res.send(response.toString());

    if (despedidas.some((despedida) => userSpeech.includes(despedida))) {
      return;
    }
  } catch (error) {
    console.error("Error al generar respuesta:", error);
    const response = new VoiceResponse();
    response.say({ voice: "alice", language: "es-MX" }, "Lo siento, hubo un problema. Por favor, intenta de nuevo.");
    res.type("text/xml");
    res.send(response.toString());
  }
});

// Endpoint: Llamada saliente
app.get("/call", (req, res) => {
  client.calls
    .create({
      to: "+528662367673",
      from: twilioPhoneNumber,
      url: "https://call-t0fi.onrender.com/voice",
    })
    .then((call) => {
      console.log(`Llamada realizada con SID: ${call.sid}`);
      res.send(`Llamada realizada: ${call.sid}`);
    })
    .catch((err) => {
      console.error("Error al hacer la llamada:", err);
      res.status(500).send("Error al hacer la llamada");
    });
});

// Endpoint: Iniciar llamada
app.post("/voice", async (req, res) => {
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

    res.type("text/xml");
    res.send(response.toString());
  } catch (error) {
    console.error("Error al generar la respuesta con OpenAI:", error);
    response.say({ voice: "alice", language: "es-MX" }, "Error. Intenta más tarde.");
    res.type("text/xml");
    res.send(response.toString());
  }
});

app.post('/make-call', (req, res) => {
  client.calls.create({
    to: '+528662367673', // Número de destino proporcionado
    from: twilioPhoneNumber, // Tu número de Twilio
    url: 'https://call-t0fi.onrender.com/voice', // URL que Twilio usará para obtener las instrucciones
  })
    .then(call => {
      console.log(`Llamada realizada con SID: ${call.sid}`);
      res.status(200).send({ message: 'Llamada realizada con éxito', callSid: call.sid });
    })
    .catch(err => {

  })
})

// Iniciar servidor
server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
