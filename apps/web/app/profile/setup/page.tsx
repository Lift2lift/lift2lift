'use client';

import { ProfileSetupScreen } from '@lift2lift/app';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function Screen() {
  const q = useSearchParams();
  return <ProfileSetupScreen then={q.get('then') ?? undefined} verifyDone={q.get('verify') === 'done'} />;
}

export default function Page() {
  return (
    <Suspense>
      <Screen />
    </Suspense>
  );
}
