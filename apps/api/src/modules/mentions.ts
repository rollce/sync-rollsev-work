const mentionRegex = /@([a-zA-Z0-9._-]{2,64})/g;

export function extractMentions(content: string): string[] {
  const mentions = new Set<string>();
  let match = mentionRegex.exec(content);

  while (match) {
    mentions.add(match[1].toLowerCase());
    match = mentionRegex.exec(content);
  }

  return Array.from(mentions);
}
