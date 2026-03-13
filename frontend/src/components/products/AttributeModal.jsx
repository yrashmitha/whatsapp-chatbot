import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { useToast } from '../ui/Toast';
import api from '../../lib/api';

const TYPES = ['text', 'number', 'select', 'boolean'];

export default function AttributeModal({ open, onClose, clientId }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [newAttr, setNewAttr] = useState({ field_key: '', field_label: '', field_type: 'text', options: '' });
  const [editingId, setEditingId] = useState(null);
  const [editAttr, setEditAttr] = useState({});
  const [bulkJson, setBulkJson] = useState('');
  const [showBulk, setShowBulk] = useState(false);

  const params = clientId ? { client_id: clientId } : {};

  const { data } = useQuery({
    queryKey: ['attributes', clientId],
    queryFn: () => api.get('/attributes', { params }).then(r => r.data),
    enabled: open && !!clientId,
  });
  const attrs = data?.attributes || [];

  const add = useMutation({
    mutationFn: () => api.post('/attributes', {
      field_key: newAttr.field_key,
      field_label: newAttr.field_label,
      field_type: newAttr.field_type,
      options: newAttr.field_type === 'select' ? newAttr.options.split(',').map(s => s.trim()).filter(Boolean) : [],
      ...(clientId && { client_id: clientId }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attributes'] });
      setNewAttr({ field_key: '', field_label: '', field_type: 'text', options: '' });
      toast.success('Attribute added');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to add attribute'),
  });

  const update = useMutation({
    mutationFn: () => api.put(`/attributes/${editingId}`, {
      field_label: editAttr.field_label,
      field_type: editAttr.field_type,
      options: editAttr.field_type === 'select'
        ? (typeof editAttr.options === 'string'
          ? editAttr.options.split(',').map(s => s.trim()).filter(Boolean)
          : editAttr.options || [])
        : [],
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attributes'] });
      setEditingId(null);
      toast.success('Attribute updated');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to update'),
  });

  const del = useMutation({
    mutationFn: (id) => api.delete(`/attributes/${id}`, { params }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['attributes'] }); toast.success('Deleted'); },
    onError: () => toast.error('Failed to delete'),
  });

  const bulkImport = async () => {
    try {
      const arr = JSON.parse(bulkJson);
      await api.post('/attributes/bulk', { attributes: arr, ...(clientId && { client_id: clientId }) });
      qc.invalidateQueries({ queryKey: ['attributes'] });
      toast.success('Bulk import done');
      setBulkJson('');
      setShowBulk(false);
    } catch {
      toast.error('Invalid JSON or import failed');
    }
  };

  const startEdit = (a) => {
    setEditingId(a.id);
    setEditAttr({
      field_label: a.field_label,
      field_type: a.field_type,
      options: Array.isArray(a.options) ? a.options.join(', ') : (a.options || ''),
    });
  };

  // Auto-generate field_key from label
  const handleLabelChange = (v) => {
    setNewAttr(a => ({
      ...a,
      field_label: v,
      field_key: a.field_key || v.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
    }));
  };

  return (
    <Modal open={open} onClose={onClose} title="Attribute Schema" maxWidth="max-w-xl"
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      <div className="flex flex-col gap-4">
        {/* Current */}
        <div>
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Current Attributes</div>
          {attrs.length === 0 ? <div className="text-sm text-slate-400">No attributes yet</div> : (
            <div className="flex flex-col gap-1">
              {attrs.map(a => (
                <div key={a.id} className="border border-slate-100 rounded-lg">
                  {editingId === a.id ? (
                    <div className="p-3 flex flex-col gap-2">
                      <div className="flex gap-2">
                        <input value={editAttr.field_label} onChange={e => setEditAttr(x => ({ ...x, field_label: e.target.value }))}
                          placeholder="Label" className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400" />
                        <select value={editAttr.field_type} onChange={e => setEditAttr(x => ({ ...x, field_type: e.target.value }))}
                          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400">
                          {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      {editAttr.field_type === 'select' && (
                        <input value={editAttr.options} onChange={e => setEditAttr(x => ({ ...x, options: e.target.value }))}
                          placeholder="Options (comma separated)" className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400" />
                      )}
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => update.mutate()} disabled={update.isPending}>Save</Button>
                        <Button size="sm" variant="secondary" onClick={() => setEditingId(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between py-1.5 px-3 bg-slate-50 rounded-lg">
                      <div>
                        <span className="text-sm font-medium text-slate-700">{a.field_label}</span>
                        <span className="ml-2 text-xs text-slate-400">{a.field_type}</span>
                        <span className="ml-2 text-xs text-slate-300 font-mono">{a.field_key}</span>
                        {a.options?.length > 0 && <span className="ml-2 text-xs text-violet-500">{(Array.isArray(a.options) ? a.options : []).join(', ')}</span>}
                      </div>
                      <div className="flex gap-3">
                        <button onClick={() => startEdit(a)} className="text-violet-500 hover:text-violet-700 text-xs cursor-pointer bg-transparent border-0">Edit</button>
                        <button onClick={() => del.mutate(a.id)} className="text-red-400 hover:text-red-600 text-xs cursor-pointer bg-transparent border-0">Delete</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add new */}
        <div className="border-t border-slate-100 pt-4">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Add Attribute</div>
          <div className="flex gap-2 mb-2">
            <input
              value={newAttr.field_label}
              onChange={e => handleLabelChange(e.target.value)}
              placeholder="Label (e.g. Color)"
              className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400"
            />
            <input
              value={newAttr.field_key}
              onChange={e => setNewAttr(a => ({ ...a, field_key: e.target.value }))}
              placeholder="Key (e.g. color)"
              className="w-32 text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400 font-mono"
            />
            <select value={newAttr.field_type} onChange={e => setNewAttr(a => ({ ...a, field_type: e.target.value }))}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400">
              {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {newAttr.field_type === 'select' && (
            <input value={newAttr.options} onChange={e => setNewAttr(a => ({ ...a, options: e.target.value }))}
              placeholder="Options (comma separated, e.g. Red, Blue, Green)"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400 mb-2" />
          )}
          <Button size="sm" onClick={() => add.mutate()} disabled={!newAttr.field_key || !newAttr.field_label || add.isPending}>Add</Button>
        </div>

        {/* Bulk JSON */}
        <div className="border-t border-slate-100 pt-4">
          <button onClick={() => setShowBulk(b => !b)} className="text-xs text-violet-600 cursor-pointer bg-transparent border-0">
            {showBulk ? '▾ Hide' : '▸ Show'} bulk JSON import
          </button>
          {showBulk && (
            <>
              <textarea rows={4} value={bulkJson} onChange={e => setBulkJson(e.target.value)}
                placeholder='[{"field_key":"color","field_label":"Color","field_type":"select","options":["Red","Blue"]}]'
                className="mt-2 w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-violet-400 font-mono resize-none" />
              <Button size="sm" className="mt-2" onClick={bulkImport}>Import</Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
