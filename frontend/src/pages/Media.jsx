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
      toast.success('File uploaded');
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
              placeholder="e.g. Send this always when the customer is about to send their horoscope photo. This shows the exact format needed."
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
                placeholder="https://example.com/image.jpg, file.pdf or video.mp4"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-violet-400"
              />
            ) : (
              <label className={`flex flex-col items-center justify-center w-full h-24 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${uploading ? 'border-violet-300 bg-violet-50' : 'border-slate-200 hover:border-violet-300 hover:bg-slate-50'}`}>
                <span className="text-xs text-slate-400">{uploading ? 'Uploading…' : 'Click to choose an image, PDF or MP4 video (max 50 MB)'}</span>
                <input type="file" accept="image/*,application/pdf,video/mp4,video/3gpp" className="hidden" onChange={handleFileChange} disabled={uploading} />
              </label>
            )}
            {imageUrl && (/\.(mp4|3gp)(\?|$)/i.test(imageUrl) ? (
              <video src={imageUrl} controls preload="metadata" playsInline className="mt-2 rounded-lg max-h-40 border border-slate-200" />
            ) : /\.pdf(\?|$)/i.test(imageUrl) ? (
              <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50">
                <span className="text-2xl">📄</span>
                <a href={imageUrl} target="_blank" rel="noreferrer" className="text-xs text-violet-600 underline truncate">{imageUrl.split('/').pop()}</a>
              </div>
            ) : (
              <img src={imageUrl} alt="preview" className="mt-2 rounded-lg max-h-32 object-cover border border-slate-200"
                onError={e => { e.target.style.display = 'none'; }} />
            ))}
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
const isVideoUrl = (u) => /\.(mp4|3gp)(\?|$)/i.test(u || '');
const isPdfUrl = (u) => /\.pdf(\?|$)/i.test(u || '');

/** A small square preview of a library item: the picture, or a mark for a video or PDF. */
function Thumb({ item, className = 'w-12 h-12' }) {
  if (isVideoUrl(item.image_url)) {
    return <div className={`${className} rounded-lg bg-slate-800 text-white flex items-center justify-center text-lg shrink-0`}>🎬</div>;
  }
  if (isPdfUrl(item.image_url)) {
    return <div className={`${className} rounded-lg bg-red-50 text-red-600 flex items-center justify-center text-[10px] font-bold shrink-0`}>PDF</div>;
  }
  return <img src={item.image_url} alt={item.title} loading="lazy" className={`${className} rounded-lg object-cover bg-slate-100 shrink-0`} />;
}

// ─── Add / Edit Media Group Modal ─────────────────────────────────────────────
/**
 * A named set of library items, picked in the order they should arrive. In the
 * chat, one tap on the group selects them all for sending.
 */
function GroupModal({ clientId, items, group, onClose, onSaved }) {
  const toast = useToast();
  const [name, setName] = useState(group?.name || '');
  const [selected, setSelected] = useState(
    () => (group?.media_ids || []).filter(id => items.some(m => m.id === id)));
  const [saving, setSaving] = useState(false);
  const toggle = (id) => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));

  const save = async () => {
    setSaving(true);
    try {
      const params = clientId ? { client_id: clientId } : {};
      const body = { name: name.trim(), media_ids: selected };
      if (group) await api.patch(`/media/groups/${group.id}`, body, { params });
      else await api.post('/media/groups', body, { params });
      toast.success(group ? 'Group saved' : 'Group created');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not save the group');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-3">
          <h2 className="text-base font-semibold text-slate-800">{group ? 'Edit media group' : 'New media group'}</h2>
          <p className="text-xs text-slate-500 mt-1">Tap the items in the order the customer should receive them.</p>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Group name, e.g. Ritual pack"
            maxLength={60}
            className="mt-3 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-violet-400"
          />
        </div>
        <div className="px-5 overflow-y-auto min-h-0 grid grid-cols-3 sm:grid-cols-4 gap-2 pb-3">
          {items.map(m => {
            const order = selected.indexOf(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggle(m.id)}
                className={`relative flex flex-col gap-1 p-1 rounded-xl border-2 bg-white cursor-pointer text-left ${order >= 0 ? 'border-violet-500 bg-violet-50' : 'border-transparent hover:border-violet-200'}`}
              >
                {order >= 0 && (
                  <span className="absolute top-2 right-2 z-10 w-6 h-6 rounded-full bg-violet-600 text-white text-xs font-bold flex items-center justify-center shadow">{order + 1}</span>
                )}
                <Thumb item={m} className="w-full aspect-square" />
                <span className="text-xs text-slate-600 truncate">{m.title}</span>
              </button>
            );
          })}
        </div>
        <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">{selected.length} selected</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={saving || !name.trim() || !selected.length}>{saving ? 'Saving…' : 'Save group'}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Media() {
  const { user, selectedClientId } = useAuthStore();
  const superAdmin = user?.role === 'superadmin';
  const clientId = superAdmin ? (selectedClientId || null) : user?.clientId;
  const qc = useQueryClient();
  const toast = useToast();
  const [modal, setModal] = useState(null); // null | 'add' | { ...item }
  const [groupModal, setGroupModal] = useState(null); // null | 'add' | { ...group }

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

  const { data: groupData } = useQuery({
    queryKey: ['media-groups', clientId],
    queryFn: () => api.get('/media/groups', { params: clientId ? { client_id: clientId } : {} }).then(r => r.data),
    enabled: !!clientId,
  });
  const groups = groupData?.groups || [];
  const deleteGroup = useMutation({
    mutationFn: (id) => api.delete(`/media/groups/${id}`, { params: clientId ? { client_id: clientId } : {} }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['media-groups', clientId] }); toast.success('Group deleted'); },
    onError: () => toast.error('Failed to delete the group'),
  });

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
      {groupModal && (
        <GroupModal
          clientId={clientId}
          items={items}
          group={groupModal === 'add' ? null : groupModal}
          onClose={() => setGroupModal(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: ['media-groups', clientId] })}
        />
      )}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-lg font-semibold text-slate-800">Media Library</h1>
              <p className="text-sm text-slate-400 mt-0.5">Images and PDFs Nova can send to customers at the right moment.</p>
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
              No media yet. Add images or PDFs with instructions so Nova knows when to send them. Videos are sent by you from the chat panel.
            </div>
          )}

          {/* Groups: send a fixed set in one go from the chat's image button. */}
          {clientId && !isLoading && items.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h2 className="text-sm font-semibold text-slate-800">Media groups</h2>
                  <p className="text-xs text-slate-400">A set you send often, in order. In the chat, tap the group in the image button and press Send.</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setGroupModal('add')}>+ New group</Button>
              </div>
              {groups.length === 0 ? (
                <div className="text-xs text-slate-400 bg-white border border-dashed border-slate-200 rounded-xl px-4 py-3">No groups yet.</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {groups.map(g => {
                    const members = g.media_ids.map(id => items.find(m => m.id === id)).filter(Boolean);
                    return (
                      <div key={g.id} className="bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-slate-800 truncate">{g.name}</div>
                          <div className="text-xs text-slate-400">{members.length} item{members.length === 1 ? '' : 's'}</div>
                          <div className="flex gap-1.5 mt-2 overflow-x-auto">
                            {members.map(m => <Thumb key={m.id} item={m} className="w-10 h-10" />)}
                          </div>
                        </div>
                        <div className="flex flex-col gap-1.5 shrink-0">
                          <Button variant="ghost" size="sm" onClick={() => setGroupModal(g)}>Edit</Button>
                          <Button variant="danger" size="sm" onClick={() => { if (confirm(`Delete the group "${g.name}"? Its items stay in the library.`)) deleteGroup.mutate(g.id); }}>Delete</Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3">
            {items.map(item => (
              <div key={item.id} className="bg-white border border-slate-200 rounded-xl p-4 flex gap-4">
                {/\.(mp4|3gp)(\?|$)/i.test(item.image_url) ? (
                  <a href={item.image_url} target="_blank" rel="noreferrer"
                    className="w-20 h-20 rounded-lg border border-slate-200 shrink-0 bg-slate-50 flex items-center justify-center text-3xl">
                    🎬
                  </a>
                ) : /\.pdf(\?|$)/i.test(item.image_url) ? (
                  <a href={item.image_url} target="_blank" rel="noreferrer"
                    className="w-20 h-20 rounded-lg border border-slate-200 shrink-0 bg-slate-50 flex items-center justify-center text-3xl">
                    📄
                  </a>
                ) : (
                  <img
                    src={item.image_url}
                    alt={item.title}
                    className="w-20 h-20 rounded-lg object-cover border border-slate-200 shrink-0 bg-slate-100"
                    onError={e => { e.target.style.display = 'none'; }}
                  />
                )}
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
