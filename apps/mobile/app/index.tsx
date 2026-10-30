import { RideBoardScreen } from '@lift2lift/app';
import { useLocalSearchParams } from 'expo-router';

export default function Page() {
  const q = useLocalSearchParams<{ resort?: string; day?: string; leg?: string }>();
  return <RideBoardScreen initialResort={q.resort} initialDay={q.day} initialLeg={q.leg} />;
}
