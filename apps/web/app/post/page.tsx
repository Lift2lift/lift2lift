'use client';

import { PostRideScreen } from '@lift2lift/app';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function Screen() {
  const q = useSearchParams();
  return <PostRideScreen key={q.get('edit') ?? 'new'} initialResort={q.get('resort') ?? undefined} editRideId={q.get('edit') ?? undefined} />;
}

export default function Page() {
  return (
    <Suspense>
      <Screen />
    </Suspense>
  );
}
