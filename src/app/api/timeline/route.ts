import { GenChunk, ModelSocket } from "modelsocket";
import { z } from "zod";

const SYSTEM_PROMPT = "You are a helpful assistant.\n\n";
const LLAMA_8B = "meta/llama3.1-8b-instruct-free";
const LLAMA_70B = "internal/meta/llama3.3-70b-instruct";

// spawn a separate seq to classify the input as historical or not
async function isEventHistorical(socket: ModelSocket, event: string) {
  const classifier = await socket.open(LLAMA_8B);

  try {
    await classifier.append(SYSTEM_PROMPT, { role: "system" });
    await classifier.append(
      `does "${event}" refer to a historical event? (please just answer "yes" or "no", no other text including punctuation)\n`,
      { hidden: true, role: "user" }
    );

    let classifyResp = (await classifier.gen({ role: "assistant" }).text())
      .trim()
      .toLowerCase();

    return classifyResp === "yes";
  } finally {
    // make sure this seq is closed
    classifier.close();
  }
}

export async function POST(request: Request) {
  let body: any;

  try {
    body = await request.json();
  } catch (errorResponse: any) {
    return errorResponse;
  }

  const socket = await ModelSocket.connect(
    process.env.MODELSOCKET_URL || "wss://models.mixlayer.ai/ws"
  );

  // create a classifier to determine if the event is historical or not
  const isHistorical = await isEventHistorical(socket, body.params.event);

  const llama = await socket.open(LLAMA_8B);
  await llama.append(SYSTEM_PROMPT, { role: "system" });

  let stream;

  // If the event is not historical, we need to decline to answer.
  if (!isHistorical) {
    await llama.append(
      `can you write a message politely declining to answer and explaining why it isn't a historical event? Format the message as a json object with a single field "rejection" containing the message.\n`,
      { hidden: true, role: "user" }
    );

    stream = llama.gen({ role: "assistant" }).stream();
  } else {
    // First ask the model to produce a summary of the event in plain text, then ask
    // it to format its response as JSON.

    await llama.append(
      `What are the key events of the historical event: ${body.params.event}? Please include date or time information where possible.\n`,
      { hidden: true, role: "user" }
    );

    const initialEventSummary = await llama.gen({ role: "assistant" }).text();

    await llama.append(
      '\n\nCan you reformulate this timeline as a JSON object with a single "events" field, with each object in "events" having 2 fields, one for the' +
        ' time range ("timeRange") and one for the detailed description of the time frame ("description")?\n\n',
      { hidden: true, role: "user" }
    );

    await llama.append("```json\n", { hidden: true, role: "assistant" });

    stream = llama.gen({ role: "assistant" }).stream();
  }

  const sseStream = new ReadableStream({
    async start(controller) {
      const reader = stream.getReader();
      const encoder = new TextEncoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          if (value.hidden) {
            continue;
          }

          // Assuming GenChunk has a 'text' property
          const sseFormattedChunk = `data: ${JSON.stringify({
            type: "text",
            text: value.text,
          })}\n\n`;

          controller.enqueue(encoder.encode(sseFormattedChunk));
        }

        const sseEnd = `data: ${JSON.stringify({
          done: true,
        })}\n\n`;

        controller.enqueue(encoder.encode(sseEnd));
      } catch (error) {
        const sseError = `data: ${JSON.stringify({
          type: "error",
          text: `${error}`,
        })}\n\n`;
        controller.enqueue(encoder.encode(sseError));
        controller.error(error);
      } finally {
        reader.releaseLock();
        controller.close();
        socket.close();
      }
    },
  });

  return new Response(sseStream, {
    headers: {
      "X-Accel-Buffering": "no",
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}
