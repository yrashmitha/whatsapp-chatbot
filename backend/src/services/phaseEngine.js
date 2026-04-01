'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Detect which phase the conversation should be in.
 * Uses gemini-2.0-flash-lite — outputs one word, very cheap and fast.
 *
 * @param {Array} phases - flowConfig.nodes array
 * @param {Array} history - Gemini history array (last N turns)
 * @param {string} currentMessage - the current user message
 * @returns {Promise<string>} phase id
 */
async function detectPhase(phases, history, currentMessage) {
  if (!phases?.length) return null;

  const phaseList = phases
    .map(p => `${p.id}: ${p.data?.label || p.id}`)
    .join('\n');

  const recentHistory = (history || [])
    .slice(-5)
    .map(m => `${m.role}: ${m.parts?.[0]?.text?.slice(0, 200) || ''}`)
    .join('\n');

  const prompt = `You are a conversation phase classifier. Given the phases and conversation below, return ONLY the phase ID that best matches what the customer needs right now.

Phases:
${phaseList}

Recent conversation:
${recentHistory}

Current customer message: ${currentMessage}

Reply with ONLY the phase ID. No explanation, no punctuation. Just the ID.`;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });
    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim().toLowerCase().replace(/[^a-z0-9_]/g, '');

    // Validate against known phase ids
    const match = phases.find(p => p.id === raw);
    if (match) {
      console.log(`[PHASE][detect] → "${raw}"`);
      return raw;
    }

    // Fallback: first phase
    console.warn(`[PHASE][detect] unknown phase "${raw}", falling back to first`);
    return phases[0].id;
  } catch (err) {
    console.error('[PHASE][detect] error:', err.message);
    return phases[0].id;
  }
}

/**
 * Pure code — check if detected phase's prerequisites are met.
 * If not, returns the first missing prerequisite as the resolved phase.
 *
 * @param {string} detectedPhaseId
 * @param {string[]} completedPhases
 * @param {object} flowConfig
 * @returns {{ resolvedPhase, catchUp, targetPhase, allMissing }}
 */
function validatePhase(detectedPhaseId, completedPhases, flowConfig) {
  const phaseNode = flowConfig.nodes.find(n => n.id === detectedPhaseId);
  if (!phaseNode) return { resolvedPhase: detectedPhaseId, catchUp: null };

  const prerequisites = phaseNode.data?.prerequisites || [];
  const missing = prerequisites.filter(p => !(completedPhases || []).includes(p));

  if (missing.length === 0) {
    return { resolvedPhase: detectedPhaseId, catchUp: null };
  }

  // First missing prerequisite becomes the resolved phase
  const firstMissingNode = flowConfig.nodes.find(n => n.id === missing[0]);

  console.log(`[PHASE][validate] "${detectedPhaseId}" blocked — missing prerequisites: ${missing.join(', ')} → resolving to "${missing[0]}"`);

  return {
    resolvedPhase: missing[0],
    catchUp: firstMissingNode?.data?.catchUp ?? null,
    targetPhase: detectedPhaseId,
    allMissing: missing,
  };
}

/**
 * Build the per-turn instruction block and merged tools list.
 *
 * @param {string} resolvedPhaseId
 * @param {{ catchUp, targetPhase }} validationResult
 * @param {object} flowConfig
 * @returns {{ instructionBlock: string, tools: string[] }}
 */
function buildPhasePrompt(resolvedPhaseId, validationResult, flowConfig) {
  const phaseNode = flowConfig.nodes.find(n => n.id === resolvedPhaseId);
  const phaseData = phaseNode?.data || {};

  // Global tools always available + phase-specific extras
  const globalTools = flowConfig.globalTools || [];
  const phaseTools  = phaseData.tools || [];
  const tools = [...new Set([...globalTools, ...phaseTools])];

  let block = `[CURRENT PHASE: ${phaseData.label || resolvedPhaseId}]\n${phaseData.instructions || ''}`;

  if (validationResult?.catchUp) {
    const { strategy, instruction } = validationResult.catchUp;
    if (strategy === 'compressed' || strategy === 'custom') {
      const note = instruction?.trim() || 'Complete any missing context naturally before proceeding to the customer\'s request.';
      block += `\n\n[CATCH-UP NOTE]\n${note}`;
    }
  }

  return { instructionBlock: block.trim(), tools };
}

module.exports = { detectPhase, validatePhase, buildPhasePrompt };
