'use client';

import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/primitives';
import { PartiesView, SUPPLIERS } from '@/components/parties/parties-view';

export default function SuppliersPage() {
  return (
    <Suspense fallback={<Skeleton h={300} />}>
      <PartiesView config={SUPPLIERS} />
    </Suspense>
  );
}
