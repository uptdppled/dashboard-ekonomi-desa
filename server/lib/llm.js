// Free-tier LLM providers, tried in order. Each has its own daily/per-minute
// rate limit on the free tier, so falling through to the next configured
// provider on failure (rate limit, outage, ...) meaningfully improves
// reliability for a low-volume internal tool like this, at zero extra cost.
// Anthropic is included as an optional paid fallback for anyone who later
// adds a key; it's never required. Shared by both the per-desa and
// per-kabupaten recommendation features.
const PROVIDERS = [
  { name: 'groq', envKey: 'GROQ_API_KEY', call: callGroq },
  { name: 'gemini', envKey: 'GEMINI_API_KEY', call: callGemini },
  { name: 'anthropic', envKey: 'ANTHROPIC_API_KEY', call: callAnthropic },
];

async function callGroq(prompt) {
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.4,
    }),
  });
  if (!res.ok) throw new Error(`Groq API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return { text: data.choices[0].message.content, model: `groq/${model}` };
}

async function callGemini(prompt) {
  const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  // Reasoning-capable Gemini models can attach thinking metadata to parts;
  // only join parts that carry actual displayable text.
  const text = (data.candidates?.[0]?.content?.parts || [])
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
  if (!text) throw new Error('Gemini API mengembalikan respons kosong (kemungkinan diblokir oleh safety filter)');
  return { text, model: `gemini/${model}` };
}

async function callAnthropic(prompt) {
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { text, model: `anthropic/${model}` };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Respons AI bukan JSON valid');
  }
}

export async function callLLM(prompt) {
  const configured = PROVIDERS.filter((p) => process.env[p.envKey]);
  if (configured.length === 0) {
    const err = new Error(
      'Belum ada provider AI yang diatur. Isi salah satu dari GROQ_API_KEY, GEMINI_API_KEY, atau ANTHROPIC_API_KEY di server/.env'
    );
    err.code = 'NO_API_KEY';
    throw err;
  }

  const errors = [];
  for (const provider of configured) {
    try {
      const { text, model } = await provider.call(prompt);
      return { result: parseJson(text), model };
    } catch (err) {
      errors.push(`${provider.name}: ${err.message}`);
    }
  }
  throw new Error(`Semua provider AI gagal -\n${errors.join('\n')}`);
}
