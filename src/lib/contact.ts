export const CONTACT_ERROR = 'Enter a valid contact number (7–15 digits, e.g. +63 912 345 6789).';

// Same rule as the server's isValidContactNumber (worker/util.ts).
export function isValidContactNumber(value: string): boolean {
  if (!/^\+?[\d\s().-]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, '').length;
  return digits >= 7 && digits <= 15;
}

// True when an optional contact field holds something that isn't a valid number.
export function isInvalidContact(value: string): boolean {
  return value.trim() !== '' && !isValidContactNumber(value.trim());
}
