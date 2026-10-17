/** Dominican mobile prefixes. Landlines are rejected on purpose: the field is a WhatsApp/contact line. */
const RD_MOBILE = /^(809|829|849)\d{7}$/;

export function normalizeRdPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (!RD_MOBILE.test(local)) return null;
  return `+1${local}`;
}
