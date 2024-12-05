const express = require('express');
const twilio = require('twilio');
const fetch = require('node-fetch');
const fs = require('fs');
const dotenv = require('dotenv');
const { OpenAI } = require('openai');
const path = require('path');
const { v4: uuidv4 } = require('uuid'); // Para generar nombres únicos de archivos

const app = express();
const port = 3000;

// Cargar variables de entorno
dotenv.config();

const twilioPhoneNumber = process.env.TWILIO_PHONE;
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL_ID;
const VoiceResponse = twilio.twiml.VoiceResponse; // Twilio VoiceResponse

const client = new twilio(accountSid, authToken);
const openai = new OpenAI({
  apiKey: apiKey,
});

let context = [
  { role: 'system', content: 'Eres un asistente del banco Choche especializado en terminales de pago. Tu misión es ofrecer información clara y precisa sobre las terminales del banco, resolver dudas comunes y destacar sus beneficios frente a la competencia. Actúas como un asesor profesional que guía al cliente en la elección de la mejor solución para su negocio. Mantén siempre un tono cordial, profesional y persuasivo, pero sin ser invasivo. Si el cliente no está interesado, termina la conversación de manera educada y agradable.' },
];

// Configurar Express para servir archivos estáticos desde el directorio público
app.use('/public', express.static(path.join(__dirname, 'public')));

// Middleware para manejar JSON y datos codificados
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Ruta para procesar la respuesta de Twilio (entrada de voz)
app.post('/process-speech', async (req, res) => {
  const userSpeech = req.body.SpeechResult; // Entrada del usuario transcrita por Twilio
  console.log(`Usuario dijo: ${userSpeech}`);

  let botResponse = '';

  try {
    // Mantener el flujo natural de la conversación con GPT-3
    const gptResponse = await openai.chat.completions.create({
      model: model, // Cambia por tu modelo fine-tuned
      messages: [
        ...context,
        { role: 'user', content: userSpeech },
      ],
    });

    botResponse = gptResponse.choices[0].message.content;
    context.push({ role: 'assistant', content: botResponse });

    console.log(`Respuesta generada por ChatGPT: ${botResponse}`);

    // Llamada a la API de OpenAI para generar el audio de la respuesta
    const audioResponse = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        voice: 'alloy',
        input: botResponse,
      }),
    });

    const audioBuffer = await audioResponse.buffer();

    // Guardar el audio generado en el directorio público
    const audioFileName = `${uuidv4()}.mp3`;
    const audioFilePath = path.join(__dirname, 'public', audioFileName);
    fs.writeFileSync(audioFilePath, audioBuffer);

    console.log(`Audio guardado en: ${audioFilePath}`);

    // Responder al usuario con el audio generado
    const response = new VoiceResponse();
    response.play(`/public/${audioFileName}`); // Reproducir el archivo de audio

    // Continuar la conversación si es necesario
    response.gather({
      input: 'speech',
      action: '/process-speech', // Acción para continuar procesando la entrada
      language: 'es-MX',
      timeout: 5, // Tiempo de espera para una respuesta del usuario
    });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    console.error('Error al generar respuesta:', error);

    const response = new VoiceResponse();
    response.say({ voice: 'alice', language: 'es-MX' }, 'Lo siento, hubo un problema. Por favor, intenta de nuevo.');

    res.type('text/xml');
    res.send(response.toString());
  }
});

// Ruta para hacer la llamada saliente
app.get('/call', (req, res) => {
  client.calls.create({
    to: '+528662367673', // Número al que deseas llamar
    from: twilioPhoneNumber, // Tu número de Twilio
    url: 'https://call-t0fi.onrender.com/voice', // URL para procesar la llamada
  })
    .then(call => {
      console.log(`Llamada realizada con SID: ${call.sid}`);
      res.send(`Llamada realizada: ${call.sid}`);
    })
    .catch(err => {
      console.error('Error al hacer la llamada:', err);
      res.status(500).send('Error al hacer la llamada');
    });
});

// Ruta para manejar el inicio de la llamada
app.post('/voice', (req, res) => {
  const response = new VoiceResponse();

  // Instrucciones iniciales
  response.say({ voice: 'alice', language: 'es-MX' }, 'Hola, buen día. Le llamo del banco Choche debido a que vimos que su negocio cumple las características para disponer de una terminal. ¿Con quién tengo el gusto?');

  // Captura la respuesta del usuario con reconocimiento de voz
  response.gather({
    input: 'speech',
    action: '/process-speech', // Endpoint para procesar la entrada del usuario
    language: 'es-MX',
  });

  res.type('text/xml');
  res.send(response.toString());
});

// Inicia el servidor
app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});
