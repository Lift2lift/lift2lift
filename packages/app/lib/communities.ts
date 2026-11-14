import { Platform, Share } from 'react-native';

export const COMMUNITY_CODE_LENGTH = 9;

/** Capitals and digits only, at most 9: what the person typed, ready to check. */
export function cleanCode(text: string) {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, COMMUNITY_CODE_LENGTH);
}

/** EMM4N9F4D → EMM-4N9-F4D, easier to read out loud and copy. */
export function formatCode(code: string) {
  return (cleanCode(code).match(/.{1,3}/g) ?? []).join('-');
}

/** On iPhone this opens the share sheet; on the web it copies to the clipboard. */
export async function shareOrCopy(message: string): Promise<'shared' | 'copied' | 'failed'> {
  if (Platform.OS === 'web') {
    try {
      await navigator.clipboard.writeText(message);
      return 'copied';
    } catch {
      return 'failed';
    }
  }
  try {
    await Share.share({ message });
    return 'shared';
  } catch {
    return 'failed';
  }
}
