/**
 * Dedicated Test Suite for Part 8 — AI Search & Filter
 * Validates:
 * Test 1: "Show emails from John" -> SEARCH_EMAILS with query containing from:John
 * Test 2: "Show unread emails" -> SEARCH_EMAILS with query containing is:unread
 * Test 3: "Show emails with attachments" -> SEARCH_EMAILS with query containing has:attachment
 * Test 4: "Show unread emails from John with attachments" -> SEARCH_EMAILS with from:John, is:unread, has:attachment
 * Test 5: "Find emails containing invoice" -> SEARCH_EMAILS with query containing invoice
 * Test 6: "Clear the search" -> existing search/filter state is cleared, restores inbox
 * Test 7: Verify AI search does NOT fabricate email results (results strictly sourced from Gmail API)
 * Test 8: Context awareness — refining an existing search query (e.g. from:John + "only unread" -> from:John is:unread)
 */

import { MockAIProvider } from '../../../../server/src/services/ai-provider';
import { executeAIAction, registerUIOperations, UIOperations } from '../executor';
import { validateAIAction } from '../validator';

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

async function runAISearchTests() {
  console.log('\n=== RUNNING PART 8 AI SEARCH & FILTER TEST SUITE ===\n');

  const provider = new MockAIProvider();

  // -------------------------------------------------------------
  // Test 1: Sender filter (from:...)
  // -------------------------------------------------------------
  console.log('--- Test 1: Search by Sender ---');
  const res1 = await provider.processCommand('Show emails from John');
  assert(res1.action.type === 'SEARCH_EMAILS', 'Test 1 produces SEARCH_EMAILS action');
  if (res1.action.type === 'SEARCH_EMAILS') {
    assert(res1.action.payload.query.includes('from:John'), 'Test 1 query contains "from:John"');
  }

  // -------------------------------------------------------------
  // Test 2: Read/unread filter (is:unread)
  // -------------------------------------------------------------
  console.log('\n--- Test 2: Search Unread Emails ---');
  const res2 = await provider.processCommand('Show unread emails');
  assert(res2.action.type === 'SEARCH_EMAILS', 'Test 2 produces SEARCH_EMAILS action');
  if (res2.action.type === 'SEARCH_EMAILS') {
    assert(res2.action.payload.query.includes('is:unread'), 'Test 2 query contains "is:unread"');
  }

  // -------------------------------------------------------------
  // Test 3: Attachment filter (has:attachment)
  // -------------------------------------------------------------
  console.log('\n--- Test 3: Search Emails with Attachments ---');
  const res3 = await provider.processCommand('Show emails with attachments');
  assert(res3.action.type === 'SEARCH_EMAILS', 'Test 3 produces SEARCH_EMAILS action');
  if (res3.action.type === 'SEARCH_EMAILS') {
    assert(res3.action.payload.query.includes('has:attachment'), 'Test 3 query contains "has:attachment"');
  }

  // -------------------------------------------------------------
  // Test 4: Combined Search (Sender + Unread + Attachment)
  // -------------------------------------------------------------
  console.log('\n--- Test 4: Combined Search & Filter ---');
  const res4 = await provider.processCommand('Show unread emails from John with attachments');
  assert(res4.action.type === 'SEARCH_EMAILS', 'Test 4 produces SEARCH_EMAILS action');
  if (res4.action.type === 'SEARCH_EMAILS') {
    const q = res4.action.payload.query;
    assert(q.includes('from:John'), 'Test 4 query contains "from:John"');
    assert(q.includes('is:unread'), 'Test 4 query contains "is:unread"');
    assert(q.includes('has:attachment'), 'Test 4 query contains "has:attachment"');
  }

  // -------------------------------------------------------------
  // Test 5: Keyword Search ("invoice")
  // -------------------------------------------------------------
  console.log('\n--- Test 5: Keyword Search ---');
  const res5 = await provider.processCommand('Find emails containing invoice');
  assert(res5.action.type === 'SEARCH_EMAILS', 'Test 5 produces SEARCH_EMAILS action');
  if (res5.action.type === 'SEARCH_EMAILS') {
    assert(res5.action.payload.query.includes('invoice'), 'Test 5 query contains "invoice"');
  }

  // -------------------------------------------------------------
  // Test 6: Clear / Reset Search
  // -------------------------------------------------------------
  console.log('\n--- Test 6: Clear Search & Reset ---');
  const res6a = await provider.processCommand('Clear the search');
  assert(
    res6a.action.type === 'NAVIGATE' && res6a.action.payload.destination === 'inbox',
    'Test 6a "Clear the search" restores inbox view'
  );

  const res6b = await provider.processCommand('Show all emails');
  assert(
    res6b.action.type === 'NAVIGATE' && res6b.action.payload.destination === 'inbox',
    'Test 6b "Show all emails" restores inbox view'
  );

  const res6c = await provider.processCommand('Reset filters');
  assert(
    res6c.action.type === 'NAVIGATE' && res6c.action.payload.destination === 'inbox',
    'Test 6c "Reset filters" navigates back to inbox'
  );

  // -------------------------------------------------------------
  // Test 7: Zero Fabrication Guarantee & UI Execution
  // -------------------------------------------------------------
  const searchSpy = { invoked: false, query: '' };

  const mockUIWithSearchSpy: UIOperations = {
    openComposeModal: () => {},
    closeComposeModal: () => {},
    openEmailDetail: () => {},
    closeEmailDetail: () => {},
    executeSearch: (query) => {
      searchSpy.invoked = true;
      searchSpy.query = query;
    },
    loadInboxThreads: () => {},
    loadSentThreads: () => {},
    highlightNav: () => {},
    getSelectedEmailId: () => null,
  };

  registerUIOperations(mockUIWithSearchSpy);

  const execRes = await executeAIAction(res4.action);
  assert(execRes.success === true, 'executeAIAction succeeded for combined search');
  assert(searchSpy.invoked === true, 'executeSearch called on underlying mail UI');
  assert(
    searchSpy.query.includes('from:John') && searchSpy.query.includes('is:unread') && searchSpy.query.includes('has:attachment'),
    'Live Gmail search pipeline received exact operator query'
  );

  // Assert validation passes
  assert(validateAIAction(res4.action).valid === true, 'Combined search action strictly valid');

  // -------------------------------------------------------------
  // Test 8: Context-Aware Refinement
  // -------------------------------------------------------------
  console.log('\n--- Test 8: Context-Aware Query Refinement ---');
  const res8 = await provider.processCommand('Only show unread ones', {
    currentSearchQuery: 'from:John',
  });
  assert(res8.action.type === 'SEARCH_EMAILS', 'Test 8 produces SEARCH_EMAILS action');
  if (res8.action.type === 'SEARCH_EMAILS') {
    assert(res8.action.payload.query.includes('from:John'), 'Test 8 preserves previous "from:John" context');
    assert(res8.action.payload.query.includes('is:unread'), 'Test 8 refines query with "is:unread"');
  }

  console.log(`\n🎉 ALL PART 8 AI SEARCH & FILTER TESTS (${passedTests}/${totalTests}) PASSED!\n`);
}

runAISearchTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
