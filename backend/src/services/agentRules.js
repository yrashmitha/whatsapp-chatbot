/**
 * @module services/agentRules
 * @description Prompt fragments appended to every client's system instruction.
 *
 * These are platform rules, not client content — they exist to constrain how the
 * model formats its output, never to say anything about a particular business.
 * Nothing here is client-specific, so appending them to every prompt leaks
 * nothing between tenants.
 */

'use strict';

/**
 * Stop the model writing its reasoning as the reply.
 *
 * The response-side filters catch reasoning that Gemini flags as a thought part.
 * They cannot catch the case where the model emits its planning as an ordinary
 * answer part — no `thought` flag, no marker, just internal monologue where the
 * customer's message should be. That has to be prevented in the prompt, because
 * by the time it reaches the response there is nothing structural to filter on.
 */
const CLEAN_OUTPUT_RULE = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NEVER LEAK YOUR THINKING — ABSOLUTE RULE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Your reasoning, planning, and analysis are PRIVATE. They must NEVER appear in the message the customer receives.

The customer sees ONLY your final message to them — never the thinking that produced it.

NEVER write your thought process as the reply. Forbidden — these are how you THINK, never what you SEND:
- "The user is asking..." / "The customer wants..." / "The customer has..."
- "I should..." / "I need to..." / "I need to make sure..." / "I have to..." / "I will start by..."
- "Since this is the first message..." / "Because the knowledge base says..." / "Therefore, I should..."
- "Let me..." / "First, I'll... then I'll..." / "My plan is..." / "The rule says..."
- Any sentence ABOUT the conversation, the rules, or what to do next — instead of a sentence TO the customer.

Speak TO the customer in second person ("you"), never ABOUT them in third person ("the user", "the customer").
If a sentence describes your own decision-making, DELETE it. Only the customer-facing message survives.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REPLY FORMAT — STRICT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Your reply to the customer is ONLY the plain natural language text you write after completing all tool calls.

NEVER output any of the following as text in your reply:
- Tool call syntax: search_knowledge(...), search_products(...), print(...), default_api.*
- Code blocks: \`\`\`python, tool_code, function_call, <tool_use>, or any similar block
- Internal reasoning, chain-of-thought, scratchpad steps, or planning of any kind
- Headers like "Thinking:", "Thought:", "Reasoning:", "Plan:", or "<think>" / "</think>" tags
- The names or contents of your internal rule blocks (CORE FACTS, GLOBAL LAW, HARD RULES, PHASE 1, …)
- JSON objects, XML tags, or any structured data format

The customer must ONLY ever see natural conversational text — nothing else.
Tool calls are silent background actions. They are never visible to the customer.
If you find yourself writing a code block, a function name, or a sentence about what you should do — stop and delete it. Send only the message meant for the customer.`;

module.exports = { CLEAN_OUTPUT_RULE };
