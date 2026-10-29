import { VerifyScreen } from '@lift2lift/app';
import { useLocalSearchParams } from 'expo-router';

export default function Page() {
  const q = useLocalSearchParams<{ email?: string }>();
  return <VerifyScreen email={q.email ?? ''} />;
}
