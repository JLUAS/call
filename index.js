
// Importa las librerías necesarias
const express = require('express');
const twilio = require('twilio');
const app = express();
const fs = require('fs');
const fetch = require('node-fetch');
const port = 3000;
const filePath = "./dataset.jsonl";
const dotenv = require('dotenv')
// Tu SID de cuenta y Token de autenticación de Twilio
dotenv.config();

const twilioPhoneNumber = process.env.TWILIO_PHONE;
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL_ID;
const VoiceResponse = twilio.twiml.VoiceResponse; // Twilio VoiceResponse

const client = new twilio(accountSid, authToken);

const bodyParser = require('body-parser');
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const { OpenAI } = require('openai'); // Importar correctamente la clase OpenAI

// Inicializar el cliente OpenAI con la API key
const openai = new OpenAI({
  apiKey: apiKey
});


let context = [
  { role: 'system', content: 'Eres un asistente del banco Choche especializado en terminales de pago.' }
];
let nombreUsuario = null; // Variable para almacenar el nombre del usuario

app.post('/process-speech', async (req, res) => {
  const userSpeech = req.body.SpeechResult; // Entrada del usuario transcrita por Twilio
  console.log(`Usuario dijo: ${userSpeech}`);

  let botResponse = '';

  try {
    // Mantener el flujo natural de la conversación
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

    // Detectar y guardar el nombre del usuario si es proporcionado
    if (!nombreUsuario && userSpeech.toLowerCase().includes('mi nombre es')) {
      const match = userSpeech.match(/mi nombre es (\w+)/i);
      if (match && match[1]) {
        nombreUsuario = match[1]; // Guardar el nombre del usuario
        console.log(`Nombre detectado: ${nombreUsuario}`);
      }
    }

    // Responder al usuario con la respuesta generada
    const response = new VoiceResponse();
    response.say({ voice: 'alice', language: 'es-MX' }, botResponse);

    // Continuar la conversación si es necesario
    response.gather({
      input: 'speech',
      action: '/process-speech', // Acción para continuar procesando la entrada
      language: 'es-MX',
      hints: 'soporte técnico, ventas, consulta, terminales, banco Choche, terminal',
      timeout: 5, // Tiempo de espera para una respuesta del usuario
    });

    response.say('No escuché nada. Por favor, repite tu solicitud.');

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    console.error('Error al generar respuesta:', error);

    // Respuesta de error en caso de que falle la interacción
    const response = new VoiceResponse();
    response.say({ voice: 'alice', language: 'es-MX' }, 'Lo siento, hubo un problema. Por favor, intenta de nuevo.');

    res.type('text/xml');
    res.send(response.toString());
  }
});



// Ruta para realizar la llamada saliente
app.get('/call', (req, res) => {
  client.calls.create({
    to: '+528662367673',  // Número al que deseas llamar
    from: twilioPhoneNumber,  // Tu número de Twilio
    url: 'https://call-t0fi.onrender.com/voice',  // URL que Twilio usará para obtener las instrucciones
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

app.post('/voice', (req, res) => {
  const response = new VoiceResponse();

  // Instrucciones iniciales
  response.say({ voice: 'alice', language: 'es-MX' }, 'Hola, soy tu asistente virtual. ¿En qué puedo ayudarte?');

  // Captura la respuesta del usuario con reconocimiento de voz
  response.gather({
    input: 'speech',
    action: '/process-speech',  // Endpoint para procesar la entrada del usuario
    language: 'es-MX',
    hints: 'soporte técnico, ventas, consulta, santander, banco, punto de venta, terminal, informacion',
  });

  res.type('text/xml');
  res.send(response.toString());
});

// Hacer llamadas periódicas cada 60 segundos
setInterval(() => {
  client.calls.create({
    to: '+528662367673',  // Número al que deseas llamar
    from: twilioPhoneNumber,  // Tu número de Twilio
    url: 'https://call-t0fi.onrender.com/voice',  // URL que Twilio usará para obtener las instrucciones
  })
  .then(call => {
    console.log(`Llamada realizada con SID: ${call.sid}`);
  })
  .catch(err => {
    console.error('Error al hacer la llamada:', err);
  });
}, 30000);

// Inicia el servidor
app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});
