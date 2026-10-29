'use client';

import { DriverVerificationScreen } from '@lift2lift/app';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function Screen() {
  const q = useSearchParams();
  return <DriverVerificationScreen then={q.get('then') ?? undefined} />;
}

export default function Page() {
  return (
    <Suspense>
      <Screen />
    </Suspense>
  );
}
