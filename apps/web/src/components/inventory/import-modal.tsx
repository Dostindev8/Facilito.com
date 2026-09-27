'use client';

import { useRef, useState, type DragEvent } from 'react';
import { CircleCheck, Download, FileSpreadsheet, TriangleAlert, Upload } from 'lucide-react';
import { api, apiBlob, downloadBlob, errorMessage } from '@/lib/api';
import { Modal, Spinner } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';

interface ImportResult {
  total: number;
  creados: number;
  errores: Array<{ fila: number; campo: string; mensaje: string }>;
}

const MAX_BYTES = 2 * 1024 * 1024;

export function ImportModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFile(null);
    setResult(null);
    setError(null);
  };

  const pick = (f: File | undefined | null) => {
    setResult(null);
    setError(null);
    if (!f) return;
    if (!/\.(csv|txt)$/i.test(f.name)) {
      setError('Sube un archivo .csv (en Excel: Archivo → Guardar como → CSV UTF-8).');
      return;
    }
    if (f.size > MAX_BYTES) {
      setError('El archivo supera 2 MB. Divide la importación en varios archivos.');
      return;
    }
    setFile(f);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    pick(e.dataTransfer.files?.[0]);
  };

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      const r = await api<ImportResult>('/v1/products/import', { method: 'POST', body: fd });
      setResult(r);
      if (r.creados > 0) {
        toast.success('Importación completada', `${r.creados} de ${r.total} productos creados`);
        onDone();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const template = async () => {
    try {
      downloadBlob(await apiBlob('/v1/products/import/template'), 'plantilla-productos.csv');
    } catch (e) {
      toast.error('No se pudo descargar la plantilla', errorMessage(e));
    }
  };

  const close = () => {
    reset();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title="Importar productos"
      subtitle="Carga masiva desde un archivo CSV compatible con Excel (hasta 2,000 filas)."
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>
            {result ? 'Cerrar' : 'Cancelar'}
          </button>
          {!result && (
            <button type="button" className="btn btn-primary" onClick={upload} disabled={!file || busy}>
              {busy ? <Spinner size={16} /> : <Upload size={16} />} Importar
            </button>
          )}
          {result && (
            <button type="button" className="btn btn-outline" onClick={reset}>
              Importar otro archivo
            </button>
          )}
        </>
      }
    >
      <div className="stack">
        <div className="row-between wrap">
          <p className="muted" style={{ fontSize: '0.9rem' }}>
            Columnas: <strong>nombre</strong>, <strong>precio_venta</strong> (obligatorias), sku, categoria, costo, stock, stock_minimo, stock_maximo, unidad,
            codigo_barras, proveedor, itbis.
          </p>
          <button type="button" className="btn btn-outline btn-sm" onClick={template}>
            <Download size={16} /> Descargar plantilla
          </button>
        </div>
        {!result && (
          <div
            className={`dropzone ${drag ? 'drag' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
            role="button"
            tabIndex={0}
            aria-label="Seleccionar archivo CSV"
          >
            <FileSpreadsheet size={32} className="text-green" aria-hidden />
            <strong style={{ color: 'var(--ink)' }}>{file ? file.name : 'Arrastra tu archivo aquí o haz clic para elegirlo'}</strong>
            <span>{file ? `${(file.size / 1024).toFixed(1)} KB` : 'Formato .csv · separador coma o punto y coma'}</span>
            <input ref={inputRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} tabIndex={-1} />
          </div>
        )}
        {error && (
          <div className="form-alert" role="alert">
            <TriangleAlert size={18} /> <span>{error}</span>
          </div>
        )}
        {result && (
          <>
            <div className={`form-alert ${result.errores.length ? 'warn' : 'success'}`} role="status">
              {result.errores.length ? <TriangleAlert size={18} /> : <CircleCheck size={18} />}
              <span>
                Se crearon <strong>{result.creados}</strong> de <strong>{result.total}</strong> productos.
                {result.errores.length > 0 && ` ${new Set(result.errores.map((e) => e.fila)).size} filas tienen errores; corrígelas y vuelve a importarlas.`}
              </span>
            </div>
            {result.errores.length > 0 && (
              <div className="import-errors">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Fila</th>
                      <th>Campo</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errores.slice(0, 500).map((e, i) => (
                      <tr key={`${e.fila}-${e.campo}-${i}`}>
                        <td>{e.fila}</td>
                        <td>
                          <code>{e.campo}</code>
                        </td>
                        <td>{e.mensaje}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
