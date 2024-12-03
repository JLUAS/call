// Importa las librerías necesarias
const express = require('express');
const twilio = require('twilio');
const app = express();
const port = 3000;

// Tu SID de cuenta y Token de autenticación de Twilio
const accountSid = 'AC3622250a19f61ed3afa29a5597bebfa2';
const authToken = '4b65c19cf8e3b81ec5de988e8e4906d4';
const twilioPhoneNumber = 'TU_NUMERO_DE_TWILIO';

// Inicializa el cliente de Twilio
const client = new twilio(accountSid, authToken);

// Ruta para realizar la llamada saliente
app.get('/call', (req, res) => {
  client.calls.create({
    to: '+1234567890',  // Número al que deseas llamar
    from: twilioPhoneNumber,  // Tu número de Twilio
    url: 'http://demo.twilio.com/docs/voice.xml',  // URL que Twilio usará para obtener las instrucciones
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

// Ruta que manejará la respuesta de la llamada
app.post('/voice', (req, res) => {
  const response = new VoiceResponse();
  response.say('Hola, soy tu asistente virtual. ¿Cómo puedo ayudarte hoy?');
  res.type('text/xml');
  res.send(response.toString());
});

// Hacer llamadas periódicas cada 60 segundos
setInterval(() => {
  client.calls.create({
    to: '+1234567890',  // Número al que deseas llamar
    from: twilioPhoneNumber,  // Tu número de Twilio
    url: 'http://<tu-url-ngrok>/voice',  // URL que Twilio usará para obtener las instrucciones (usando ngrok)
  })
  .then(call => {
    console.log(`Llamada realizada con SID: ${call.sid}`);
  })
  .catch(err => {
    console.error('Error al hacer la llamada:', err);
  });
}, 60000);  // Realiza una llamada cada 60 segundos (60000 ms)

// Inicia el servidor
app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});