import { PostRideScreen } from '@lift2lift/app';
import { useLocalSearchParams } from 'expo-router';

export default function Page() {
  const q = useLocalSearchParams<{ resort?: string; edit?: string }>();
  return <PostRideScreen key={q.edit ?? 'new'} initialResort={q.resort} editRideId={q.edit} />;
}
