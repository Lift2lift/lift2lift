import { YourRidesScreen } from '@lift2lift/app';
import { useLocalSearchParams } from 'expo-router';

export default function Page() {
  const q = useLocalSearchParams<{ ride?: string; leg?: string; saved?: string }>();
  return <YourRidesScreen rideId={q.ride} leg={q.leg === 'to' || q.leg === 'from' ? q.leg : undefined} saved={q.saved} />;
}
