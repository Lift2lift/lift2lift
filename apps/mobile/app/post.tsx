import { PostRideScreen } from '@lift2lift/app';
import { useLocalSearchParams } from 'expo-router';

export default function Page() {
  const q = useLocalSearchParams<{ resort?: string }>();
  return <PostRideScreen initialResort={q.resort} />;
}
