'use client';

import { YourRidesScreen } from '@lift2lift/app';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function Screen() {
  const q = useSearchParams();
  const leg = q.get('leg');
  return <YourRidesScreen rideId={q.get('ride') ?? undefined} leg={leg === 'to' || leg === 'from' ? leg : undefined} />;
}

export default function Page() {
  return (
    <Suspense>
      <Screen />
    </Suspense>
  );
}
