import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore, isSuperAdmin } from '../stores/auth';
import Layout from '../components/Layout';
import Spinner from '../components/ui/Spinner';
import Button from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import api from '../lib/api';

// ─── Add Document Modal ───────────────────────────────────────────────────────
function AddDocModal({ open, onClose, clientId, onSaved }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  if (!open) return null;

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    try {
      const params = clientId ? { client_id: clientId } : {};
      const r = await api.post('/knowledge', { title: title.trim(), content }, { params });
      toast.success(`Saved ${r.data.chunks} chunks`);
      setTitle(''); setContent('');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to save document');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-800">Add Document</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none bg-transparent border-0 cursor-pointer">×</button>
        </div>
        <div className="px-6 py-4 flex flex-col gap-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Document Name</label>
            <input
              value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Life Insurance Policy 2024"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-violet-400"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Content <span className="text-slate-400 font-normal">(paste the full document, any format)</span>
            </label>
            <textarea
              value={content} onChange={e => setContent(e.target.value)}
              placeholder="Paste your document here…"
              rows={14}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-violet-400 resize-none font-mono"
            />
            {content && (
              <p className="text-xs text-slate-400 mt-1">
                ~{Math.ceil(content.length / 500)} chunks estimated
              </p>
            )}
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !title.trim() || !content.trim()}>
            {saving ? 'Embedding…' : 'Save & Embed'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Chunk row (expandable) ───────────────────────────────────────────────────
function ChunkRow({ chunk, clientId, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(chunk.content);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();

  const handleSave = async () => {
    if (!editContent.trim()) return;
    setSaving(true);
    try {
      const params = clientId ? { client_id: clientId } : {};
      await api.put(`/knowledge/chunks/${chunk.id}`, { content: editContent }, { params });
      toast.success('Chunk updated');
      setEditing(false);
      onChanged();
    } catch (e) {
      toast.error('Failed to update chunk');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this chunk?')) return;
    try {
      const params = clientId ? { client_id: clientId } : {};
      await api.delete(`/knowledge/chunks/${chunk.id}`, { params });
      toast.success('Chunk deleted');
      onChanged();
    } catch (e) {
      toast.error('Failed to delete chunk');
    }
  };

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={editContent} onChange={e => setEditContent(e.target.value)}
            rows={4}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-violet-400 resize-y font-mono"
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setEditing(false); setEditContent(chunk.content); }}
              className="text-xs text-slate-500 hover:text-slate-700 bg-transparent border-0 cursor-pointer">Cancel</button>
            <button onClick={handleSave} disabled={saving}
              className="text-xs text-violet-600 hover:text-violet-800 bg-transparent border-0 cursor-pointer disabled:opacity-50">
              {saving ? 'Saving…' : 'Save & Re-embed'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-3 items-start">
          <p className="text-sm text-slate-700 flex-1 leading-relaxed">{chunk.content}</p>
          <div className="flex gap-2 shrink-0">
            <button onClick={() => setEditing(true)}
              className="text-xs text-violet-600 hover:text-violet-800 bg-transparent border-0 cursor-pointer">Edit</button>
            <button onClick={handleDelete}
              className="text-xs text-red-400 hover:text-red-600 bg-transparent border-0 cursor-pointer">Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Document row (expandable) ────────────────────────────────────────────────
function DocRow({ doc, clientId, onDeleted }) {
  const [expanded, setExpanded] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();

  const { data: chunks, isLoading: loadingChunks, refetch } = useQuery({
    queryKey: ['knowledge-chunks', doc.title, clientId],
    queryFn: () => api.get(`/knowledge/${encodeURIComponent(doc.title)}/chunks`,
      { params: clientId ? { client_id: clientId } : {} }).then(r => r.data),
    enabled: expanded,
  });

  const handleDelete = async () => {
    if (!confirm(`Delete "${doc.title}" and all its chunks?`)) return;
    try {
      await api.delete(`/knowledge/${encodeURIComponent(doc.title)}`,
        { params: clientId ? { client_id: clientId } : {} });
      toast.success('Document deleted');
      onDeleted();
    } catch (e) {
      toast.error('Failed to delete document');
    }
  };

  return (
    <>
      <tr className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setExpanded(v => !v)}>
        <td className="py-3 pr-4">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 text-xs">{expanded ? '▼' : '▶'}</span>
            <span className="font-medium text-slate-800">{doc.title}</span>
          </div>
        </td>
        <td className="py-3 pr-4 text-slate-500 text-sm">{doc.chunk_count}</td>
        <td className="py-3 pr-4 text-slate-400 text-sm">{new Date(doc.created_at).toLocaleDateString()}</td>
        <td className="py-3 text-right" onClick={e => e.stopPropagation()}>
          <button onClick={handleDelete}
            className="text-xs text-red-400 hover:text-red-600 bg-transparent border-0 cursor-pointer">Delete</button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={4} className="pb-4 px-2">
            {loadingChunks ? (
              <div className="flex justify-center py-4"><Spinner /></div>
            ) : (
              <div className="flex flex-col gap-2 mt-1">
                {(chunks || []).map((chunk, i) => (
                  <div key={chunk.id} className="flex gap-2 items-start">
                    <span className="text-xs text-slate-400 mt-3 w-7 shrink-0 text-right">#{i + 1}</span>
                    <div className="flex-1">
                      <ChunkRow chunk={chunk} clientId={clientId} onChanged={refetch} />
                    </div>
                  </div>
                ))}
                {chunks?.length === 0 && (
                  <p className="text-sm text-slate-400 pl-9">No chunks found</p>
                )}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function KnowledgeBase() {
  const { user, selectedClientId } = useAuthStore();
  const superAdmin = isSuperAdmin(user);
  const [showAdd, setShowAdd] = useState(false);
  const qc = useQueryClient();

  const clientId = superAdmin ? (selectedClientId || null) : user?.clientId;
  const params = clientId ? { client_id: clientId } : {};

  const { data: settings } = useQuery({
    queryKey: ['settings', clientId],
    queryFn: () => api.get('/settings', { params }).then(r => r.data),
    enabled: !!clientId,
  });

  const { data: sections, isLoading } = useQuery({
    queryKey: ['knowledge', clientId],
    queryFn: () => api.get('/knowledge', { params }).then(r => r.data),
    enabled: !!clientId,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['knowledge', clientId] });

  return (
    <Layout>
      <div className="flex flex-col h-full">
        <div className="px-6 py-4 border-b border-slate-200 bg-white flex items-center gap-3 flex-wrap shrink-0">
          <h1 className="text-lg font-semibold text-slate-800 mr-2">Knowledge Base</h1>
          <div className="ml-auto">
            <Button size="sm" onClick={() => setShowAdd(true)} disabled={!clientId}>+ Add Document</Button>
          </div>
        </div>

        {!clientId && superAdmin ? (
          <div className="flex items-center justify-center h-full text-slate-400 text-sm">
            Select a client from the sidebar to manage the knowledge base
          </div>
        ) : (
          <div className="flex-1 overflow-auto px-6 py-4">
            {settings && !settings.knowledge_base_enabled && (
              <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                Knowledge Base is disabled. Enable it in <strong>Settings</strong> to let the AI use this content.
              </div>
            )}

            {isLoading ? (
              <div className="flex justify-center py-12"><Spinner /></div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 uppercase tracking-wide border-b border-slate-200">
                    <th className="py-2 text-left pr-4">Document</th>
                    <th className="py-2 text-left pr-4">Chunks</th>
                    <th className="py-2 text-left pr-4">Added</th>
                    <th className="py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(sections || []).map(doc => (
                    <DocRow key={doc.title} doc={doc} clientId={clientId} onDeleted={refresh} />
                  ))}
                  {sections?.length === 0 && (
                    <tr><td colSpan={4} className="py-12 text-center text-slate-400">
                      No documents yet. Click "+ Add Document" to get started.
                    </td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <AddDocModal open={showAdd} onClose={() => setShowAdd(false)} clientId={clientId} onSaved={refresh} />
    </Layout>
  );
}
