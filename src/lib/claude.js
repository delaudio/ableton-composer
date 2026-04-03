/**
 * Claude API wrapper for song generation.
 * Sends a structured prompt with schema + context and returns a parsed AbletonSong.
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '../../prompts');
const SCHEMA_DIR = join(__dirname, '../../schema');

let _client = null;

function getClient() {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.');
    }
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

/**
 * @param {object} options
 * @param {string} options.prompt           - User's natural language prompt
 * @param {string[]} options.trackNames     - Available track names in the Live set
 * @param {object} [options.context]        - Optional external context (weather, etc.)
 * @param {string} [options.model]          - Claude model to use
 * @returns {Promise<object>}               - Parsed AbletonSong JSON
 */
export async function generateSong({ prompt, trackNames, context = {}, model }) {
  const client = getClient();
  const systemPrompt = await readFile(join(PROMPTS_DIR, 'system.md'), 'utf-8');
  const schema = await readFile(join(SCHEMA_DIR, 'song.schema.json'), 'utf-8');

  const modelToUse = model || process.env.CLAUDE_MODEL || 'claude-opus-4-5';

  // Build the user message
  const parts = [];

  parts.push(`## Available tracks in this Ableton set\n${trackNames.map(n => `- "${n}"`).join('\n')}`);

  if (Object.keys(context).length > 0) {
    parts.push(`## External context\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``);
  }

  parts.push(`## Request\n${prompt}`);

  parts.push(`## Full schema reference\n\`\`\`json\n${schema}\n\`\`\``);

  const userMessage = parts.join('\n\n');

  const response = await client.messages.create({
    model: modelToUse,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const raw = response.content[0].text.trim();

  // Strip accidental markdown fences if the model adds them
  const jsonStr = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`Claude returned invalid JSON:\n${jsonStr.slice(0, 500)}\n\nParse error: ${err.message}`);
  }
}
