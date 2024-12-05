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
const publicDir = path.join(__dirname, 'public');

// Verificar y crear el directorio si no existe
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
  console.log('Directorio "public" creado.');
}

// Configurar Express para servir archivos estáticos desde el directorio público
app.use('/public', express.static(publicDir));

// Middleware para manejar JSON y datos codificados
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Ruta para procesar la respuesta de Twilio (entrada de voz)
app.post('/process-speech', async (req, res) => {
  const userSpeech = req.body.SpeechResult; // Entrada del usuario transcrita por Twilio
  console.log(`Usuario dijo: ${userSpeech}`);

  const despedidas = [
    "adiós", "hasta luego", "nos vemos", "bye", "me voy", "gracias, adiós", 
    "eso es todo, hasta luego", "ya terminé, gracias", "me tengo que ir"
  ];

  let botResponse = '';

  try {
    // Mantener el flujo natural de la conversación con GPT-3
    const gptResponse = await openai.chat.completions.create({
      model: model, // Cambia por tu modelo fine-tuned
      messages: [
        { role: 'system', content: 'Eres un asistente del banco Choche especializado en terminales de pago. Tu misión es ofrecer información clara y precisa sobre las terminales del banco, resolver dudas comunes y destacar sus beneficios frente a la competencia. Actúas como un asesor profesional que guía al cliente en la elección de la mejor solución para su negocio. Mantén siempre un tono cordial, profesional y persuasivo, pero sin ser invasivo. Si el cliente no está interesado, termina la conversación de manera educada y agradable.' },
        { role: 'user', content: userSpeech },
      ],
    });

    botResponse = gptResponse.choices[0].message.content;
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
        voice: 'shimmer',
        input: botResponse,
      }),
    });

    const audioBuffer = await audioResponse.buffer();

    // Generar un nombre único para el archivo de audio
    const audioFileName = `${uuidv4()}.mp3`;
    const audioFilePath = path.join(publicDir, audioFileName); // Guardar en el directorio "public"
    
    // Guardar el audio generado en el directorio público
    fs.writeFileSync(audioFilePath, audioBuffer);
    console.log(`Audio guardado en: ${audioFilePath}`);

    // Responder al usuario con el audio generado
    const response = new VoiceResponse();
    response.play(`https://call-t0fi.onrender.com/public/${audioFileName}`); // Reproducir el archivo de audio

    // Continuar la conversación si es necesario
    response.gather({
      input: 'speech',
      action: '/process-speech', // Acción para continuar procesando la entrada
      language: 'es-MX',
      timeout: 2, // Tiempo de espera para una respuesta del usuario
    });

    res.type('text/xml');
    res.send(response.toString());
    // Verificar si la entrada del usuario contiene una despedida
    if (despedidas.some(despedida => userSpeech.includes(despedida))) {
      return;
    }  
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
app.post('/voice', async (req, res) => {
  const response = new VoiceResponse();

  // Instrucciones iniciales a generar desde OpenAI
  let botResponse = '';
  try {
    // Usar OpenAI para generar la respuesta inicial
    const gptResponse = await openai.chat.completions.create({
      model: model, // Cambia por tu modelo fine-tuned si es necesario
      messages: [
        {
          role: 'system',
          content: 'Eres un asistente del banco Choche. Tu misión es ofrecer soporte claro sobre las terminales de pago y atender al cliente de forma profesional.',
        },
        {
          role: 'user',
          content: 'Hola, soy tu asistente virtual. ¿En qué puedo ayudarte?',
        },
      ],
    });

    // Obtener la respuesta de OpenAI
    botResponse = gptResponse.choices[0].message.content;
    console.log(`Respuesta generada por OpenAI: ${botResponse}`);
  } catch (error) {
    console.error('Error al generar la respuesta con OpenAI:', error);
    botResponse = 'Lo siento, hubo un error al procesar la solicitud. Intenta de nuevo más tarde.';
  }

  // Llamar a la API de OpenAI para convertir el texto en audio
  const audioResponse = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1', // Cambia si es necesario el modelo para texto a voz
      voice: 'shimmer',  // Cambia el tipo de voz si es necesario
      input: botResponse,
    }),
  });

  const audioBuffer = await audioResponse.buffer();
  const audioFileName = `${uuidv4()}.mp3`;
  const audioFilePath = path.join(publicDir, audioFileName); // Guardar el archivo en el directorio "public"

  // Guardar el archivo de audio generado
  fs.writeFileSync(audioFilePath, audioBuffer);
  console.log(`Audio guardado en: ${audioFilePath}`);

  // Reproducir el audio generado al usuario
  response.play(`https://call-t0fi.onrender.com/public/${audioFileName}`);

  // Capturar la respuesta del usuario
  response.gather({
    input: 'speech',
    action: '/process-speech',  // Endpoint para procesar la entrada del usuario
    language: 'es-MX',
    hints: 'soporte técnico, ventas, consulta, terminal, información, punto de venta',
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