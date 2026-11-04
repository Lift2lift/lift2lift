// Pure decision logic for license-check, kept apart so it can be tested without AWS.

export const MIN_SIMILARITY = 90;

export type IdField = { Type?: { Text?: string }; ValueDetection?: { Text?: string; NormalizedValue?: { Value?: string } } };

export function field(fields: IdField[], type: string) {
  const f = fields.find((x) => x.Type?.Text === type)?.ValueDetection;
  return (f?.NormalizedValue?.Value ?? f?.Text ?? '').trim();
}

/** Accepts Textract's normalized ISO value or a printed MM/DD/YYYY date. Returns YYYY-MM-DD, or null. */
export function parseDate(value: string) {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  return null;
}

/** Returns a failure code, or null when the license passes. A license is good through its expiry date. */
export function licenseProblem(fields: IdField[], today: string) {
  if (!field(fields, 'ID_TYPE').toUpperCase().includes('DRIVER')) return 'document_type_not_supported';
  const expires = parseDate(field(fields, 'EXPIRATION_DATE'));
  if (!expires) return 'document_unverified_other';
  return expires < today ? 'document_expired' : null;
}

/** JPEG and PNG are the only formats both AWS services accept. */
export function imageType(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  return null;
}
