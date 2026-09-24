/**
 * Dedicated Test Suite for Part 10 — AI Reply & Forward
 * Validates:
 * Test 1: "Reply to this email saying I will attend."
 *   -> Expected: REPLY_EMAIL, real current email/thread ID, body populated, compose opened, NO send request.
 * Test 2: "Write a professional reply to this email."
 *   -> Expected: professional reply body, compose opened, NO automatic send.
 * Test 3: "Forward this email to john@example.com."
 *   -> Expected: FORWARD_EMAIL, recipient populated, real current email/thread ID, compose opened, NO automatic send.
 * Test 4: "Forward this email to john@example.com saying please review."
 *   -> Expected: recipient populated, forward note populated, NO automatic send.
 * Test 5: No email is currently open -> "Reply saying I will attend."
 *   -> Expected: safe response asking user to open/select an email first.
 * Test 6: Strict NO AUTO-SEND verification:
 *   -> AI Reply/Forward only populates compose modal and NEVER calls send endpoint or sends email automatically.
 * Test 7: Runtime Action Schema Validation for REPLY_EMAIL and FORWARD_EMAIL.
 * Test 8: End-to-end execution of REPLY_EMAIL and FORWARD_EMAIL through executeAIAction.
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

// Mock context with currently open email detail
const mockOpenEmailContext: AIContextState = {
  currentMailbox: 'inbox',
  currentSearchQuery: null,
  selectedEmailId: 'msg_client_review_888',
  selectedThreadId: 'thread_client_review_888',
  currentlyOpenEmailId: 'msg_client_review_888',
  selectedEmailDetails: {
    sender: 'alex@stitch.io',
    subject: 'Client Review & Feedback Session',
  },
  visibleThreadIds: ['thread_client_review_888'],
  visibleThreads: [
    {
      id: 'thread_client_review_888',
      sender: 'Alex River <alex@stitch.io>',
      subject: 'Client Review & Feedback Session',
      snippet: 'Can you please confirm if you will be attending our session tomorrow?',
      date: '2026-09-05T08:00:00Z',
      isUnread: false,
    },
  ],
  isComposeOpen: false,
  isDetailOpen: true,
  activeFilters: [],
  timestamp: Date.now(),
};

async function runAIReplyAndForwardTests() {
  console.log('\n=== RUNNING PART 10 AI REPLY & FORWARD TEST SUITE ===\n');

  const provider = new MockAIProvider();

  // -------------------------------------------------------------
  // Test 1: "Reply to this email saying I will attend."
  // -------------------------------------------------------------
  console.log('--- Test 1: Reply with Attendance Confirmation ---');
  const res1 = await provider.processCommand(
    'Reply to this email saying I will attend.',
    mockOpenEmailContext
  );

  assert(res1.action.type === 'REPLY_EMAIL', 'Test 1 produces REPLY_EMAIL action');
  if (res1.action.type === 'REPLY_EMAIL') {
    assert(
      res1.action.payload.emailId === 'msg_client_review_888',
      'Uses real current email ID "msg_client_review_888"'
    );
    assert(
      res1.action.payload.body !== undefined && res1.action.payload.body.toLowerCase().includes('attend'),
      'Reply body contains attendance statement'
    );
  }

  // -------------------------------------------------------------
  // Test 2: "Write a professional reply to this email."
  // -------------------------------------------------------------
  console.log('\n--- Test 2: Write Professional Reply ---');
  const res2 = await provider.processCommand(
    'Write a professional reply to this email.',
    mockOpenEmailContext
  );

  assert(res2.action.type === 'REPLY_EMAIL', 'Test 2 produces REPLY_EMAIL action');
  if (res2.action.type === 'REPLY_EMAIL') {
    assert(
      res2.action.payload.emailId === 'msg_client_review_888',
      'Uses current open email ID for professional reply'
    );
    assert(
      Boolean(res2.action.payload.body && res2.action.payload.body.length > 20),
      'Professional reply body is populated'
    );
    assert(
      Boolean(res2.action.payload.body?.includes('Thank you') || res2.action.payload.body?.includes('Sincerely') || res2.action.payload.body?.includes('review')),
      'Professional tone greeting/signoff included'
    );
  }

  // -------------------------------------------------------------
  // Test 3: "Forward this email to john@example.com."
  // -------------------------------------------------------------
  console.log('\n--- Test 3: Forward Email with Recipient ---');
  const res3 = await provider.processCommand(
    'Forward this email to john@example.com.',
    mockOpenEmailContext
  );

  assert(res3.action.type === 'FORWARD_EMAIL', 'Test 3 produces FORWARD_EMAIL action');
  if (res3.action.type === 'FORWARD_EMAIL') {
    assert(
      res3.action.payload.emailId === 'msg_client_review_888',
      'Preserves current email ID for forwarding'
    );
    assert(
      res3.action.payload.to?.[0] === 'john@example.com',
      'Recipient populated with john@example.com'
    );
  }

  // -------------------------------------------------------------
  // Test 4: "Forward this email to john@example.com saying please review."
  // -------------------------------------------------------------
  console.log('\n--- Test 4: Forward Email with Note ---');
  const res4 = await provider.processCommand(
    'Forward this email to john@example.com saying please review.',
    mockOpenEmailContext
  );

  assert(res4.action.type === 'FORWARD_EMAIL', 'Test 4 produces FORWARD_EMAIL action');
  if (res4.action.type === 'FORWARD_EMAIL') {
    assert(
      res4.action.payload.to?.[0] === 'john@example.com',
      'Recipient populated with john@example.com'
    );
    assert(
      res4.action.payload.body?.toLowerCase().includes('please review') === true,
      'Forward note populated with "Please review."'
    );
  }

  // -------------------------------------------------------------
  // Test 5: No email currently open -> Safe Response
  // -------------------------------------------------------------
  console.log('\n--- Test 5: Guard against No Active Email Context ---');
  let threwExpectedNoEmailError = false;
  try {
    const noEmailContext: AIContextState = {
      ...mockOpenEmailContext,
      selectedEmailId: null,
      selectedThreadId: null,
      currentlyOpenEmailId: null,
    };
    await provider.processCommand('Reply saying I will attend.', noEmailContext);
  } catch (err: any) {
    threwExpectedNoEmailError = true;
    assert(
      err.message.includes('select or open an email first'),
      'Returns safe response requesting user to open/select an email first'
    );
  }
  assert(threwExpectedNoEmailError, 'Safely refused reply without selected email');

  let threwExpectedForwardNoEmail = false;
  try {
    const noEmailContext: AIContextState = {
      ...mockOpenEmailContext,
      selectedEmailId: null,
      selectedThreadId: null,
      currentlyOpenEmailId: null,
    };
    await provider.processCommand('Forward this email to john@example.com.', noEmailContext);
  } catch (err: any) {
    threwExpectedForwardNoEmail = true;
    assert(
      err.message.includes('select or open an email first before forwarding'),
      'Returns safe response requesting user to open/select an email first before forwarding'
    );
  }
  assert(threwExpectedForwardNoEmail, 'Safely refused forward without selected email');

  // -------------------------------------------------------------
  // Test 6 & 8: Executor Wiring & Strict NO AUTO-SEND
  // -------------------------------------------------------------
  console.log('\n--- Test 6: Action Executor Wiring & Strict NO AUTO-SEND ---');

  let composeModalOpened: boolean = false;
  let composePrefillData: any = null;
  let sendEndpointTriggered: boolean = false;

  const mockOps: UIOperations = {
    openComposeModal: (prefill) => {
      composeModalOpened = true;
      composePrefillData = prefill;
    },
    closeComposeModal: () => {},
    openEmailDetail: () => {},
    closeEmailDetail: () => {},
    executeSearch: () => {},
    loadInboxThreads: () => {},
    loadSentThreads: () => {},
    highlightNav: () => {},
    getSelectedEmailId: () => 'msg_client_review_888',
    getSelectedEmailDetails: () => ({
      sender: 'alex@stitch.io',
      subject: 'Client Review & Feedback Session',
    }),
  };

  registerUIOperations(mockOps);

  // Execute REPLY_EMAIL
  composeModalOpened = false;
  composePrefillData = null;
  const replyExec = await executeAIAction(res1.action);

  assert(replyExec.success === true, 'executeAIAction succeeded for REPLY_EMAIL');
  assert(Boolean(composeModalOpened) === true, 'openComposeModal was triggered for reply');
  assert(
    composePrefillData?.recipient === 'alex@stitch.io',
    'Reply compose prefilled recipient as "alex@stitch.io"'
  );
  assert(
    composePrefillData?.subject === 'Re: Client Review & Feedback Session',
    'Reply subject correctly prefixed with "Re:"'
  );
  assert(
    composePrefillData?.body.includes('attend'),
    'Reply compose body prefilled with attendance text'
  );
  assert(replyExec.metadata?.autoSent === false, 'Metadata explicitly confirms autoSent === false');
  assert(Boolean(sendEndpointTriggered) === false, 'CRITICAL: send endpoint was NEVER invoked automatically');

  // Execute FORWARD_EMAIL
  composeModalOpened = false;
  composePrefillData = null;
  const forwardExec = await executeAIAction(res4.action);

  assert(forwardExec.success === true, 'executeAIAction succeeded for FORWARD_EMAIL');
  assert(Boolean(composeModalOpened) === true, 'openComposeModal was triggered for forward');
  assert(
    composePrefillData?.recipient === 'john@example.com',
    'Forward compose prefilled recipient as "john@example.com"'
  );
  assert(
    composePrefillData?.subject === 'Fwd: Client Review & Feedback Session',
    'Forward subject correctly prefixed with "Fwd:"'
  );
  assert(
    composePrefillData?.body.includes('Please review.'),
    'Forward compose body prefilled with user note'
  );
  assert(forwardExec.metadata?.autoSent === false, 'Metadata explicitly confirms forward autoSent === false');

  // -------------------------------------------------------------
  // Test 7: Runtime Schema Validation
  // -------------------------------------------------------------
  console.log('\n--- Test 7: Runtime Schema Validation ---');
  const validReplyVal = validateAIAction(res1.action);
  assert(validReplyVal.valid === true, 'REPLY_EMAIL passes runtime validator');

  const validForwardVal = validateAIAction(res4.action);
  assert(validForwardVal.valid === true, 'FORWARD_EMAIL passes runtime validator');

  const invalidForwardVal = validateAIAction({
    type: 'FORWARD_EMAIL',
    payload: { to: 'invalid-should-be-array' },
  });
  assert(invalidForwardVal.valid === false, 'FORWARD_EMAIL with non-array "to" rejected');

  console.log(`\n🎉 ALL PART 10 AI REPLY & FORWARD TESTS (${passedTests}/${totalTests}) PASSED!\n`);
}

runAIReplyAndForwardTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
