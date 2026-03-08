import { useState, useEffect, useRef } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Spinner from '../ui/Spinner';
import api from '../../lib/api';
import { useToast } from '../ui/Toast';

export default function ProductModal({ open, onClose, product, attributes, clientId, onSaved }) {
  const toast = useToast();
  const fileRef = useRef();
  const [form, setForm] = useState({});
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (product) {
      setForm({ ...product, attrs: product.attrs || {} });
    } else {
      setForm({ name: '', description: '', price: '', category: '', image_url: '', in_stock: true, attrs: {} });
    }
  }, [product, open]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setAttr = (k, v) => setForm(f => ({ ...f, attrs: { ...f.attrs, [k]: v } }));

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await api.post('/upload-image', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      set('image_url', res.data.url);
      toast.success('Image uploaded');
    } catch {
      toast.error('Image upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!form.name) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        description: form.description || '',
        price: parseFloat(form.price) || 0,
        category: form.category || '',
        image_url: form.image_url || '',
        in_stock: form.in_stock !== false,
        attrs: form.attrs || {},
        ...(clientId && { client_id: clientId }),
      };
      if (product?.id) {
        await api.put(`/products/${product.id}`, payload);
        toast.success('Product updated');
      } else {
        await api.post('/products', payload);
        toast.success('Product created');
      }
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={product ? 'Edit Product' : 'Add Product'}
      maxWidth="max-w-2xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Name *</label>
            <input value={form.name || ''} onChange={e => set('name', e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-violet-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Price</label>
            <input type="number" step="0.01" value={form.price || ''} onChange={e => set('price', e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-violet-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
            <input value={form.category || ''} onChange={e => set('category', e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-violet-400" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
            <textarea rows={3} value={form.description || ''} onChange={e => set('description', e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-violet-400 resize-none" />
          </div>

          {/* Image */}
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Product Image</label>
            <div className="flex items-center gap-3">
              {form.image_url && (
                <img src={form.image_url} alt="preview" className="w-16 h-16 object-cover rounded-lg border border-slate-200" />
              )}
              <div className="flex flex-col gap-1.5 flex-1">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="text-sm border border-dashed border-slate-300 rounded-lg px-4 py-2 text-slate-500 hover:border-violet-400 hover:text-violet-600 cursor-pointer bg-transparent transition-colors disabled:opacity-50"
                >
                  {uploading ? 'Uploading…' : 'Upload from computer'}
                </button>
                <input value={form.image_url || ''} onChange={e => set('image_url', e.target.value)}
                  placeholder="or paste image URL"
                  className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400" />
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="in_stock" checked={form.in_stock !== false} onChange={e => set('in_stock', e.target.checked)} />
            <label htmlFor="in_stock" className="text-sm text-slate-700">In Stock</label>
          </div>
        </div>

        {/* Dynamic attributes */}
        {attributes && attributes.length > 0 && (
          <div className="border-t border-slate-100 pt-4">
            <div className="text-xs font-medium text-slate-500 mb-3 uppercase tracking-wide">Attributes</div>
            <div className="grid grid-cols-2 gap-3">
              {attributes.map(attr => (
                <div key={attr.id}>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{attr.name}</label>
                  {attr.type === 'select' ? (
                    <select value={form.attrs?.[attr.name] || ''} onChange={e => setAttr(attr.name, e.target.value)}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-violet-400">
                      <option value="">Select…</option>
                      {(attr.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input value={form.attrs?.[attr.name] || ''} onChange={e => setAttr(attr.name, e.target.value)}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-violet-400" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
