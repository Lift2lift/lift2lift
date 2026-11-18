import { PostRideScreen } from '@lift2lift/app';
import { useLocalSearchParams } from 'expo-router';

export default function Page() {
  const q = useLocalSearchParams<{ resort?: string; edit?: string; community?: string; event?: string; day?: string }>();
  return <PostRideScreen key={q.edit ?? 'new'} initialResort={q.resort} editRideId={q.edit} initialCommunity={q.community} initialEvent={q.event} initialDay={q.day} />;
}
