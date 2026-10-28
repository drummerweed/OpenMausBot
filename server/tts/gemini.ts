import type { Audio, Voice } from "./elevenlabs.ts";

export const GEMINI_VOICES: Voice[] = [
  { id: "Aoede", label: "Aoede (Warm, Thoughtful)", description: "Google Gemini expressive warm voice" },
  { id: "Puck", label: "Puck (Energetic, Bright)", description: "Google Gemini energetic, friendly voice" },
  { id: "Charon", label: "Charon (Deep, Calm)", description: "Google Gemini calm, resonant voice" },
  { id: "Fenrir", label: "Fenrir (Authoritative, Direct)", description: "Google Gemini confident, articulate voice" },
  { id: "Kore", label: "Kore (Relaxed, Natural)", description: "Google Gemini relaxed, conversational voice" },
];

function pcmToWav(pcmBuffer: Uint8Array, sampleRate = 24000, numChannels = 1): Uint8Array {
  const wavHeader = new Uint8Array(44);
  const view = new DataView(wavHeader.buffer);
  const dataLength = pcmBuffer.byteLength;

  // "RIFF"
  wavHeader.set([0x52, 0x49, 0x46, 0x46], 0);
  view.setUint32(4, 36 + dataLength, true);
  // "WAVE"
  wavHeader.set([0x57, 0x41, 0x56, 0x45], 8);
  // "fmt "
  wavHeader.set([0x66, 0x6d, 0x74, 0x20], 12);
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true); // ByteRate
  view.setUint16(32, numChannels * 2, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample
  // "data"
  wavHeader.set([0x64, 0x61, 0x74, 0x61], 36);
  view.setUint32(40, dataLength, true);

  const combined = new Uint8Array(44 + dataLength);
  combined.set(wavHeader, 0);
  combined.set(pcmBuffer, 44);
  return combined;
}

export async function listVoices(): Promise<Voice[]> {
  return GEMINI_VOICES;
}

export async function synthesize(text: string, voiceId: string, key: string): Promise<Audio> {
  const selectedVoice = GEMINI_VOICES.some((v) => v.id.toLowerCase() === voiceId.toLowerCase()) ? voiceId : "Aoede";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent?key=${encodeURIComponent(key)}`;

  const body = {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: selectedVoice,
          },
        },
      },
    },
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err: unknown) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error("Gemini voice timed out. Try again.");
    }
    throw new Error("Could not reach Google Gemini voice. Check your connection.");
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Google rejected the Gemini API key. Check your key in Settings.");
    }
    if (response.status === 429) {
      throw new Error("Google is rate-limiting Gemini audio. Wait a moment and try again.");
    }
    throw new Error(`Google Gemini speech failed (HTTP ${response.status}).`);
  }

  const json = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: {
            data?: string;
          };
        }>;
      };
    }>;
  };

  const audioB64 = json?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!audioB64) {
    throw new Error("Gemini returned empty speech data. Try again.");
  }

  const rawPcm = Uint8Array.from(Buffer.from(audioB64, "base64"));
  const wavBytes = pcmToWav(rawPcm, 24000, 1);

  return { bytes: wavBytes, mime: "audio/wav" };
}
