import sanitizeHtml from 'sanitize-html';

export function sanitizeText(value: string): string {
  return sanitizeHtml(value, {
    allowedTags: [],
    allowedAttributes: {}
  }).trim();
}

export function sanitizeRichText(value: string): string {
  return sanitizeHtml(value, {
    allowedTags: ['b', 'i', 'em', 'strong', 'a', 'code', 'pre', 'p', 'br', 'ul', 'ol', 'li'],
    allowedAttributes: {
      a: ['href', 'target', 'rel']
    },
    allowedSchemes: ['http', 'https', 'mailto']
  }).trim();
}
