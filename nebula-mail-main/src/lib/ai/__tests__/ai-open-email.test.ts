/**
 * Dedicated Test Suite for Part 9 — AI Open Email & Context Awareness
 * Validates:
 * Test 1: Direct ID resolution ("open email 18cf32918bc3" -> OPEN_EMAIL with emailId)
 * Test 2: Sender-based resolution ("open the email from John" -> OPEN_EMAIL with threadId of matching visible thread)
 * Test 3: "open the latest email from John" -> resolves latest matching sender threadId
 * Test 4: Positional resolution ("open the first email" / "open the latest email" -> threadId of first visible thread)
 * Test 5: Subject/keyword resolution ("open the email about the project" / "open the invoice email" -> matching threadId)
 * Test 6: Contextual recall ("open the email I was just looking at" -> currentlyOpenEmailId / selectedEmailId)
 * Test 7: Navigation command ("go back to my inbox" / "back to inbox" -> NAVIGATE to inbox)
 * Test 8: Error handling when no visible emails match or sender not found
 * Test 9: End-to-end execution via executeAIAction triggering openEmailDetail UI operation
 * Test 10: Strict ID integrity — NEVER fabricate IDs (resolves only from provided context/API)
 */

import { MockAIProvider } from '../../../../server/src/services/ai-provider';
import { executeAIAction, registerUIOperations, UIOperations } from '../executor';
import { validateAIAction } from '../validator';
import { AIContextState } from '../actions.types';

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${testName}`);
  } else {
    console.error(`  ❌ [FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
    throw new Error(`Test failed: ${testName}`);
  }
}

// Sample mock visible threads as would be present in client state
const mockVisibleThreads = [
  {
    id: 'thread_john_101',
    sender: 'John Doe <john@example.com>',
    subject: 'Q3 Financial Review & Roadmap',
    snippet: 'Here is the summary of Q3 financials attached.',
    date: '2026-09-04T10:00:00Z',
    isUnread: true,
  },
  {
    id: 'thread_sarah_102',
    sender: 'Sarah Connor <sarah@skynet.org>',
    subject: 'Project Update: Stitch Client Launch',
    snippet: 'The project milestones have all been achieved on schedule.',
    date: '2026-09-03T15:30:00Z',
    isUnread: false,
  },
  {
    id: 'thread_billing_103',
    sender: 'Billing Team <billing@vendor.com>',
    subject: 'Invoice #84920 for August Services',
    snippet: 'Please find attached invoice for payment by end of month.',
    date: '2026-09-01T09:00:00Z',
    isUnread: false,
  },
];

const mockBaseContext: AIContextState = {
  currentMailbox: 'inbox',
  currentSearchQuery: null,
  selectedEmailId: null,
  selectedThreadId: null,
  currentlyOpenEmailId: 'thread_previously_opened_999',
  visibleThreadIds: mockVisibleThreads.map((t) => t.id),
  visibleThreads: mockVisibleThreads,
  isComposeOpen: false,
  isDetailOpen: false,
  activeFilters: [],
  timestamp: Date.now(),
};

async function runAIOpenEmailTests() {
  console.log('\n=== RUNNING PART 9 AI OPEN EMAIL & CONTEXT AWARENESS TESTS ===\n');

  const provider = new MockAIProvider();

  // -------------------------------------------------------------
  // Test 1: Direct ID match
  // -------------------------------------------------------------
  console.log('--- Test 1: Direct ID Open ---');
  const res1 = await provider.processCommand('open email 18cf32918bc3');
  assert(res1.action.type === 'OPEN_EMAIL', 'Direct command produces OPEN_EMAIL action');
  if (res1.action.type === 'OPEN_EMAIL') {
    assert(res1.action.payload.emailId === '18cf32918bc3', 'Extracted exact message ID "18cf32918bc3"');
  }

  // -------------------------------------------------------------
  // Test 2: Descriptive Open by Sender ("open the email from John")
  // -------------------------------------------------------------
  console.log('\n--- Test 2: Descriptive Open by Sender ---');
  const res2 = await provider.processCommand('Open the email from John', mockBaseContext);
  assert(res2.action.type === 'OPEN_EMAIL', 'Sender command produces OPEN_EMAIL action');
  if (res2.action.type === 'OPEN_EMAIL') {
    assert(
      res2.action.payload.threadId === 'thread_john_101',
      'Resolved to John\'s real thread ID "thread_john_101"'
    );
  }

  // -------------------------------------------------------------
  // Test 3: "open the latest email from Sarah"
  // -------------------------------------------------------------
  console.log('\n--- Test 3: Latest Email from Specific Sender ---');
  const res3 = await provider.processCommand('Open the latest email from Sarah', mockBaseContext);
  assert(res3.action.type === 'OPEN_EMAIL', 'Produces OPEN_EMAIL action for latest from Sarah');
  if (res3.action.type === 'OPEN_EMAIL') {
    assert(
      res3.action.payload.threadId === 'thread_sarah_102',
      'Resolved to Sarah\'s thread ID "thread_sarah_102"'
    );
  }

  // -------------------------------------------------------------
  // Test 4: Positional Open ("open the first email" / "open the latest email")
  // -------------------------------------------------------------
  console.log('\n--- Test 4: Positional Open Commands ---');
  const res4a = await provider.processCommand('Open the first email', mockBaseContext);
  assert(res4a.action.type === 'OPEN_EMAIL', 'Produces OPEN_EMAIL for "first email"');
  if (res4a.action.type === 'OPEN_EMAIL') {
    assert(
      res4a.action.payload.threadId === 'thread_john_101',
      'Resolved first email to thread_john_101'
    );
  }

  const res4b = await provider.processCommand('Open the latest email', mockBaseContext);
  assert(res4b.action.type === 'OPEN_EMAIL', 'Produces OPEN_EMAIL for "latest email"');
  if (res4b.action.type === 'OPEN_EMAIL') {
    assert(
      res4b.action.payload.threadId === 'thread_john_101',
      'Resolved latest email to first item (thread_john_101)'
    );
  }

  const res4c = await provider.processCommand('Open the last email', mockBaseContext);
  assert(res4c.action.type === 'OPEN_EMAIL', 'Produces OPEN_EMAIL for "last email"');
  if (res4c.action.type === 'OPEN_EMAIL') {
    assert(
      res4c.action.payload.threadId === 'thread_billing_103',
      'Resolved last email to thread_billing_103'
    );
  }

  // -------------------------------------------------------------
  // Test 5: Subject / Keyword Match ("open the invoice email")
  // -------------------------------------------------------------
  console.log('\n--- Test 5: Subject / Keyword Matching ---');
  const res5a = await provider.processCommand('Open the invoice email', mockBaseContext);
  assert(res5a.action.type === 'OPEN_EMAIL', 'Produces OPEN_EMAIL for "invoice email"');
  if (res5a.action.type === 'OPEN_EMAIL') {
    assert(
      res5a.action.payload.threadId === 'thread_billing_103',
      'Resolved invoice email to thread_billing_103'
    );
  }

  const res5b = await provider.processCommand('Open the email about the project', mockBaseContext);
  assert(res5b.action.type === 'OPEN_EMAIL', 'Produces OPEN_EMAIL for "about project"');
  if (res5b.action.type === 'OPEN_EMAIL') {
    assert(
      res5b.action.payload.threadId === 'thread_sarah_102',
      'Resolved project email to thread_sarah_102'
    );
  }

  // -------------------------------------------------------------
  // Test 6: Contextual Recall ("open the email I was just looking at")
  // -------------------------------------------------------------
  console.log('\n--- Test 6: Contextual Recall of Last Viewed Email ---');
  const res6 = await provider.processCommand('Open the email I was just looking at', mockBaseContext);
  assert(res6.action.type === 'OPEN_EMAIL', 'Produces OPEN_EMAIL for previously viewed email');
  if (res6.action.type === 'OPEN_EMAIL') {
    assert(
      res6.action.payload.emailId === 'thread_previously_opened_999',
      'Re-opened currentlyOpenEmailId from context (thread_previously_opened_999)'
    );
  }

  // -------------------------------------------------------------
  // Test 7: Navigation back to inbox
  // -------------------------------------------------------------
  console.log('\n--- Test 7: Navigation Back to Inbox ---');
  const res7 = await provider.processCommand('Go back to my inbox');
  assert(res7.action.type === 'NAVIGATE', '"Go back to my inbox" produces NAVIGATE');
  if (res7.action.type === 'NAVIGATE') {
    assert(res7.action.payload.destination === 'inbox', 'Navigates to inbox destination');
  }

  // -------------------------------------------------------------
  // Test 8: Strict Non-Fabrication & Error Handling
  // -------------------------------------------------------------
  console.log('\n--- Test 8: Non-Fabrication & Error Handling ---');
  let threwExpectedError = false;
  try {
    // Looking for a sender not in visible threads
    await provider.processCommand('Open the email from Alice', mockBaseContext);
  } catch (err: any) {
    threwExpectedError = true;
    assert(
      err.message.includes('No visible email from "alice" found'),
      'Refused to fabricate ID for non-existent sender "Alice"'
    );
  }
  assert(threwExpectedError, 'Strictly threw error instead of inventing an email ID');

  let emptyContextThrew = false;
  try {
    await provider.processCommand('Open the first email', {
      ...mockBaseContext,
      visibleThreads: [],
    });
  } catch (err: any) {
    emptyContextThrew = true;
    assert(
      err.message.includes('No visible emails'),
      'Safely reports no visible emails when thread list is empty'
    );
  }
  assert(emptyContextThrew, 'Safely threw on empty visibleThreads');

  // -------------------------------------------------------------
  // Test 9: Frontend Executor Execution
  // -------------------------------------------------------------
  console.log('\n--- Test 9: Action Executor Wiring with openEmailDetail ---');
  let openDetailCalledWith: string | null = null;

  const mockOps: UIOperations = {
    openComposeModal: () => {},
    closeComposeModal: () => {},
    openEmailDetail: (messageOrThreadId: string) => {
      openDetailCalledWith = messageOrThreadId;
    },
    closeEmailDetail: () => {},
    executeSearch: () => {},
    loadInboxThreads: () => {},
    loadSentThreads: () => {},
    highlightNav: () => {},
    getSelectedEmailId: () => null,
  };

  registerUIOperations(mockOps);

  // Execute threadId action
  const execResultThread = await executeAIAction(res2.action);
  assert(execResultThread.success === true, 'executeAIAction succeeded for threadId');
  assert(
    openDetailCalledWith === 'thread_john_101',
    'openEmailDetail was called with resolved thread ID "thread_john_101"'
  );
  assert(
    execResultThread.metadata?.resolvedId === 'thread_john_101',
    'Execution metadata reports resolvedId'
  );

  // Execute emailId action
  const execResultEmail = await executeAIAction(res1.action);
  assert(execResultEmail.success === true, 'executeAIAction succeeded for emailId');
  assert(
    openDetailCalledWith === '18cf32918bc3',
    'openEmailDetail was called with message ID "18cf32918bc3"'
  );

  // Validate runtime action schema
  const validationThread = validateAIAction(res2.action);
  assert(validationThread.valid === true, 'OPEN_EMAIL with threadId passes runtime validator');

  const validationEmail = validateAIAction(res1.action);
  assert(validationEmail.valid === true, 'OPEN_EMAIL with emailId passes runtime validator');

  // -------------------------------------------------------------
  // Test 10: Validation Rejections
  // -------------------------------------------------------------
  console.log('\n--- Test 10: Validation Rejections for Invalid Payloads ---');
  const invalidEmpty = validateAIAction({
    type: 'OPEN_EMAIL',
    payload: {},
  });
  assert(invalidEmpty.valid === false, 'OPEN_EMAIL with no emailId and no threadId rejected');

  const invalidTypes = validateAIAction({
    type: 'OPEN_EMAIL',
    payload: { emailId: 12345 as any },
  });
  assert(invalidTypes.valid === false, 'OPEN_EMAIL with non-string emailId rejected');

  console.log(`\n🎉 ALL PART 9 AI OPEN EMAIL TESTS (${passedTests}/${totalTests}) PASSED!\n`);
}

runAIOpenEmailTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
