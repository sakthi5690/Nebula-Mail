/**
 * AI Command Router
 * Exposes POST /api/ai/command to process natural language into typed AIActions.
 */

import { Router, Request, Response } from 'express';
import { AIProvider, MockAIProvider } from '../services/ai-provider';
import { validateAIAction } from '../../../src/lib/ai/validator';
import { AICommandRequest } from '../../../src/lib/ai/actions.types';

export const aiRouter = Router();

// In standard operation or testing, instantiate MockAIProvider.
// Can be replaced with an LLM-backed provider via environment configuration.
const defaultProvider: AIProvider = new MockAIProvider();

/**
 * POST /api/ai/command
 * Body: { prompt: string, context?: AIContextState }
 */
aiRouter.post('/command', async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();

  try {
    const { prompt, context } = req.body as AICommandRequest;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      res.status(400).json({
        success: false,
        error: 'A non-empty "prompt" string is required in the request body.',
      });
      return;
    }

    const trimmedPrompt = prompt.trim();

    // Sanitized dev log (contains no tokens or credentials)
    console.info(`[AI Route] Received command prompt: "${trimmedPrompt.slice(0, 100)}${trimmedPrompt.length > 100 ? '...' : ''}"`);

    // Process with the AI provider
    const result = await defaultProvider.processCommand(trimmedPrompt, context);

    // Strict validation before returning to client
    const validation = validateAIAction(result.action);
    if (!validation.valid || !validation.action) {
      console.error('[AI Route] AI provider produced invalid action schema:', validation.error);
      res.status(502).json({
        success: false,
        error: 'AI Provider produced an invalid action payload',
        details: validation.error,
      });
      return;
    }

    const duration = Date.now() - startTime;
    console.info(`[AI Route] Generated action "${validation.action.type}" in ${duration}ms`);

    res.json({
      success: true,
      action: validation.action,
      explanation: result.explanation,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Internal error processing AI command';
    console.error('[AI Route] Command processing failed:', errorMsg);
    res.status(400).json({
      success: false,
      error: errorMsg,
    });
  }
});
