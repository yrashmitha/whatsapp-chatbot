import { useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { useToast } from '../ui/Toast';
import api from '../../lib/api';

export default function ImportModal({ open, onClose, clientId, onImported }) {
  const [json, setJson] = useState('');
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const handleImport = async () => {
    let products;
    try { products = JSON.parse(json); } catch { toast.error('Invalid JSON'); return; }
    if (!Array.isArray(products)) { toast.error('JSON must be an array'); return; }
    setLoading(true);
    try {
      const res = await api.post('/products/bulk', { products: products.map(p => ({ ...p, ...(clientId && { client_id: clientId }) })) });
      toast.success(`Imported ${res.data.count} products`);
      setJson('');
      onImported?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  const example = JSON.stringify([
    { name: "Product A", price: 99.99, description: "Description", category: "Cat1", in_stock: true, attrs: { Color: "Red" } }
  ], null, 2);

  return (
    <Modal open={open} onClose={onClose} title="Bulk Import Products" maxWidth="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleImport} disabled={loading || !json.trim()}>{loading ? 'Importing…' : 'Import'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">Paste a JSON array of products to import in bulk.</p>
        <textarea
          rows={12}
          value={json}
          onChange={e => setJson(e.target.value)}
          placeholder={example}
          className="w-full text-xs font-mono border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-violet-400 resize-none"
        />
        <button onClick={() => setJson(example)} className="text-xs text-violet-500 hover:text-violet-700 text-left cursor-pointer bg-transparent border-0">
          Fill with example
        </button>
      </div>
    </Modal>
  );
}
