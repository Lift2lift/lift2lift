import { DriverVerificationScreen } from '@lift2lift/app';
import { useLocalSearchParams } from 'expo-router';

export default function Page() {
  const q = useLocalSearchParams<{ then?: string }>();
  return <DriverVerificationScreen then={q.then} />;
}
