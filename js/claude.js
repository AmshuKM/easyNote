// Optional cloud recognition with Claude (vision). Only used when the user
// adds their own Anthropic API key in Settings; the key stays in this browser.
// The official SDK, bundled for the browser (see scripts/build-sdk.sh).
const SDK_URL = new URL('../vendor/anthropic-sdk.min.js', import.meta.url).href;

let sdkPromise = null;
let client = null;
let clientKey = null;

async function getClient(apiKey) {
  if (!sdkPromise) sdkPromise = import(SDK_URL);
  const { default: Anthropic } = await sdkPromise;
  if (!client || clientKey !== apiKey) {
    // The key belongs to the person using this page and is sent straight to the API.
    client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    clientKey = apiKey;
  }
  return client;
}

const SYSTEM = `You read one line of handwriting from a whiteboard image and transcribe it.
Reply with the transcription only — no explanation, no quotes, no LaTeX, no code fences.
For math, use plain ASCII: * for multiplication, / for division, ^ for powers (wrap
superscripts as ^(...)), sqrt(...) for roots, pi for π. Keep "=" signs exactly where they are,
including a trailing "=". A handwritten "x" is the variable x unless it clearly sits between two
numbers as a multiplication sign, in which case write *.`;

export async function transcribe(pngBase64, { apiKey, model, kind = 'math' }) {
  const anthropic = await getClient(apiKey);
  const msg = await anthropic.beta.messages.create({
    model,
    max_tokens: 2048,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: pngBase64 } },
        { type: 'text', text: kind === 'math' ? 'Transcribe this handwritten math line.' : 'Transcribe this handwritten text line.' },
      ],
    }],
  });
  if (msg.stop_reason === 'refusal') throw new Error('Claude declined to transcribe this line');
  return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim().split('\n')[0];
}
