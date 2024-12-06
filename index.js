import Fastify from 'fastify';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';

import twilio from 'twilio'
// Cargar las variables de entorno desde el archivo .env
dotenv.config();
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

// Recuperar la clave de OpenAI desde las variables de entorno
const { OPENAI_API_KEY } = process.env;

if (!OPENAI_API_KEY) {
    console.error('Falta la clave de OpenAI. Por favor, configúrela en el archivo .env.');
    process.exit(1);
}

// Inicializar Fastify
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);
const client = new twilio(accountSid, authToken);

// Constantes
const SYSTEM_MESSAGE = 'Eres un asistente útil y alegre que ama charlar sobre cualquier tema de interés del usuario, y está preparado para ofrecerles datos. Tienes predilección por los chistes de papá, los chistes de búhos y hacer "rickrolling" de forma sutil. Siempre mantén una actitud positiva, pero haz una broma cuando sea apropiado.';
const VOICE = 'alloy';
const PORT = process.env.PORT; // Permite la asignación dinámica del puerto

// Ruta raíz
fastify.get('/', async (request, reply) => {
    reply.send({ message: '¡Servidor de Twilio Media Stream funcionando!' });
});

// Ruta para que Twilio maneje las llamadas entrantes
fastify.all('/incoming-call', async (request, reply) => {
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                          <Response>
                              <Say voice="alice" language="es-MX">Por favor, espere mientras conectamos su llamada al asistente de voz A.I., impulsado por Twilio y la API en tiempo real de OpenAI.</Say>
                              <Pause length="1"/>
                              <Say voice="alice" language="es-MX">¡Puede empezar a hablar ahora!</Say>
                              <Connect>
                                  <Stream url="wss://${request.headers.host}/media-stream" />
                              </Connect>
                          </Response>`;

    reply.type('text/xml').send(twimlResponse);
});

// WebSocket para el stream de medios
fastify.register(async (fastify) => {
    fastify.get('/media-stream', { websocket: true }, (connection, req) => {
        console.log('Cliente conectado');

        let streamSid = null;
        let latestMediaTimestamp = 0;
        let lastAssistantItem = null;
        let markQueue = [];
        let responseStartTimestampTwilio = null;

        const openAiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "OpenAI-Beta": "realtime=v1"
            }
        });

        const initializeSession = () => {
            const sessionUpdate = {
                type: 'session.update',
                session: {
                    turn_detection: { type: 'server_vad' },
                    input_audio_format: 'g711_ulaw',
                    output_audio_format: 'g711_ulaw',
                    voice: VOICE,
                    instructions: SYSTEM_MESSAGE,
                    modalities: ["text", "audio"],
                    temperature: 0.8,
                }
            };

            console.log('Enviando actualización de sesión:', JSON.stringify(sessionUpdate));
            openAiWs.send(JSON.stringify(sessionUpdate));
        };

        const sendInitialConversationItem = () => {
            const initialConversationItem = {
                type: 'conversation.item.create',
                item: {
                    type: 'message',
                    role: 'user',
                    content: [
                        {
                            type: 'input_text',
                            text: 'Saluda al usuario diciendo "¡Hola! Soy un asistente de voz AI impulsado por Twilio y la API en tiempo real de OpenAI. Puedes pedirme datos, chistes o cualquier cosa que imagines. ¿Cómo puedo ayudarte?"'
                        }
                    ]
                }
            };

            openAiWs.send(JSON.stringify(initialConversationItem));
            openAiWs.send(JSON.stringify({ type: 'response.create' }));
        };

        // Controlar eventos de la respuesta de OpenAI
        openAiWs.on('open', () => {
            console.log('Conectado a la API en tiempo real de OpenAI');
            setTimeout(initializeSession, 100);
        });

        openAiWs.on('message', (data) => {
            try {
                const response = JSON.parse(data);

                if (response.type === 'response.audio.delta' && response.delta) {
                    const audioDelta = {
                        event: 'media',
                        streamSid: streamSid,
                        media: { payload: Buffer.from(response.delta, 'base64').toString('base64') }
                    };
                    connection.send(JSON.stringify(audioDelta));

                    if (!responseStartTimestampTwilio) {
                        responseStartTimestampTwilio = latestMediaTimestamp;
                    }

                    if (response.item_id) {
                        lastAssistantItem = response.item_id;
                    }

                    sendMark(connection, streamSid);
                }
            } catch (error) {
                console.error('Error procesando mensaje de OpenAI:', error, 'Mensaje crudo:', data);
            }
        });

        connection.on('message', (message) => {
            try {
                const data = JSON.parse(message);

                switch (data.event) {
                    case 'media':
                        latestMediaTimestamp = data.media.timestamp;
                        if (openAiWs.readyState === WebSocket.OPEN) {
                            const audioAppend = {
                                type: 'input_audio_buffer.append',
                                audio: data.media.payload
                            };
                            openAiWs.send(JSON.stringify(audioAppend));
                        }
                        break;
                    case 'start':
                        streamSid = data.start.streamSid;
                        responseStartTimestampTwilio = null;
                        latestMediaTimestamp = 0;
                        break;
                    default:
                        console.log('Evento no relacionado con medios:', data.event);
                        break;
                }
            } catch (error) {
                console.error('Error al procesar mensaje:', error, 'Mensaje:', message);
            }
        });

        connection.on('close', () => {
            if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
            console.log('Cliente desconectado.');
        });

        openAiWs.on('close', () => {
            console.log('Desconectado de la API en tiempo real de OpenAI');
        });

        openAiWs.on('error', (error) => {
            console.error('Error en el WebSocket de OpenAI:', error);
        });
    });
});

fastify.post('/make-call', (req, res) => {
  client.calls.create({
    to: '+528662367673', // Número de destino proporcionado
    from: twilioPhoneNumber, // Tu número de Twilio
    url: 'https://call-t0fi.onrender.com/incoming-call', // URL que Twilio usará para obtener las instrucciones
  })
    .then(call => {
      console.log('Llamada realizada con SID: ${call.sid}');
      res.status(200).send({ message: 'Llamada realizada con éxito', callSid: call.sid });
    })
    .catch(err => {
      console.error('Error al hacer la llamada:', err);
      res.status(500).send({ error: 'Error al realizar la llamada', details: err });
    });
});

fastify.listen({ port: PORT }, (err) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(`Servidor escuchando en el puerto ${PORT}`);
});
