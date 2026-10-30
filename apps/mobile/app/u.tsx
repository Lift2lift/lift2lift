import { ProfileScreen } from '@lift2lift/app';
import { useLocalSearchParams } from 'expo-router';

export default function Page() {
  const q = useLocalSearchParams<{ id?: string }>();
  return <ProfileScreen userId={q.id} />;
}
