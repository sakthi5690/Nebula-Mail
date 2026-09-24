/**
 * Comprehensive Test Suite for Part 6 — AI Action Architecture
 * Validates:
 * 1. Runtime validation (valid actions accepted, invalid rejected)
 * 2. MockAIProvider pattern recognition across all 6 action types
 * 3. Frontend AI Action Executor dispatching and UI state coordination
 * 4. Error handling & fallback security (no eval, no injection)
 */

import { validateAIAction, isAIAction } from '../validator';
import { executeAIAction, registerUIOperations, UIOperations } from '../executor';
import { MockAIProvider } from '../../../../server/src/services/ai-provider';
import { AIAction } from '../actions.types';

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

async function runTests() {
  console.log('\n=== RUNNING PART 6 AI ACTION SUITE ===\n');

  // -------------------------------------------------------------
  // 1. RUNTIME ACTION VALIDATOR TESTS
  // -------------------------------------------------------------
  console.log('--- 1. Testing Runtime Action Validator ---');

  // Valid COMPOSE_EMAIL
  const validCompose: AIAction = {
    type: 'COMPOSE_EMAIL',
    payload: {
      to: ['alice@example.com'],
      subject: 'Q3 Financial Review',
      body: 'Please find attached the report.',
    },
  };
  assert(validateAIAction(validCompose).valid === true, 'Valid COMPOSE_EMAIL passes validation');
  assert(isAIAction(validCompose) === true, 'isAIAction typeguard returns true for valid compose');

  // Invalid COMPOSE_EMAIL (wrong type for "to")
  const invalidCompose = {
    type: 'COMPOSE_EMAIL',
    payload: {
      to: 'not-an-array',
      subject: 'Hey',
    },
  };
  const invalidComposeRes = validateAIAction(invalidCompose);
  assert(invalidComposeRes.valid === false, 'Invalid COMPOSE_EMAIL ("to" is string) rejected');
  assert(
    invalidComposeRes.error?.includes('"to" must be an array') === true,
    'Appropriate error message returned for invalid "to"'
  );

  // Valid SEARCH_EMAILS
  const validSearch: AIAction = {
    type: 'SEARCH_EMAILS',
    payload: {
      query: 'project roadmap',
      filter: { hasAttachment: true, from: 'sarah@stitch.io' },
    },
  };
  assert(validateAIAction(validSearch).valid === true, 'Valid SEARCH_EMAILS passes validation');

  // Invalid SEARCH_EMAILS (missing query)
  const invalidSearch = {
    type: 'SEARCH_EMAILS',
    payload: {
      filter: { hasAttachment: true },
    },
  };
  assert(validateAIAction(invalidSearch).valid === false, 'SEARCH_EMAILS without query rejected');

  // Valid OPEN_EMAIL
  const validOpen: AIAction = {
    type: 'OPEN_EMAIL',
    payload: { emailId: 'msg_18cf99ab' },
  };
  assert(validateAIAction(validOpen).valid === true, 'Valid OPEN_EMAIL passes validation');

  // Invalid OPEN_EMAIL (empty emailId)
  const invalidOpen = {
    type: 'OPEN_EMAIL',
    payload: { emailId: '   ' },
  };
  assert(validateAIAction(invalidOpen).valid === false, 'OPEN_EMAIL with empty ID rejected');

  // Valid REPLY_EMAIL
  const validReply: AIAction = {
    type: 'REPLY_EMAIL',
    payload: {
      replyAll: true,
      body: 'Sounds good to me!',
    },
  };
  assert(validateAIAction(validReply).valid === true, 'Valid REPLY_EMAIL passes validation');

  // Valid SET_FILTER
  const validFilter: AIAction = {
    type: 'SET_FILTER',
    payload: { filterType: 'unread', active: true },
  };
  assert(validateAIAction(validFilter).valid === true, 'Valid SET_FILTER passes validation');

  // Invalid SET_FILTER (unsupported filter type)
  const invalidFilter = {
    type: 'SET_FILTER',
    payload: { filterType: 'unknown_filter', active: true },
  };
  assert(validateAIAction(invalidFilter).valid === false, 'SET_FILTER with invalid filterType rejected');

  // Valid NAVIGATE
  const validNav: AIAction = {
    type: 'NAVIGATE',
    payload: { destination: 'sent' },
  };
  assert(validateAIAction(validNav).valid === true, 'Valid NAVIGATE passes validation');

  // Unknown Action Type rejection
  const maliciousAction = {
    type: 'EXECUTE_ARBITRARY_SCRIPT',
    payload: { code: 'alert(1)' },
  };
  assert(validateAIAction(maliciousAction).valid === false, 'Malicious / unknown action types strictly rejected');

  // -------------------------------------------------------------
  // 2. MOCK AI PROVIDER TESTS
  // -------------------------------------------------------------
  console.log('\n--- 2. Testing MockAIProvider Intent Recognition ---');

  const provider = new MockAIProvider();

  // Test Compose Intent
  const composeRes = await provider.processCommand('compose email to alex@stitch.io subject: Standup Notes body: Here are notes');
  assert(composeRes.action.type === 'COMPOSE_EMAIL', 'MockAI recognized compose command');
  if (composeRes.action.type === 'COMPOSE_EMAIL') {
    assert(composeRes.action.payload.to?.[0] === 'alex@stitch.io', 'Extracted recipient alex@stitch.io');
    assert(composeRes.action.payload.subject === 'Standup Notes', 'Extracted subject "Standup Notes"');
  }

  // Test Search Intent
  const searchRes = await provider.processCommand('search for invoices from billing@vendor.com');
  assert(searchRes.action.type === 'SEARCH_EMAILS', 'MockAI recognized search command');
  if (searchRes.action.type === 'SEARCH_EMAILS') {
    assert(searchRes.action.payload.query.includes('invoices'), 'Search query includes "invoices"');
    assert(searchRes.action.payload.filter?.from === 'billing@vendor.com', 'Extracted from filter billing@vendor.com');
  }

  // Test Open Email Intent
  const openRes = await provider.processCommand('open email thread_18c991a');
  assert(openRes.action.type === 'OPEN_EMAIL', 'MockAI recognized open email command');
  if (openRes.action.type === 'OPEN_EMAIL') {
    assert(openRes.action.payload.emailId === 'thread_18c991a', 'Extracted email ID correctly');
  }

  // Test Reply Intent
  const replyRes = await provider.processCommand('reply all saying confirmed for Tuesday', { selectedEmailId: 'msg_99' });
  assert(replyRes.action.type === 'REPLY_EMAIL', 'MockAI recognized reply intent');
  if (replyRes.action.type === 'REPLY_EMAIL') {
    assert(replyRes.action.payload.replyAll === true, 'Detected reply all');
    assert(replyRes.action.payload.emailId === 'msg_99', 'Used active context email ID');
  }

  // Test Filter Intent
  const filterRes = await provider.processCommand('show unread messages');
  assert(filterRes.action.type === 'SET_FILTER', 'MockAI recognized filter unread intent');
  if (filterRes.action.type === 'SET_FILTER') {
    assert(filterRes.action.payload.filterType === 'unread', 'Filter type is unread');
    assert(filterRes.action.payload.active === true, 'Filter active is true');
  }

  // Test Navigation Intent
  const navRes = await provider.processCommand('go to sent');
  assert(navRes.action.type === 'NAVIGATE', 'MockAI recognized navigation intent');
  if (navRes.action.type === 'NAVIGATE') {
    assert(navRes.action.payload.destination === 'sent', 'Destination set to sent');
  }

  // -------------------------------------------------------------
  // 3. FRONTEND ACTION EXECUTOR TESTS
  // -------------------------------------------------------------
  console.log('\n--- 3. Testing Frontend Action Executor ---');

  // Track mock UI method invocations
  const calls: { name: string; args: any }[] = [];
  const mockUI: UIOperations = {
    openComposeModal: (prefill) => { calls.push({ name: 'openComposeModal', args: prefill }); },
    closeComposeModal: () => { calls.push({ name: 'closeComposeModal', args: null }); },
    openEmailDetail: (id) => { calls.push({ name: 'openEmailDetail', args: id }); },
    closeEmailDetail: () => { calls.push({ name: 'closeEmailDetail', args: null }); },
    executeSearch: (query) => { calls.push({ name: 'executeSearch', args: query }); },
    loadInboxThreads: () => { calls.push({ name: 'loadInboxThreads', args: null }); },
    loadSentThreads: () => { calls.push({ name: 'loadSentThreads', args: null }); },
    highlightNav: (box) => { calls.push({ name: 'highlightNav', args: box }); },
    getSelectedEmailId: () => 'msg_active_123',
    getSelectedEmailDetails: () => ({ sender: 'boss@corp.com', subject: 'Important Project' }),
  };

  registerUIOperations(mockUI);

  // Execute COMPOSE_EMAIL
  const execCompose = await executeAIAction({
    type: 'COMPOSE_EMAIL',
    payload: {
      to: ['client@domain.com'],
      subject: 'Hello',
      body: 'Welcome aboard',
    },
  });
  assert(execCompose.success === true, 'executeAIAction succeeded for COMPOSE_EMAIL');
  const composeCall = calls.find((c) => c.name === 'openComposeModal');
  assert(composeCall !== undefined, 'openComposeModal was triggered');
  assert(composeCall?.args.recipient === 'client@domain.com', 'Recipient was prefilled properly');

  // Execute SEARCH_EMAILS
  calls.length = 0;
  const execSearch = await executeAIAction({
    type: 'SEARCH_EMAILS',
    payload: {
      query: 'meeting notes',
      filter: { hasAttachment: true },
    },
  });
  assert(execSearch.success === true, 'executeAIAction succeeded for SEARCH_EMAILS');
  const searchCall = calls.find((c) => c.name === 'executeSearch');
  assert(searchCall !== undefined, 'executeSearch was triggered');
  assert(searchCall?.args.includes('has:attachment'), 'has:attachment operator appended');

  // Execute NAVIGATE
  calls.length = 0;
  const execNav = await executeAIAction({
    type: 'NAVIGATE',
    payload: { destination: 'sent' },
  });
  assert(execNav.success === true, 'executeAIAction succeeded for NAVIGATE to sent');
  assert(calls.some((c) => c.name === 'highlightNav' && c.args === 'sent'), 'highlightNav("sent") called');
  assert(calls.some((c) => c.name === 'loadSentThreads'), 'loadSentThreads called');

  // Execute Malicious/corrupted action
  const execMalicious = await executeAIAction({
    type: 'MALICIOUS_ACTION',
    payload: {},
  });
  assert(execMalicious.success === false, 'Malformed action safely returned success: false');
  assert(execMalicious.error !== undefined, 'Error message is populated on failure');

  console.log(`\n🎉 ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY!`);
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
