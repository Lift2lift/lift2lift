/** Turn Supabase errors into sentences a person can act on. */
export function friendlyError(error: unknown): string {
  const message = (error as { message?: string } | null)?.message ?? String(error ?? '');
  const m = message.toLowerCase();

  if (m.includes('invalid login credentials')) return "That email and password don't match. Check for typos or reset your password.";
  if (m.includes('email not confirmed')) return 'Confirm your email first. Enter the code we sent you.';
  if (m.includes('user already registered')) return 'An account with that email already exists. Sign in instead.';
  if (m.includes('token has expired') || m.includes('otp_expired') || m.includes('invalid otp') || m.includes('token is invalid'))
    return "That code didn't work or has expired. Request a new one.";
  if (m.includes('rate limit') || m.includes('too many') || m.includes('for security purposes'))
    return 'Too many tries. Wait a minute, then try again.';
  if (m.includes('password should be') || m.includes('weak password'))
    return 'Pick a stronger password: at least 8 characters with letters and numbers.';
  if (m.includes('should be different')) return 'Your new password has to be different from your old one.';
  if (m.includes('network') || m.includes('failed to fetch'))
    return "Can't reach the server. Check your connection and try again.";
  if (m.includes('row-level security') || m.includes('permission denied'))
    return "You don't have permission to do that.";
  return message || 'Something went wrong. Try again.';
}

export class FriendlyError extends Error {}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
