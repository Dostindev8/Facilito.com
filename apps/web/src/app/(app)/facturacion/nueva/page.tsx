'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { ROLES, useAuth } from '@/lib/auth';
import { EmptyState } from '@/components/ui/primitives';
import { InvoiceEditor } from '@/components/invoices/invoice-editor';

export default function NewInvoicePage() {
  const router = useRouter();
  const { can } = useAuth();

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/facturacion" className="link-btn" style={{ marginBottom: 6 }}>
            <ArrowLeft size={16} /> Facturación
          </Link>
          <h1>Nueva factura</h1>
          <p>Los totales e ITBIS se calculan al instante; el servidor los verifica al emitir.</p>
        </div>
      </div>
      {can(ROLES.sell) ? (
        <InvoiceEditor mode="factura" onCreated={(inv) => router.push(`/facturacion/${inv.id}`)} />
      ) : (
        <div className="card">
          <EmptyState icon={<ArrowLeft size={24} />} title="Sin permiso" detail="Tu rol no puede emitir facturas. Pide acceso al dueño del negocio." />
        </div>
      )}
    </>
  );
}
