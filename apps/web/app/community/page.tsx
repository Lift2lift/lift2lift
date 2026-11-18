'use client';

import { CommunityScreen } from '@lift2lift/app';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function Screen() {
  const q = useSearchParams();
  const id = q.get('id') ?? undefined;
  return <CommunityScreen key={id} communityId={id} welcome={q.get('welcome') ?? undefined} view={q.get('view') ?? undefined} />;
}

export default function Page() {
  return (
    <Suspense>
      <Screen />
    </Suspense>
  );
}
