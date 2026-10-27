// Optional Claude vision recognition (spec 3.7). Only called when the user set an API key; null always means "use the offline reading".
import { classifyLine } from '../math/parse.js';

const TIMEOUT_MS = 8000, FUNCS = ['sqrt', 'sin', 'cos', 'tan', 'log', 'ln'];
const SYSTEM_PROMPT = `You transcribe one line of handwritten math from an image. Reply with ONLY the line, no prose, no LaTeX, no code fences.
Use only: digits, + - × ÷ / * ^ ( ) = . √ π, single letters, and the function names sin cos tan log ln sqrt.
Write raised exponents as ^( … ), for example x^(2). A straight cross between two numbers is ×. The variable is x.`;

// Defensive clean-up, then accept only a reply in the token grammar that reads as a math line.
export function cleanReply(text) {
  const s = String(text ?? '').replace(/```(?:[a-z]+\n|(?:text|math|plaintext)\s)/g, '').replace(/[`\s]/g, '');
  const words = (s.match(/[a-z]+/g) ?? []).every((w) => w.length === 1 || FUNCS.includes(w)); // "itsays2+3=" is prose
  return words && /^[\d.+\-−×÷/*^()=√πa-z]+$/.test(s) && classifyLine(s).kind !== 'text' ? s : null;
}

export async function transcribeLine(pngBase64, { apiKey, model = 'claude-opus-5-5' } = {}) {
  if (!apiKey) return null;
  let Anthropic = null;
  try {
    ({ default: Anthropic } = await import('../../vendor/anthropic-sdk.mjs')); // loaded only once a key is set (~340 KB)
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0 });
    let timer;
    const hang = new Promise((_, no) => { timer = setTimeout(() => no(new Error('timeout')), TIMEOUT_MS); });
    const call = client.beta.messages.create({
      model, max_tokens: 4096, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', output_config: { effort: 'low' },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: pngBase64 } },
        { type: 'text', text: 'Transcribe this handwritten math line.' },
      ] }],
    }, { timeout: TIMEOUT_MS });
    call.catch(() => {}); // the race may already be over
    let res;
    try { res = await Promise.race([call, hang]); } finally { clearTimeout(timer); }
    if (res.stop_reason === 'refusal') return null;
    return cleanReply(res.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
  } catch (e) {
    // debug only; the key is never logged
    if (Anthropic && e instanceof Anthropic.APIError) console.debug('easyNote: Claude error', e.status);
    else console.debug('easyNote: Claude unavailable', e?.name);
    return null;
  }
}
