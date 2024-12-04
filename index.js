// Importar librerías necesarias
const Fastify = require('fastify');
const twilio = require('twilio');
const WebSocket = require('ws');
const dotenv = require('dotenv');

// Cargar variables de entorno
dotenv.config();

// Twilio credenciales
const twilioPhoneNumber = process.env.TWILIO_PHONE;
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = new twilio(accountSid, authToken);

// OpenAI credenciales
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('Falta la clave API de OpenAI. Por favor, configúrala en el archivo .env');
  process.exit(1);
}

// Inicializar Fastify
const fastify = Fastify();

// Twilio VoiceResponse
const { VoiceResponse } = twilio.twiml;

// Ruta para llamadas salientes
fastify.get('/call', async (request, reply) => {
  const toNumber = request.query.to || '+528662367673'; // Número por defecto
  try {
    const call = await client.calls.create({
      to: toNumber,
      from: twilioPhoneNumber,
      url: `${process.env.PUBLIC_URL}/voice`, // URL para instrucciones de llamada
    });
    reply.send(`Llamada realizada: SID ${call.sid}`);
  } catch (err) {
    console.error('Error al realizar la llamada:', err);
    reply.status(500).send('Error al realizar la llamada');
  }
});

// Ruta para manejar Twilio webhook de voz
fastify.post('/voice', async (request, reply) => {
  const response = new VoiceResponse();

  response.say({ voice: 'alice', language: 'es-MX' }, 'Hola, soy tu asistente virtual. ¿En qué puedo ayudarte?');

  response.gather({
    input: 'speech',
    action: '/process-speech', // Enlace al procesamiento del habla
    language: 'es-MX',
    hints: 'soporte técnico, ventas, consulta',
  });

  reply.type('text/xml').send(response.toString());
});

// Ruta para procesar la respuesta del usuario
fastify.post('/process-speech', async (request, reply) => {
  const userSpeech = request.body.SpeechResult;
  console.log(`Usuario dijo: ${userSpeech}`);

  try {
    // Llamar a ChatGPT para obtener una respuesta
    const gptResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'Eres un asistente virtual amable y profesional.' },
          { role: 'user', content: userSpeech },
        ],
      }),
    }).then((res) => res.json());

    const botResponse = gptResponse.choices[0].message.content;
    console.log(`Respuesta de ChatGPT: ${botResponse}`);

    // Respuesta al usuario
    const response = new VoiceResponse();
    response.say({ voice: 'alice', language: 'es-MX' }, botResponse);

    response.gather({
      input: 'speech',
      action: '/process-speech', // Permitir más interacción
      language: 'es-MX',
    });

    reply.type('text/xml').send(response.toString());
  } catch (error) {
    console.error('Error al procesar la respuesta:', error);

    const response = new VoiceResponse();
    response.say({ voice: 'alice', language: 'es-MX' }, 'Lo siento, hubo un problema. Por favor, intenta de nuevo.');
    reply.type('text/xml').send(response.toString());
  }
});

// Servidor en escucha
const PORT = process.env.PORT || 3000;
fastify.listen({ port: PORT }, (err) => {
  if (err) {
    console.error('Error al iniciar el servidor:', err);
    process.exit(1);
  }
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
