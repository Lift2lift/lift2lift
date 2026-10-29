import { ForgotPasswordScreen } from '@lift2lift/app';
import { useLocalSearchParams } from 'expo-router';

export default function Page() {
  const q = useLocalSearchParams<{ email?: string }>();
  return <ForgotPasswordScreen initialEmail={q.email ?? ''} />;
}
