'use client';

import { RideBoardScreen } from '@lift2lift/app';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function Screen() {
  const q = useSearchParams();
  return <RideBoardScreen initialResort={q.get('resort') ?? undefined} initialDay={q.get('day') ?? undefined} />;
}

export default function Page() {
  return (
    <Suspense>
      <Screen />
    </Suspense>
  );
}
