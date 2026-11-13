// One definition of the invitation access code, imported by the browser, the native app and the
// server so a code is read exactly the same way everywhere. The code is a second factor next to the
// random link capability; it never replaces it.
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 8;
const CODE = /^[A-HJ-NP-Z2-9]{8}$/;
// Spaces, any dash, invisible format characters (zero-width, bidi marks, soft hyphen) and the
// middle dot variants a chat app may insert are cosmetic.
const SEPARATORS = /[\s\p{Cf}\p{Pd}−·•._]+/gu;
// Full-width and compatibility forms fold to ASCII first. Only ASCII a–z is uppercased, so no
// locale or special-casing rule can turn other text into a valid symbol.
export function normalizeCode(value) {
  if (typeof value !== 'string' || value.length > 128) return '';
  return value.normalize('NFKC').replace(SEPARATORS, '').replace(/[a-z]/g, c => c.toUpperCase());
}
export const validCode = value => CODE.test(value);
export const formatCode = value => `${value.slice(0, 4)}-${value.slice(4)}`;
// Returns the display form of a complete code, or '' when the text is not exactly one code.
export function readCode(value) {
  const code = normalizeCode(value);
  return validCode(code) ? formatCode(code) : '';
}

const TOKEN = /[A-Za-z0-9_-]{43}/;
const LINK = /https?:\/\/[^\s<>"'`]+\/join#([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/;
export function findInvitationLink(text) {
  const link = LINK.exec(typeof text === 'string' ? text.slice(0, 8192) : '');
  return link ? link[0].replace(/\)+$/, '') : '';
}
// Accepts a bare link, a bare 43-character key, or a whole pasted invitation message. The code is
// taken from a labelled line ("Adgangskode:" or "Code:", the code on the same or the next line), or from the single
// leftover code-shaped word after the link. Unlabelled words must contain a digit: ordinary words such as "december" or
// "Derefter" are made only of code symbols and must never be read as a code.
export function extractInvitation(text) {
  const raw = typeof text === 'string' ? text.slice(0, 8192) : '';
  const link = LINK.exec(raw);
  let token = link ? link[1] : '', rest = link ? raw.replace(link[0], ' ') : raw;
  if (!token) {
    const hash = raw.includes('#') ? raw.slice(raw.lastIndexOf('#') + 1).trim() : raw.trim();
    if (new RegExp(`^${TOKEN.source}$`).test(hash)) { token = hash; rest = ''; }
  }
  let code = '';
  const labelled = /\b(?:adgangskode|(?:access\s*)?code)\b\s*[:：=-]?\s*([^\n]{0,40})/i.exec(rest);
  if (labelled) code = readCode(labelled[1].trim().split(/\s{2,}|[,;]/)[0]);
  if (!code && token) {
    const words = rest.match(/(?<![\p{L}\p{N}])[\p{L}\p{N}]{4}[ \p{Pd}]?[\p{L}\p{N}]{4}(?![\p{L}\p{N}])/gu) || [];
    const found = words.filter(word => /\d/.test(word)).map(readCode).filter(Boolean);
    if (found.length === 1) code = found[0];
  }
  return { token, code };
}
