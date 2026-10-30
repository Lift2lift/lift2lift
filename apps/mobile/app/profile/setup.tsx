import { ProfileSetupScreen } from '@lift2lift/app';
import { useLocalSearchParams } from 'expo-router';

export default function Page() {
  const q = useLocalSearchParams<{ then?: string }>();
  return <ProfileSetupScreen then={q.then} />;
}
