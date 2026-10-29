import { RideBoardScreen } from '@lift2lift/app';
import { useLocalSearchParams } from 'expo-router';

export default function Page() {
  const q = useLocalSearchParams<{ resort?: string; day?: string }>();
  return <RideBoardScreen initialResort={q.resort} initialDay={q.day} />;
}
