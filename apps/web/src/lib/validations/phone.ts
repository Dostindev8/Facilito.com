/** Dominican mobile prefixes. Landlines are rejected on purpose: the field is a WhatsApp number. */
const RD_MOBILE = /^(809|829|849)\d{7}$/;
const MAX_RAW_LENGTH = 24;

export function normalizeRdPhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_RAW_LENGTH) return null;
  const digits = trimmed.replace(/\D/g, '');
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (!RD_MOBILE.test(local)) return null;
  return `+1${local}`;
}
