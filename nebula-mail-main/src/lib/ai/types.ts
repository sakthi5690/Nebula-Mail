import type { CopilotActionType } from '../../types';

export interface AICopilotToolDefinition {
  name: CopilotActionType;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

export interface CopilotPromptContext {
  activeThreadId?: string;
  userEmail: string;
  selectedText?: string;
  userIntent: string;
}

export interface CopilotActionExecutionResult {
  success: boolean;
  action: CopilotActionType;
  feedbackMessage: string;
  mutatedFields?: Record<string, unknown>;
}

/**
 * Standard AI Function Calling Tools exposed to the Copilot LLM
 */
export const COPILOT_TOOLS: AICopilotToolDefinition[] = [
  {
    name: 'filter_mail',
    description: 'Filters the active inbox thread feed by sender, date range, or read status.',
    parameters: {
      type: 'object',
      properties: {
        sender: { type: 'string', description: 'Sender name or email address substring' },
        dateRange: { type: 'string', description: 'e.g. "Last 10 Days" or "This Week"' },
        unreadOnly: { type: 'boolean', description: 'Filter only unread emails' },
      },
      required: [],
    },
  },
  {
    name: 'open_compose',
    description: 'Opens the floating compose modal and optionally initializes recipient and subject fields.',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Draft subject line' },
        bodyDraft: { type: 'string', description: 'Generated draft message body' },
      },
      required: [],
    },
  },
  {
    name: 'generate_reply',
    description: 'Generates a contextual reply draft based on the currently open email thread.',
    parameters: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'Target email thread ID' },
        tone: { type: 'string', enum: ['concise', 'professional', 'casual', 'executive'] },
        keyPoints: { type: 'array', items: { type: 'string' } },
      },
      required: ['threadId'],
    },
  },
  {
    name: 'summarize_thread',
    description: 'Produces an executive summary and action items from an email thread.',
    parameters: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'Thread ID to summarize' },
      },
      required: ['threadId'],
    },
  },
];
