import { CommunityScreen } from '@lift2lift/app';
import { useLocalSearchParams } from 'expo-router';

export default function Page() {
  const q = useLocalSearchParams<{ id?: string; welcome?: string; view?: string }>();
  return <CommunityScreen key={q.id} communityId={q.id} welcome={q.welcome} view={q.view} />;
}
