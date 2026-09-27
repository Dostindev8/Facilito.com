'use client';

import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/primitives';
import { CUSTOMERS, PartiesView } from '@/components/parties/parties-view';

export default function CustomersPage() {
  return (
    <Suspense fallback={<Skeleton h={300} />}>
      <PartiesView config={CUSTOMERS} />
    </Suspense>
  );
}
