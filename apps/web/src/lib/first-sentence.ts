const SENTENCE_END = /^(.+?(?:[.!?](?=\s)|[。！？।។]))\s*(\S[\s\S]*)$/u;

export function splitFirstSentence(message: string): [string, string] {
  const match = SENTENCE_END.exec(message.trim());
  if (!match?.[1] || !match[2]) return [message, ""];
  return [match[1], match[2]];
}
