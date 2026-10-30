import { ReviewScreen } from '@lift2lift/app';
import { useLocalSearchParams } from 'expo-router';

export default function Page() {
  const q = useLocalSearchParams<{ ride?: string }>();
  return <ReviewScreen rideId={q.ride} />;
}
