import type { ListeningMaterialItem } from '../types/overview';

function uniqueWords(words: string[]): string[] {
  return [...new Set(words.map((word) => word.trim()).filter(Boolean))];
}

export function extractEnglishWords(raw: string): string[] {
  const lineTokens = raw
    .split(/[\n,;，；、]+/)
    .flatMap((chunk) => chunk.match(/[A-Za-z][A-Za-z' -]*/g) ?? [])
    .map((word) => word.trim().replace(/\s+/g, ' '));

  return uniqueWords(lineTokens);
}

export interface ListeningInputPair {
  english: string;
  chinese: string;
}

export function extractListeningPairs(raw: string): ListeningInputPair[] {
  const pairs: ListeningInputPair[] = [];
  const lines = raw.replace(/\r\n/g, '\n').split('\n');

  for (const line of lines) {
    const text = line.trim();
    if (!text) continue;

    const chunks = text.split(/[,，;；、/|]+/).map((chunk) => chunk.trim()).filter(Boolean);
    for (const chunk of chunks) {
      const englishMatch = chunk.match(/[A-Za-z][A-Za-z' -]*/)?.[0]?.trim() ?? '';
      const chineseMatch = chunk.match(/[\u4e00-\u9fff][\u4e00-\u9fff（）()【】《》、，。！？：；\s-]*/)?.[0]?.trim() ?? '';

      if (!englishMatch && !chineseMatch) continue;

      if (englishMatch) {
        pairs.push({ english: englishMatch, chinese: chineseMatch });
      }
    }
  }

  return pairs;
}

async function translateViaGoogle(word: string): Promise<string> {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(word)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('google translate failed');
  const payload = (await response.json()) as unknown[];
  const rows = Array.isArray(payload[0]) ? (payload[0] as unknown[]) : [];
  return rows
    .map((row) => (Array.isArray(row) ? String(row[0] ?? '') : ''))
    .join('')
    .trim();
}

async function translateViaMyMemory(word: string): Promise<string> {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|zh-CN`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('mymemory translate failed');
  const payload = (await response.json()) as {
    responseData?: { translatedText?: string };
  };
  return payload.responseData?.translatedText?.trim() ?? '';
}

async function translateViaBackend(word: string): Promise<string> {
  const response = await fetch(`/api/translate/en-zh?text=${encodeURIComponent(word)}`);
  if (!response.ok) throw new Error('backend translate failed');
  const payload = (await response.json()) as { translated?: string };
  return payload.translated?.trim() ?? '';
}

async function translateWord(word: string): Promise<string> {
  for (const translator of [translateViaBackend, translateViaGoogle, translateViaMyMemory]) {
    try {
      const translated = await translator(word);
      if (translated) return translated;
    } catch {
      // Try next provider.
    }
  }
  return '';
}

export async function buildListeningMaterials(raw: string): Promise<ListeningMaterialItem[]> {
  const pairs = extractListeningPairs(raw);
  const unique = uniqueWords(
    pairs.map((pair) => pair.english).filter(Boolean),
  );
  const pairMap = new Map(pairs.filter((pair) => pair.english).map((pair) => [pair.english.toLowerCase(), pair.chinese]));
  const translated = await Promise.all(
    unique.map(async (word, index) => ({
      id: `listen_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 5)}`,
      english: word,
      chinese: pairMap.get(word.toLowerCase())?.trim() || await translateWord(word),
    })),
  );
  return translated;
}
