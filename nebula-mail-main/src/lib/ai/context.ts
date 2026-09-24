/**
 * AI Context State Provider
 * Captures the current snapshot of application state to feed into the AI
 * provider for contextual prompts (e.g., "reply to this", "what is this email about").
 */

import { AIContextState, NavDestination } from './actions.types';

export interface AppStateReader {
  getCurrentMailbox: () => NavDestination;
  getCurrentSearchQuery: () => string | null;
  getSelectedEmailId: () => string | null;
  isComposeOpen: () => boolean;
  isDetailOpen: () => boolean;
  getActiveFilters: () => string[];
  getCurrentDraft?: () => {
    to?: string;
    cc?: string;
    bcc?: string;
    subject?: string;
    body?: string;
  } | undefined;
  getSelectedEmailDetails?: () => { sender?: string; subject?: string } | null;
  getSelectedThreadId?: () => string | null;
  getCurrentlyOpenEmailId?: () => string | null;
  getVisibleThreadIds?: () => string[];
  getVisibleThreads?: () => Array<{
    id: string;
    sender?: string;
    subject?: string;
    snippet?: string;
    date?: string;
    isUnread?: boolean;
  }>;
}

let readerInstance: AppStateReader | null = null;

/**
 * Register the application state reader functions.
 * Called once during application initialization in main.ts.
 */
export function registerAppStateReader(reader: AppStateReader): void {
  readerInstance = reader;
}

/**
 * Capture current AI context snapshot.
 * Falls back safely to defaults if app state reader is not yet registered.
 */
export function getAIContext(): AIContextState {
  if (!readerInstance) {
    return {
      currentMailbox: 'inbox',
      currentSearchQuery: null,
      selectedEmailId: null,
      selectedThreadId: null,
      currentlyOpenEmailId: null,
      selectedEmailDetails: null,
      visibleThreadIds: [],
      visibleThreads: [],
      isComposeOpen: false,
      isDetailOpen: false,
      activeFilters: [],
      timestamp: Date.now(),
    };
  }

  return {
    currentMailbox: readerInstance.getCurrentMailbox(),
    currentSearchQuery: readerInstance.getCurrentSearchQuery(),
    selectedEmailId: readerInstance.getSelectedEmailId(),
    selectedThreadId: readerInstance.getSelectedThreadId ? readerInstance.getSelectedThreadId() : null,
    currentlyOpenEmailId: readerInstance.getCurrentlyOpenEmailId ? readerInstance.getCurrentlyOpenEmailId() : null,
    selectedEmailDetails: readerInstance.getSelectedEmailDetails ? readerInstance.getSelectedEmailDetails() : null,
    visibleThreadIds: readerInstance.getVisibleThreadIds ? readerInstance.getVisibleThreadIds() : [],
    visibleThreads: readerInstance.getVisibleThreads ? readerInstance.getVisibleThreads() : [],
    isComposeOpen: readerInstance.isComposeOpen(),
    isDetailOpen: readerInstance.isDetailOpen(),
    activeFilters: readerInstance.getActiveFilters(),
    currentDraft: readerInstance.getCurrentDraft ? readerInstance.getCurrentDraft() : undefined,
    timestamp: Date.now(),
  };
}
