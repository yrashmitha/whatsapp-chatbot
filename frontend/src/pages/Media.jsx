import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/auth';
import Layout from '../components/Layout';
import Spinner from '../components/ui/Spinner';
import Button from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import api from '../lib/api';

// ─── Add / Edit Media Modal ────────────────────────────────────────────────────
function MediaModal({ open, onClose, clientId, onSaved, item }) {
  const editing = !!item;
  const [title, setTitle] = useState(item?.title || '');
  const [description, setDescription] = useState(item?.description || '');
  const [imageUrl, setImageUrl] = useState(item?.image_url || '');
  const [sortOrder, setSortOrder] = useState(item?.sort_order ?? 0);
  const [tab, setTab] = useState('url'); // 'url' | 'upload'
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  if (!open) return null;

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const params = clientId ? { client_id: clientId } : {};
      const form = new FormData();
      form.append('image', file);
      const r = await api.post('/media/upload', form, { params, headers: { 'Content-Type': 'multipart/form-data' } });
      setImageUrl(r.data.url);
      toast.success('Image uploaded');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!title.trim() || !description.trim() || !imageUrl.trim()) return;
    setSaving(true);
    try {
      const params = clientId ? { client_id: clientId } : {};
      if (editing) {
        await api.patch(`/media/${item.id}`, {
          title: title.trim(), description: description.trim(),
          image_url: imageUrl.trim(), sort_order: Number(sortOrder),
        }, { params });
        toast.success('Media item updated');
      } else {
        await api.post('/media', {
          title: title.trim(), description: description.trim(),
          image_url: imageUrl.trim(), sort_order: Number(sortOrder),
        }, { params });
        toast.success('Media item added');
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-800">{editing ? 'Edit Media' : 'Add Media'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none bg-transparent border-0 cursor-pointer">×</button>
        </div>
        <div className="px-6 py-4 flex flex-col gap-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Title</label>
            <input
              value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Horoscope Example"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-violet-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">When to send (AI instructions)</label>
            <textarea
              value={description} onChange={e => setDescription(e.target.value)}
              rows={3}
              placeholder="e.g. Send this always when the customer is about to send their horoscope photo — this shows the exact format needed"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-violet-400 resize-none"
            />
            <p className="text-xs text-slate-400 mt-1">Gemini reads this to decide when to send the image automatically.</p>
          </div>
          <div>
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => setTab('url')}
                className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${tab === 'url' ? 'bg-violet-100 text-violet-700' : 'text-slate-500 hover:bg-slate-100'}`}
              >Paste URL</button>
              <button
                onClick={() => setTab('upload')}
                className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${tab === 'upload' ? 'bg-violet-100 text-violet-700' : 'text-slate-500 hover:bg-slate-100'}`}
              >Upload file</button>
            </div>
            {tab === 'url' ? (
              <input
                value={imageUrl} onChange={e => setImageUrl(e.target.value)}
                placeholder="https://example.com/image.jpg"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-violet-400"
              />
            ) : (
              <label className={`flex flex-col items-center justify-center w-full h-24 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${uploading ? 'border-violet-300 bg-violet-50' : 'border-slate-200 hover:border-violet-300 hover:bg-slate-50'}`}>
                <span className="text-xs text-slate-400">{uploading ? 'Uploading…' : 'Click to choose an image (max 10 MB)'}</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} disabled={uploading} />
              </label>
            )}
            {imageUrl && (
              <img src={imageUrl} alt="preview" className="mt-2 rounded-lg max-h-32 object-cover border border-slate-200"
                onError={e => { e.target.style.display = 'none'; }} />
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Sort order</label>
            <input
              type="number" value={sortOrder} onChange={e => setSortOrder(e.target.value)}
              className="w-24 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-violet-400"
            />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !title.trim() || !description.trim() || !imageUrl.trim()}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add media'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Media page ────────────────────────────────────────────────────────────────
export default function Media() {
  const { user, selectedClientId } = useAuthStore();
  const superAdmin = user?.role === 'superadmin';
  const clientId = superAdmin ? (selectedClientId || null) : user?.clientId;
  const qc = useQueryClient();
  const toast = useToast();
  const [modal, setModal] = useState(null); // null | 'add' | { ...item }

  const { data, isLoading } = useQuery({
    queryKey: ['media', clientId],
    queryFn: () => api.get('/media', { params: clientId ? { client_id: clientId } : {} }).then(r => r.data),
    enabled: !!clientId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/media/${id}`, { params: clientId ? { client_id: clientId } : {} }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['media', clientId] }); toast.success('Deleted'); },
    onError: () => toast.error('Failed to delete'),
  });

  const items = data?.media || [];

  const handleDelete = (item) => {
    if (!confirm(`Delete "${item.title}"?`)) return;
    deleteMutation.mutate(item.id);
  };

  return (
    <Layout>
      {modal && (
        <MediaModal
          open
          onClose={() => setModal(null)}
          clientId={clientId}
          item={modal === 'add' ? null : modal}
          onSaved={() => qc.invalidateQueries({ queryKey: ['media', clientId] })}
        />
      )}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-lg font-semibold text-slate-800">Media Library</h1>
              <p className="text-sm text-slate-400 mt-0.5">Images Gemini can send to customers at the right moment.</p>
            </div>
            <Button onClick={() => setModal('add')}>+ Add media</Button>
          </div>

          {!clientId && (
            <div className="text-center py-12 text-sm text-slate-400">Select a client to manage media.</div>
          )}

          {clientId && isLoading && (
            <div className="flex justify-center py-12"><Spinner /></div>
          )}

          {clientId && !isLoading && items.length === 0 && (
            <div className="text-center py-12 text-sm text-slate-400">
              No media yet. Add images with instructions so Gemini knows when to send them.
            </div>
          )}

          <div className="flex flex-col gap-3">
            {items.map(item => (
              <div key={item.id} className="bg-white border border-slate-200 rounded-xl p-4 flex gap-4">
                <img
                  src={item.image_url}
                  alt={item.title}
                  className="w-20 h-20 rounded-lg object-cover border border-slate-200 shrink-0 bg-slate-100"
                  onError={e => { e.target.style.display = 'none'; }}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-slate-800 truncate">{item.title}</div>
                  <div className="text-xs text-slate-500 mt-1 line-clamp-2">{item.description}</div>
                  <div className="text-xs text-slate-300 mt-1 truncate">{item.image_url}</div>
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => setModal(item)}>Edit</Button>
                  <Button variant="danger" size="sm" onClick={() => handleDelete(item)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
}
