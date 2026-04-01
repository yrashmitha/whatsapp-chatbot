import { useState, useCallback, useEffect } from 'react';
import ReactFlow, {
  useNodesState,
  useEdgesState,
  addEdge,
  Background,
  Controls,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useQuery } from '@tanstack/react-query';
import Layout from '../components/Layout';
import api from '../lib/api';
import { useAuthStore, isSuperAdmin } from '../stores/auth';

const EDGE_TYPES = {
  transition:   { color: '#6366f1', label: 'Normal flow' },
  skip:         { color: '#f59e0b', label: 'Skip path' },
  prerequisite: { color: '#ef4444', label: 'Prerequisite', dashed: true },
};

const AVAILABLE_TOOLS = ['search_knowledge', 'send_image'];

function genId() {
  return `phase_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
}

function makeEdgeStyle(type) {
  const cfg = EDGE_TYPES[type] || EDGE_TYPES.transition;
  return {
    style: {
      stroke: cfg.color,
      strokeDasharray: cfg.dashed ? '5 3' : undefined,
    },
    markerEnd: { type: MarkerType.ArrowClosed, color: cfg.color },
  };
}

const inputStyle = {
  display: 'block', width: '100%', marginTop: '4px',
  padding: '6px 8px', fontSize: '13px', borderRadius: '6px',
  border: '1px solid var(--border)', background: 'var(--bg-card)',
  color: 'var(--text-1)', outline: 'none', boxSizing: 'border-box',
};

const textareaStyle = {
  ...inputStyle,
  resize: 'vertical', lineHeight: '1.5', fontFamily: 'inherit',
};

const labelStyle = { fontSize: '11px', color: 'var(--text-3)', marginBottom: '2px', display: 'block' };
const sectionStyle = { marginBottom: '14px' };

export default function FlowBuilder() {
  const { user } = useAuthStore();
  const superAdmin = isSuperAdmin(user);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [globalTools, setGlobalTools]    = useState(['search_knowledge']);
  const [selectedNode, setSelectedNode]  = useState(null);
  const [selectedEdge, setSelectedEdge]  = useState(null);
  const [saving, setSaving]              = useState(false);
  const [saved, setSaved]                = useState(false);

  // Phase form state
  const [form, setForm] = useState({
    label: '', instructions: '', tools: [],
    prerequisites: [], catchUpStrategy: 'none', catchUpInstruction: '',
  });

  // Edge form state
  const [edgeForm, setEdgeForm] = useState({ type: 'transition', label: '' });

  // Load flow config
  const { data: flowData } = useQuery({
    queryKey: ['flow-config', user?.clientId],
    queryFn: () => api.get('/api/flow-config').then(r => r.data),
  });

  useEffect(() => {
    if (!flowData) return;
    if (flowData.nodes?.length) setNodes(flowData.nodes);
    if (flowData.edges?.length) setEdges(flowData.edges);
    if (flowData.globalTools) setGlobalTools(flowData.globalTools);
  }, [flowData]);

  const allPhaseIds = nodes.map(n => ({ id: n.id, label: n.data?.label || n.id }));

  // ── Canvas handlers ───────────────────────────────────────────────────────

  const onConnect = useCallback((connection) => {
    setEdges(eds => addEdge({
      ...connection,
      label: 'next',
      data: { edgeType: 'transition' },
      ...makeEdgeStyle('transition'),
    }, eds));
  }, [setEdges]);

  const onNodeClick = useCallback((_, node) => {
    setSelectedNode(node.id);
    setSelectedEdge(null);
    setForm({
      label:              node.data.label || '',
      instructions:       node.data.instructions || '',
      tools:              node.data.tools || [],
      prerequisites:      node.data.prerequisites || [],
      catchUpStrategy:    node.data.catchUp?.strategy || 'none',
      catchUpInstruction: node.data.catchUp?.instruction || '',
    });
  }, []);

  const onEdgeClick = useCallback((_, edge) => {
    setSelectedEdge(edge.id);
    setSelectedNode(null);
    setEdgeForm({
      type:  edge.data?.edgeType || 'transition',
      label: typeof edge.label === 'string' ? edge.label : '',
    });
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
  }, []);

  // ── Phase CRUD ────────────────────────────────────────────────────────────

  function addPhase() {
    const id = genId();
    setNodes(ns => [...ns, {
      id,
      position: { x: 120 + (ns.length % 4) * 200, y: 120 + Math.floor(ns.length / 4) * 150 },
      data: { label: 'New Phase', instructions: '', tools: [], prerequisites: [], catchUp: null },
    }]);
  }

  function savePhase() {
    if (!selectedNode) return;
    setNodes(ns => ns.map(n => {
      if (n.id !== selectedNode) return n;
      return {
        ...n,
        data: {
          ...n.data,
          label:          form.label,
          instructions:   form.instructions,
          tools:          form.tools,
          prerequisites:  form.prerequisites,
          catchUp: form.catchUpStrategy === 'none' ? null : {
            strategy:    form.catchUpStrategy,
            instruction: form.catchUpInstruction,
          },
        },
      };
    }));
  }

  function deletePhase() {
    if (!selectedNode) return;
    setNodes(ns => ns.filter(n => n.id !== selectedNode));
    setEdges(es => es.filter(e => e.source !== selectedNode && e.target !== selectedNode));
    setSelectedNode(null);
  }

  // ── Edge CRUD ─────────────────────────────────────────────────────────────

  function saveEdge() {
    if (!selectedEdge) return;
    setEdges(es => es.map(e => {
      if (e.id !== selectedEdge) return e;
      return {
        ...e,
        label: edgeForm.label,
        data:  { ...e.data, edgeType: edgeForm.type },
        ...makeEdgeStyle(edgeForm.type),
      };
    }));
  }

  function deleteEdge() {
    if (!selectedEdge) return;
    setEdges(es => es.filter(e => e.id !== selectedEdge));
    setSelectedEdge(null);
  }

  // ── Save to backend ───────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true);
    try {
      await api.patch('/api/flow-config', { nodes, edges, globalTools });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      alert(e?.response?.data?.error || 'Failed to save flow');
    } finally {
      setSaving(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Layout>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{
          padding: '10px 20px', borderBottom: '1px solid var(--border)',
          background: 'var(--bg-surface)', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-1)' }}>Flow Builder</span>
            <span style={{ fontSize: '12px', color: 'var(--text-3)', marginLeft: '12px' }}>
              Click a phase to edit · Drag between handles to connect
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={addPhase} style={{
              padding: '5px 12px', fontSize: '12px', borderRadius: '7px', cursor: 'pointer',
              border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-2)',
            }}>+ Add Phase</button>
            <button onClick={handleSave} disabled={saving} style={{
              padding: '5px 16px', fontSize: '12px', borderRadius: '7px', cursor: 'pointer',
              border: 'none', background: saved ? '#10b981' : 'var(--accent)', color: '#fff',
              opacity: saving ? 0.6 : 1, transition: 'background 0.3s',
            }}>
              {saving ? 'Saving…' : saved ? 'Saved' : 'Save Flow'}
            </button>
          </div>
        </div>

        {/* Canvas + Side panel */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* Canvas */}
          <div style={{ flex: 1, position: 'relative' }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              onEdgeClick={onEdgeClick}
              onPaneClick={onPaneClick}
              fitView
              style={{ background: 'var(--bg-base)' }}
            >
              <Background color="var(--border)" gap={20} />
              <Controls />
            </ReactFlow>
            {nodes.length === 0 && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                pointerEvents: 'none',
              }}>
                <div style={{ textAlign: 'center', color: 'var(--text-3)' }}>
                  <div style={{ fontSize: '14px', marginBottom: '6px' }}>No phases yet</div>
                  <div style={{ fontSize: '12px' }}>Click "+ Add Phase" to start building your flow</div>
                </div>
              </div>
            )}
          </div>

          {/* Side panel */}
          <div style={{
            width: '300px', flexShrink: 0, borderLeft: '1px solid var(--border)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            background: 'var(--bg-surface)',
          }}>

            {/* Global tools */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
                Global Tools (always available)
              </div>
              {AVAILABLE_TOOLS.map(t => (
                <label key={t} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '5px' }}>
                  <input
                    type="checkbox"
                    checked={globalTools.includes(t)}
                    onChange={e => {
                      if (e.target.checked) setGlobalTools(g => [...g, t]);
                      else setGlobalTools(g => g.filter(x => x !== t));
                    }}
                  />
                  <span style={{ fontSize: '12px', color: 'var(--text-2)' }}>{t}</span>
                </label>
              ))}
            </div>

            {/* Phase editor */}
            {selectedNode && (
              <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px' }}>
                  Edit Phase
                </div>

                <div style={sectionStyle}>
                  <label style={labelStyle}>Phase Name</label>
                  <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} style={inputStyle} />
                </div>

                <div style={sectionStyle}>
                  <label style={labelStyle}>Instructions (what the bot should do)</label>
                  <textarea
                    value={form.instructions}
                    onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))}
                    rows={5}
                    style={textareaStyle}
                  />
                </div>

                <div style={sectionStyle}>
                  <div style={{ ...labelStyle, marginBottom: '6px' }}>Extra Tools (this phase only)</div>
                  {AVAILABLE_TOOLS.map(t => (
                    <label key={t} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '5px' }}>
                      <input
                        type="checkbox"
                        checked={form.tools.includes(t)}
                        onChange={e => {
                          if (e.target.checked) setForm(f => ({ ...f, tools: [...f.tools, t] }));
                          else setForm(f => ({ ...f, tools: f.tools.filter(x => x !== t) }));
                        }}
                      />
                      <span style={{ fontSize: '12px', color: 'var(--text-2)' }}>{t}</span>
                    </label>
                  ))}
                </div>

                <div style={sectionStyle}>
                  <div style={{ ...labelStyle, marginBottom: '6px' }}>Must complete first (prerequisites)</div>
                  {allPhaseIds.filter(p => p.id !== selectedNode).length === 0 ? (
                    <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>No other phases yet</span>
                  ) : allPhaseIds.filter(p => p.id !== selectedNode).map(p => (
                    <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '5px' }}>
                      <input
                        type="checkbox"
                        checked={form.prerequisites.includes(p.id)}
                        onChange={e => {
                          if (e.target.checked) setForm(f => ({ ...f, prerequisites: [...f.prerequisites, p.id] }));
                          else setForm(f => ({ ...f, prerequisites: f.prerequisites.filter(x => x !== p.id) }));
                        }}
                      />
                      <span style={{ fontSize: '12px', color: 'var(--text-2)' }}>{p.label}</span>
                    </label>
                  ))}
                </div>

                <div style={sectionStyle}>
                  <div style={{ ...labelStyle, marginBottom: '6px' }}>When customer skips prerequisites</div>
                  {[
                    { value: 'none',       label: 'Hard gate — redirect to missing phase' },
                    { value: 'compressed', label: 'Compress missing phases into one reply' },
                    { value: 'custom',     label: 'Custom catch-up instruction' },
                  ].map(opt => (
                    <label key={opt.value} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', marginBottom: '6px' }}>
                      <input
                        type="radio"
                        name="catchUpStrategy"
                        value={opt.value}
                        checked={form.catchUpStrategy === opt.value}
                        onChange={() => setForm(f => ({ ...f, catchUpStrategy: opt.value }))}
                        style={{ marginTop: '2px' }}
                      />
                      <span style={{ fontSize: '12px', color: 'var(--text-2)', lineHeight: '1.4' }}>{opt.label}</span>
                    </label>
                  ))}
                  {(form.catchUpStrategy === 'compressed' || form.catchUpStrategy === 'custom') && (
                    <textarea
                      value={form.catchUpInstruction}
                      onChange={e => setForm(f => ({ ...f, catchUpInstruction: e.target.value }))}
                      placeholder={
                        form.catchUpStrategy === 'compressed'
                          ? 'e.g. Greet warmly, show empathy, signal you have a solution — all in one reply. No service details yet.'
                          : 'Specific instructions for handling this skip scenario...'
                      }
                      rows={4}
                      style={{ ...textareaStyle, marginTop: '6px' }}
                    />
                  )}
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={savePhase} style={{
                    flex: 1, padding: '7px', fontSize: '12px', borderRadius: '7px', cursor: 'pointer',
                    border: 'none', background: 'var(--accent)', color: '#fff',
                  }}>Save Phase</button>
                  <button onClick={deletePhase} style={{
                    padding: '7px 12px', fontSize: '12px', borderRadius: '7px', cursor: 'pointer',
                    border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#ef4444',
                  }}>Delete</button>
                </div>
              </div>
            )}

            {/* Edge editor */}
            {selectedEdge && !selectedNode && (
              <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px' }}>
                  Edit Connection
                </div>

                <div style={sectionStyle}>
                  <label style={labelStyle}>Label</label>
                  <input
                    value={edgeForm.label}
                    onChange={e => setEdgeForm(f => ({ ...f, label: e.target.value }))}
                    placeholder="e.g. if price asked"
                    style={inputStyle}
                  />
                </div>

                <div style={sectionStyle}>
                  <div style={{ ...labelStyle, marginBottom: '8px' }}>Connection Type</div>
                  {Object.entries(EDGE_TYPES).map(([type, cfg]) => (
                    <label key={type} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', marginBottom: '10px' }}>
                      <input
                        type="radio"
                        name="edgeType"
                        value={type}
                        checked={edgeForm.type === type}
                        onChange={() => setEdgeForm(f => ({ ...f, type }))}
                      />
                      <div style={{
                        width: '28px', height: '3px',
                        background: cfg.dashed ? 'none' : cfg.color,
                        backgroundImage: cfg.dashed
                          ? `repeating-linear-gradient(90deg, ${cfg.color} 0, ${cfg.color} 5px, transparent 5px, transparent 8px)`
                          : 'none',
                        borderRadius: '2px',
                      }} />
                      <span style={{ fontSize: '12px', color: 'var(--text-2)' }}>{cfg.label}</span>
                    </label>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={saveEdge} style={{
                    flex: 1, padding: '7px', fontSize: '12px', borderRadius: '7px', cursor: 'pointer',
                    border: 'none', background: 'var(--accent)', color: '#fff',
                  }}>Save</button>
                  <button onClick={deleteEdge} style={{
                    padding: '7px 12px', fontSize: '12px', borderRadius: '7px', cursor: 'pointer',
                    border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#ef4444',
                  }}>Delete</button>
                </div>
              </div>
            )}

            {/* Empty state */}
            {!selectedNode && !selectedEdge && (
              <div style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '20px', textAlign: 'center',
              }}>
                <div>
                  <div style={{ fontSize: '13px', color: 'var(--text-3)', marginBottom: '4px' }}>Click a phase to edit it</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-3)', marginBottom: '20px' }}>Click a connection to change its type</div>
                  <div style={{ textAlign: 'left', fontSize: '12px', color: 'var(--text-3)', lineHeight: '1.8' }}>
                    {Object.entries(EDGE_TYPES).map(([type, cfg]) => (
                      <div key={type} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <div style={{
                          width: '24px', height: '2px',
                          background: cfg.dashed ? 'none' : cfg.color,
                          backgroundImage: cfg.dashed
                            ? `repeating-linear-gradient(90deg, ${cfg.color} 0, ${cfg.color} 5px, transparent 5px, transparent 8px)`
                            : 'none',
                        }} />
                        {cfg.label}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
