import ReactFlow, { Background } from 'reactflow';
import 'reactflow/dist/style.css';

/**
 * Read-only React Flow canvas showing conversation phase state.
 * Props:
 *   flowConfig      — { nodes, edges } from DB
 *   currentPhase    — id of the active phase
 *   completedPhases — array of completed phase ids
 */
export default function FlowViewer({ flowConfig, currentPhase, completedPhases = [] }) {
  if (!flowConfig?.nodes?.length) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: 'var(--text-3)', fontSize: '13px',
        flexDirection: 'column', gap: '8px',
      }}>
        <div>No flow configured</div>
        <div style={{ fontSize: '11px' }}>Build one in Flow Builder</div>
      </div>
    );
  }

  const styledNodes = flowConfig.nodes.map(n => {
    const isActive = n.id === currentPhase;
    const isDone   = completedPhases.includes(n.id);
    return {
      ...n,
      draggable: false,
      selectable: false,
      style: isActive
        ? { border: '2px solid #6366f1', boxShadow: '0 0 10px rgba(99,102,241,0.4)', borderRadius: '6px', background: 'rgba(99,102,241,0.1)' }
        : isDone
        ? { background: '#10b981', color: '#fff', borderRadius: '6px', border: '1px solid #059669' }
        : { opacity: 0.4, borderRadius: '6px' },
      data: {
        ...n.data,
        label: isDone ? `✓ ${n.data.label}` : isActive ? `▶ ${n.data.label}` : n.data.label,
      },
    };
  });

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <ReactFlow
        nodes={styledNodes}
        edges={flowConfig.edges || []}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll
        style={{ background: 'var(--bg-base)' }}
      >
        <Background color="var(--border)" gap={20} />
      </ReactFlow>
      {/* Legend */}
      <div style={{
        position: 'absolute', bottom: '12px', left: '12px',
        display: 'flex', gap: '12px', fontSize: '11px', color: 'var(--text-3)',
        background: 'var(--bg-surface)', padding: '6px 10px', borderRadius: '8px',
        border: '1px solid var(--border)',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', background: '#10b981' }} /> Done
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', border: '2px solid #6366f1' }} /> Active
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', background: 'var(--text-3)', opacity: 0.4 }} /> Pending
        </span>
      </div>
    </div>
  );
}
