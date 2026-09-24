/**
 * Frontend AI Command API Client
 * Sends natural language instructions to POST /api/ai/command
 * and provides helpers to validate and execute resulting actions.
 */

import {
  AIAction,
  AICommandRequest,
  AICommandResponse,
  AIExecutionResult,
} from './actions.types';
import { getAIContext } from './context';
import { executeAIAction } from './executor';

export class FrontendAICommandClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string = '/api/ai') {
    this.baseUrl = baseUrl;
  }

  /**
   * Send a natural language prompt to the backend AI command endpoint
   */
  public async sendCommand(prompt: string): Promise<{ action: AIAction; explanation: string }> {
    const context = getAIContext();
    const payload: AICommandRequest = {
      prompt,
      context,
    };

    const res = await fetch(`${this.baseUrl}/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data: AICommandResponse = await res.json();

    if (!res.ok || !data.success) {
      const errorMsg = !data.success ? data.error : `AI command failed (${res.status})`;
      throw new Error(errorMsg);
    }

    return {
      action: data.action,
      explanation: data.explanation,
    };
  }

  /**
   * Convenience helper: send prompt, get action, and automatically execute it on the UI
   */
  public async processAndExecute(prompt: string): Promise<AIExecutionResult & { explanation: string }> {
    const { action, explanation } = await this.sendCommand(prompt);
    const execResult = await executeAIAction(action);
    return {
      ...execResult,
      explanation,
    };
  }
}

export const frontendAICommandClient = new FrontendAICommandClient();
