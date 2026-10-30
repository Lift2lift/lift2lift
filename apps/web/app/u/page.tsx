'use client';

import { ProfileScreen } from '@lift2lift/app';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function Screen() {
  const q = useSearchParams();
  return <ProfileScreen userId={q.get('id') ?? undefined} />;
}

export default function Page() {
  return (
    <Suspense>
      <Screen />
    </Suspense>
  );
}
