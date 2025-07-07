import express from 'express';
import cors from 'cors';

const app = express();

app.use(cors());
app.use(express.json());

//creating controller map to store sessions
const activeControllers = new Map();

app.post('/api/chat', async (req, res) => {
  const { messages, model, sessionId } = req.body;
  
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  }

  if (activeControllers.has(sessionId)) {
    return res.status(409).json({
      error: 'Stream in progress. Use the cancel button to stop current stream first.'
    });
  }

  //mainly to keep track of conversations/streams so that if a cancel request is sent in, I know which stream to cancel.
  const controller = new AbortController();
  activeControllers.set(sessionId, controller);

  try {

    console.log("prepping messages to be sent to anthropic's api")
    console.log("messages: ", messages)

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 1000,
        messages: messages,
        stream: true
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      let currentEvent = null;
      
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          
          if (currentEvent === 'content_block_delta') {
            try {
              const parsed = JSON.parse(data);
              if (parsed.delta?.type === 'text_delta' && parsed.delta?.text) {
                res.write(`data: ${parsed.delta.text}\n\n`);
              }
            } catch (e) {
              // skip invalid JSONs from anthropic (lol)
              console.error("json from anthropic is invalid, skipping, ", e)
            }
          } else if (currentEvent === 'message_stop') {
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
          currentEvent = null;
        }
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    if (error.name === 'AbortError') {

      //if I don't check this, express will get mad because the stream is already sent back to the client and commit suicide.
      if(!res.headersSent) {
        return res.status(499).json({ message: 'Request cancelled' });
      } else {
        res.end();
        return;
      }

    }
    res.status(500).json({ error: error.message });
  } finally {
    if (activeControllers.has(sessionId)) {
      activeControllers.delete(sessionId)
    }
  }
});

app.post('/api/cancel', async (req, res) => {
  const { sessionId } = req.body 

  if (activeControllers.has(sessionId)) {
    const controller = activeControllers.get(sessionId);
    controller.abort();
    activeControllers.delete(sessionId);
    res.json({"success": true});
  } else {
    res.status(404).json({"error": "no active stream found."})
  }

}); 

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Make sure to set ANTHROPIC_API_KEY environment variable');
});
