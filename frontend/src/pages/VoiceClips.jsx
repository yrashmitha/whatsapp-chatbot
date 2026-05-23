import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/auth';
import Layout from '../components/Layout';
import Spinner from '../components/ui/Spinner';
import Button from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import api from '../lib/api';

function UploadModal({ open, onClose, clientId, onSaved }) {
  const [name, setName]       = useState('');
  const [keyword, setKeyword] = useState('');
  const [file, setFile]       = useState(null);
  const [saving, setSaving]   = useState(false);
  const toast = useToast();
  const fileRef = useRef();

  if (!open) return null;

  const reset = () => { setName(''); setKeyword(''); setFile(null); };

  const handleClose = () => { reset(); onClose(); };

  const handleSave = async () => {
    if (!name.trim() || !keyword.trim() || !file) {
      toast.error('Name, trigger keyword, and audio file are all required');
      return;
    }
    setSaving(true);
    try {
      const params = clientId ? { client_id: clientId } : {};
      const form = new FormData();
      form.append('file', file);
      form.append('name', name.trim());
      form.append('trigger_keyword', keyword.trim());
      await api.post('/voice-clips', form, { params, headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Voice clip added');
      onSaved();
      handleClose();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Upload failed');
    } finally {
      setSaving(false);
    }
  };

  const normalizeKeyword = (v) => v.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/__+/g, '_');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 flex flex-col gap-4">
        <h2 className="text-base font-semibold text-slate-800">Add Voice Clip</h2>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-600">Display Name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Welcome Greeting"
            className="px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-600">Trigger Keyword</label>
          <input
            value={keyword}
            onChange={e => setKeyword(normalizeKeyword(e.target.value))}
            placeholder="e.g. welcome"
            className="px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-violet-400 font-mono"
          />
          <p className="text-xs text-slate-400">
            AI uses <code className="bg-slate-100 px-1 rounded">{'[[VOICE:' + (keyword || 'keyword') + ']]'}</code> in replies to trigger this clip.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-600">Audio File</label>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={e => setFile(e.target.files?.[0] || null)}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 px-3 py-2 text-sm border border-dashed border-slate-300 rounded-xl text-slate-500 hover:border-violet-400 hover:text-violet-600 transition-colors text-left"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
            {file ? file.name : 'Choose audio file (mp3, ogg, wav…)'}
          </button>
        </div>

        <div className="flex gap-2 justify-end mt-2">
          <button onClick={handleClose} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 rounded-xl border border-slate-200 cursor-pointer">
            Cancel
          </button>
          <Button onClick={handleSave} disabled={saving || !name.trim() || !keyword.trim() || !file}>
            {saving ? 'Uploading…' : 'Add Clip'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function VoiceClips() {
  const { user, selectedClientId } = useAuthStore();
  const superAdmin = user?.role === 'superadmin';
  const clientId = superAdmin ? (selectedClientId || null) : user?.clientId;
  const params = clientId ? { client_id: clientId } : {};

  const qc = useQueryClient();
  const toast = useToast();
  const [showModal, setShowModal] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['voice-clips', clientId],
    queryFn: () => api.get('/voice-clips', { params }).then(r => r.data.clips),
    enabled: !!clientId,
  });

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/voice-clips/${id}`, { params }),
    onSuccess: () => { qc.invalidateQueries(['voice-clips', clientId]); toast.success('Clip deleted'); },
    onError: (e) => toast.error(e.response?.data?.error || 'Delete failed'),
  });

  const clips = data || [];

  return (
    <Layout>
      <div className="p-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Voice Clips</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Upload pre-recorded audio clips. The AI bot can send them automatically using{' '}
              <code className="bg-slate-100 px-1 rounded text-xs">{'[[VOICE:keyword]]'}</code> tokens in replies.
              Agents can also send them manually from the chat window.
            </p>
          </div>
          <Button onClick={() => setShowModal(true)}>+ Add Clip</Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : clips.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-sm">
            No voice clips yet. Add one to get started.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {clips.map(clip => (
              <div key={clip.id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-4 shadow-sm">
                <div className="w-10 h-10 bg-violet-100 rounded-xl flex items-center justify-center shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{clip.name}</p>
                  <code className="text-xs text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded">
                    {'[[VOICE:' + clip.trigger_keyword + ']]'}
                  </code>
                </div>

                <audio controls src={clip.audio_url} className="h-8 max-w-[200px]" />

                <button
                  onClick={() => deleteMut.mutate(clip.id)}
                  title="Delete clip"
                  className="shrink-0 w-8 h-8 flex items-center justify-center text-slate-300 hover:text-red-500 transition-colors rounded-lg cursor-pointer border-0 bg-transparent"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <UploadModal
        open={showModal}
        onClose={() => setShowModal(false)}
        clientId={clientId}
        onSaved={() => qc.invalidateQueries(['voice-clips', clientId])}
      />
    </Layout>
  );
}
