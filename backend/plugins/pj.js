/**
 * Custom plugin for client: pj
 *
 * This file is only loaded when plugin_enabled = true for client pj.
 * Errors here never affect other clients.
 *
 * Available hooks:
 *   getExtraTools(client)                              → array of Gemini tool declarations
 *   appendInstruction(baseInstruction, client)         → string to append to system prompt
 *   handleToolCall(toolName, args, client, context)    → { result: string } | null
 *   processMarkers(botReply, client, context)          → cleaned botReply string
 */

module.exports = {
  /**
   * Add extra Gemini tool declarations for this client.
   * Return an empty array if no custom tools are needed.
   */
  getExtraTools(client) {
    return [];
  },

  /**
   * Append extra instructions to the system prompt.
   * Return an empty string if nothing to add.
   */
  appendInstruction(baseInstruction, client) {
    return '';
  },

  /**
   * Handle a custom Gemini function call.
   * Return { result: <string> } if handled, or null to fall through to default handling.
   */
  async handleToolCall(toolName, args, client, { phoneNumber, db }) {
    // Example:
    // if (toolName === 'my_custom_tool') {
    //   return { result: 'done' };
    // }
    return null;
  },

  /**
   * Process custom [[MARKER:...]] patterns in the bot reply.
   * Must return the (possibly modified) botReply string.
   */
  async processMarkers(botReply, client, { phoneNumber, db, orderId }) {
    return botReply;
  },
};
