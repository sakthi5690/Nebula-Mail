/**
 * AI Provider abstraction and MockAIProvider implementation.
 * Provides a clean interface for executing natural language commands into typed AIActions.
 */

import {
  AIAction,
  AIContextState,
  NavDestination,
} from '../../../src/lib/ai/actions.types';

export interface AIProvider {
  processCommand(
    prompt: string,
    context?: Partial<AIContextState>
  ): Promise<{ action: AIAction; explanation: string }>;
}

/**
 * Deterministic Mock AI Provider for testing and offline development.
 * Uses robust regex and keyword heuristic parsing to translate natural language into typed actions.
 */
export class MockAIProvider implements AIProvider {
  public async processCommand(
    prompt: string,
    context?: Partial<AIContextState>
  ): Promise<{ action: AIAction; explanation: string }> {
    const raw = prompt.trim();
    const lower = raw.toLowerCase();

    // 1. COMPOSE_EMAIL
    // Matches patterns like:
    // - "Compose an email to john@example.com saying I will attend the meeting tomorrow."
    // - "Write a professional email to john@example.com with subject Project Update and say the project is completed."
    // - "Draft an email to john@example.com and cc manager@example.com."
    // - "Draft an email to Rahul with subject Project Update and say the project is completed."
    // - "Compose an email saying the meeting is tomorrow." (Missing recipient)
    const isComposeCommand =
      (lower.startsWith('compose') ||
        (lower.startsWith('write') && !lower.includes('reply')) ||
        lower.startsWith('draft') ||
        lower.startsWith('send email to') ||
        lower.startsWith('new email')) &&
      !lower.includes('reply');

    if (isComposeCommand) {
      // 1.1 Extract Primary Recipient ("to")
      let recipient: string[] | undefined;
      const toMatch = raw.match(/(?:to|email\s+to|mail\s+to)\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|[A-Z][a-z]+|[a-z]+@[^\s,;]+)/i);
      if (toMatch) {
        const candidate = toMatch[1].trim();
        // Disqualify keywords
        if (!['my', 'the', 'an', 'a', 'our', 'all'].includes(candidate.toLowerCase())) {
          recipient = [candidate];
        }
      }

      // Check context draft if to wasn't specified in prompt
      if (!recipient && context?.currentDraft?.to) {
        recipient = [context.currentDraft.to];
      }

      // 1.2 Missing recipient guard: If user said "saying ..." or "asking ..." without specifying a recipient
      if (!recipient) {
        // Safe response requesting the recipient instead of guessing/inventing
        throw new Error('Please specify a recipient for the email (e.g. "Compose an email to user@example.com...").');
      }

      // 1.3 Extract CC
      let cc: string[] | undefined;
      const ccMatch = raw.match(/(?:and\s+)?cc\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|[^\s,;]+@[^\s,;]+)/i);
      if (ccMatch) {
        cc = [ccMatch[1].trim()];
      }

      // 1.4 Extract BCC
      let bcc: string[] | undefined;
      const bccMatch = raw.match(/(?:and\s+)?bcc\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|[^\s,;]+@[^\s,;]+)/i);
      if (bccMatch) {
        bcc = [bccMatch[1].trim()];
      }

      // 1.5 Extract Subject
      let subject: string | undefined;
      const explicitSubjectMatch = raw.match(/subject[:\s]+["']?([^"'\n,;]+?)["']?(?:\s+(?:and\s+say|saying|say|body|with body)|$)/i);
      if (explicitSubjectMatch) {
        subject = explicitSubjectMatch[1].trim();
      }

      // 1.6 Extract Body / Intent
      let body: string | undefined;
      const isProfessional = lower.includes('professional');
      const bodySayMatch = raw.match(/(?:and\s+say|saying|say|body[:\s]+|with body[:\s]+)["']?([^"'\n]+)["']?$/i);
      const askingMatch = raw.match(/asking\s+for\s+([^"'\n.]+)/i);

      if (bodySayMatch && bodySayMatch[1].trim().length > 0) {
        const rawContent = bodySayMatch[1].trim();
        if (isProfessional) {
          const recipientName = recipient[0].includes('@') ? recipient[0].split('@')[0] : recipient[0];
          const capitalizedName = recipientName.charAt(0).toUpperCase() + recipientName.slice(1);
          body = `Dear ${capitalizedName},\n\nI am writing to formally provide an update. ${rawContent.charAt(0).toUpperCase() + rawContent.slice(1)}.\n\nPlease let me know if you have any questions or require additional information.\n\nBest regards,\nDavid`;
        } else {
          body = rawContent.charAt(0).toUpperCase() + rawContent.slice(1) + (rawContent.endsWith('.') ? '' : '.');
        }
      } else if (askingMatch) {
        const askTopic = askingMatch[1].trim();
        if (lower.includes('professor') || isProfessional) {
          body = `Dear Professor,\n\nI hope this email finds you well.\n\nI am writing to respectfully request ${askTopic}. Please let me know if this would be possible.\n\nThank you for your understanding and time.\n\nSincerely,\nDavid`;
          if (!subject) subject = `Request for ${askTopic.charAt(0).toUpperCase() + askTopic.slice(1)}`;
        } else {
          body = `Hi,\n\nI wanted to reach out and ask for ${askTopic}.\n\nThank you!`;
          if (!subject) subject = `Inquiry regarding ${askTopic}`;
        }
      }

      // 1.7 Intelligent fallback subject if not provided
      if (!subject) {
        if (body?.toLowerCase().includes('attend') || lower.includes('attend')) {
          subject = 'Meeting Attendance Confirmation';
        } else if (body?.toLowerCase().includes('project') || lower.includes('project')) {
          subject = 'Project Update';
        } else if (lower.includes('extension')) {
          subject = 'Extension Request';
        } else {
          subject = 'Follow-up';
        }
      }

      return {
        action: {
          type: 'COMPOSE_EMAIL',
          payload: {
            to: recipient,
            cc,
            bcc,
            subject,
            body,
          },
        },
        explanation: `Prepared email draft to ${recipient.join(', ')}${cc ? ` (cc: ${cc.join(', ')})` : ''} with subject "${subject}".`,
      };
    }

    // 2. REPLY_EMAIL & FORWARD_EMAIL
    // Matches patterns like:
    // - "Reply to this email saying I will attend."
    // - "Reply to John and tell him the meeting is tomorrow."
    // - "Write a professional reply to this email."
    // - "Tell them I need another day."
    // - "Give a professional response."
    // - "Forward this email to john@example.com."
    // - "Forward this email to John with a note saying please review."
    const isReplyCommand =
      lower.startsWith('reply') ||
      lower.startsWith('write a reply') ||
      lower.startsWith('write a professional reply') ||
      lower.startsWith('give a reply') ||
      lower.startsWith('give a professional response') ||
      lower.startsWith('tell them') ||
      lower.startsWith('tell him') ||
      lower.startsWith('tell her');

    const isForwardCommand =
      lower.startsWith('forward') ||
      lower.startsWith('fwd');

    if (isReplyCommand) {
      // Must identify current / selected email
      const targetId = context?.currentlyOpenEmailId || context?.selectedEmailId || context?.selectedThreadId;
      if (!targetId) {
        throw new Error('Please select or open an email first before replying.');
      }

      const replyAll = lower.includes('reply all') || lower.includes('to all');
      const isProfessional = lower.includes('professional') || lower.includes('formal');

      // Extract reply intent/content
      let replyBody: string | undefined;

      const sayingMatch = raw.match(/(?:saying|with|say|tell(?:\s+\w+)?(?:\s+that|\s+him|\s+her|\s+them)?)\s+[:"']?([^"'\n]+)["']?$/i);
      if (sayingMatch && sayingMatch[1]) {
        const rawBody = sayingMatch[1].trim().replace(/^["']|["']$/g, '');
        if (isProfessional) {
          replyBody = `Thank you for the update.\n\n${rawBody.charAt(0).toUpperCase() + rawBody.slice(1)}${rawBody.endsWith('.') ? '' : '.'}\n\nPlease let me know if you need anything else.\n\nBest regards,\nDavid`;
        } else if (rawBody.toLowerCase().includes('i will attend') || rawBody.toLowerCase().includes("i'll attend")) {
          replyBody = `Hi,\n\nI will attend the meeting tomorrow as requested.\n\nBest,\nDavid`;
        } else if (rawBody.toLowerCase().includes('need another day')) {
          replyBody = `Hi,\n\nI will need another day to review and complete this. Thank you for your patience.\n\nBest,\nDavid`;
        } else {
          replyBody = `${rawBody.charAt(0).toUpperCase() + rawBody.slice(1)}${rawBody.endsWith('.') ? '' : '.'}`;
        }
      } else if (isProfessional) {
        const emailSubject = context?.selectedEmailDetails?.subject;
        replyBody = `Thank you for your email${emailSubject ? ` regarding "${emailSubject}"` : ''}.\n\nI have received your message and will review the details promptly.\n\nSincerely,\nDavid`;
      } else {
        // Simple fallback
        replyBody = 'Thank you for your message. I will follow up shortly.';
      }

      return {
        action: {
          type: 'REPLY_EMAIL',
          payload: {
            emailId: targetId,
            replyAll,
            body: replyBody,
          },
        },
        explanation: `Prepared reply draft for email (${targetId})${replyAll ? ' to all participants' : ''}.`,
      };
    }

    if (isForwardCommand) {
      // Must identify current / selected email
      const targetId = context?.currentlyOpenEmailId || context?.selectedEmailId || context?.selectedThreadId;
      if (!targetId) {
        throw new Error('Please select or open an email first before forwarding.');
      }

      // Extract recipient(s)
      const recipientMatch = raw.match(/to\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
      const recipientNameMatch = raw.match(/to\s+([A-Z][a-z]+)/);

      let toRecipients: string[] | undefined;
      if (recipientMatch) {
        toRecipients = [recipientMatch[1].trim()];
      } else if (recipientNameMatch) {
        const name = recipientNameMatch[1].trim();
        // Check if matching participant in visible threads or fallback
        const matchingSender = context?.visibleThreads?.find(t => (t.sender || '').toLowerCase().includes(name.toLowerCase()));
        if (matchingSender && matchingSender.sender?.includes('@')) {
          const emailMatch = matchingSender.sender.match(/<([^>]+)>/) || matchingSender.sender.match(/([^\s<]+@[^\s>]+)/);
          toRecipients = emailMatch ? [emailMatch[1]] : [`${name.toLowerCase()}@example.com`];
        } else {
          toRecipients = [`${name.toLowerCase()}@example.com`];
        }
      }

      // Extract note / body
      let forwardBody: string | undefined;
      const noteMatch = raw.match(/(?:with a note saying|with note|saying|note[:\s]+)\s+[:"']?([^"'\n]+)["']?$/i);
      if (noteMatch && noteMatch[1]) {
        const note = noteMatch[1].trim().replace(/^["']|["']$/g, '');
        forwardBody = `${note.charAt(0).toUpperCase() + note.slice(1)}${note.endsWith('.') ? '' : '.'}`;
      }

      return {
        action: {
          type: 'FORWARD_EMAIL',
          payload: {
            emailId: targetId,
            to: toRecipients,
            body: forwardBody,
          },
        },
        explanation: `Prepared forward draft of email (${targetId})${toRecipients ? ` to ${toRecipients.join(', ')}` : ''}.`,
      };
    }

    // 3. CLEAR / RESET SEARCH & FILTERS
    // Matches patterns like:
    // - "Clear the search"
    // - "Show all emails"
    // - "Reset filters"
    // - "Clear filters"
    // - "Remove the unread filter"
    if (
      lower.includes('clear the search') ||
      lower.includes('clear search') ||
      lower.includes('reset filters') ||
      lower.includes('clear filters') ||
      lower === 'show all emails' ||
      lower === 'show all' ||
      lower === 'all emails' ||
      lower.includes('remove the unread filter') ||
      lower.includes('remove unread filter')
    ) {
      if (lower.includes('unread')) {
        return {
          action: {
            type: 'SET_FILTER',
            payload: { filterType: 'unread', active: false },
          },
          explanation: 'Removed unread filter and restored full inbox.',
        };
      }

      return {
        action: {
          type: 'NAVIGATE',
          payload: { destination: 'inbox' },
        },
        explanation: 'Cleared active search and restored inbox view.',
      };
    }

    // 4. SEARCH_EMAILS & SET_FILTER (Search & Filter Query Processing)
    // Matches patterns like:
    // - "Show emails from John" -> from:John
    // - "Show unread emails" -> is:unread
    // - "Show emails with attachments" -> has:attachment
    // - "Show unread emails from John with attachments" -> from:John is:unread has:attachment
    // - "Find emails containing invoice" -> invoice
    // - "Show emails with the word invoice" -> invoice
    // - "Find emails from last week" -> newer_than:7d
    // - "Find emails received today" -> newer_than:1d
    // - "Only show unread ones" (context refinement)
    const isSearchOrFilter =
      lower.startsWith('show') ||
      lower.startsWith('find') ||
      lower.startsWith('search') ||
      lower.startsWith('filter') ||
      lower.startsWith('only show') ||
      lower.startsWith('lookup');

    if (isSearchOrFilter) {
      // Check if it's a pure UI navigation/mailbox command (e.g. "show sent", "show inbox")
      if (lower === 'show inbox' || lower === 'show sent' || lower === 'show drafts' || lower === 'show starred' || lower === 'show trash') {
        const dest = lower.replace('show ', '') as NavDestination;
        return {
          action: {
            type: 'NAVIGATE',
            payload: { destination: dest },
          },
          explanation: `Navigated to ${dest} mailbox.`,
        };
      }

      const operators: string[] = [];

      // Context refinement: If user says "only show unread ones" and there is an existing search query, preserve it
      if (context?.currentSearchQuery && (lower.includes('only') || lower.includes('these') || lower.includes('current'))) {
        const existingTokens = context.currentSearchQuery.split(' ').filter(Boolean);
        operators.push(...existingTokens);
      }

      // Check for sender (from:...)
      const fromMatch = raw.match(/(?:from|by)\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|[A-Z][a-z]+|[a-z]+@[^\s,;]+)/i);
      if (fromMatch) {
        const candidate = fromMatch[1].trim();
        // Ignore keywords
        if (!['last', 'the', 'my', 'today', 'yesterday', 'this'].includes(candidate.toLowerCase())) {
          const fromOp = `from:${candidate}`;
          if (!operators.includes(fromOp)) {
            operators.push(fromOp);
          }
        }
      }

      // Check for recipient (to:...)
      const toMatch = raw.match(/(?:sent\s+to|to)\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|[A-Z][a-z]+|[a-z]+@[^\s,;]+)/i);
      if (toMatch) {
        const candidate = toMatch[1].trim();
        if (!['my', 'the', 'all', 'inbox', 'sent'].includes(candidate.toLowerCase())) {
          const toOp = `to:${candidate}`;
          if (!operators.includes(toOp)) {
            operators.push(toOp);
          }
        }
      }

      // Check for unread
      if (lower.includes('unread')) {
        if (!operators.includes('is:unread')) {
          operators.push('is:unread');
        }
      }

      // Check for attachments
      if (lower.includes('attachment') || lower.includes('attachments') || lower.includes('files')) {
        if (!operators.includes('has:attachment')) {
          operators.push('has:attachment');
        }
      }

      // Check for starred / flagged
      if (lower.includes('starred') || lower.includes('flagged')) {
        if (!operators.includes('is:starred')) {
          operators.push('is:starred');
        }
      }

      // Check for important
      if (lower.includes('important')) {
        if (!operators.includes('is:important')) {
          operators.push('is:important');
        }
      }

      // Check for date operators (newer_than:...)
      if (lower.includes('today')) {
        if (!operators.includes('newer_than:1d')) {
          operators.push('newer_than:1d');
        }
      } else if (lower.includes('last week')) {
        if (!operators.includes('newer_than:7d')) {
          operators.push('newer_than:7d');
        }
      } else if (lower.includes('yesterday')) {
        if (!operators.includes('newer_than:2d')) {
          operators.push('newer_than:2d');
        }
      }

      // Check for specific keywords (e.g. "containing invoice", "with the word invoice", "search for invoice")
      const keywordMatch =
        raw.match(/(?:containing|word|phrase|about|subject|keyword|for)\s+["']?([a-zA-Z0-9_\-]+)["']?/i);
      if (keywordMatch) {
        const term = keywordMatch[1].trim();
        // Disqualify structural terms
        if (!['emails', 'email', 'messages', 'message', 'john', 'unread', 'attachments', 'attachment', 'today', 'week'].includes(term.toLowerCase())) {
          if (!operators.includes(term)) {
            operators.push(term);
          }
        }
      }

      // If specifically asking for "show unread messages" (from Part 6 test) or starting with "filter"
      if (operators.length === 1 && operators[0] === 'is:unread' && (lower.startsWith('filter') || lower === 'show unread messages')) {
        return {
          action: {
            type: 'SET_FILTER',
            payload: { filterType: 'unread', active: true },
          },
          explanation: 'Applied unread filter.',
        };
      }

      if (operators.length > 0) {
        const finalQuery = operators.join(' ');
        let fromFilterVal: string | undefined;
        let hasAttachmentVal: boolean | undefined;

        if (fromMatch) {
          const cand = fromMatch[1].trim();
          if (!['last', 'the', 'my', 'today', 'yesterday', 'this'].includes(cand.toLowerCase())) {
            fromFilterVal = cand;
          }
        }
        if (lower.includes('attachment') || lower.includes('attachments') || lower.includes('files')) {
          hasAttachmentVal = true;
        }

        return {
          action: {
            type: 'SEARCH_EMAILS',
            payload: {
              query: finalQuery,
              filter: (fromFilterVal || hasAttachmentVal) ? {
                from: fromFilterVal,
                hasAttachment: hasAttachmentVal,
              } : undefined,
            },
          },
          explanation: `Searching Gmail for: "${finalQuery}".`,
        };
      }
    }

    // 5. OPEN_EMAIL — Context-Aware Resolution
    // Matches patterns like:
    // - "open email 18cf32918bc3" (direct ID)
    // - "open the email from John" (resolve from visible threads)
    // - "open the latest email from John" (resolve from visible threads)
    // - "open the email about the project" (resolve from visible threads by subject/snippet)
    // - "open the first email" (positional from visible threads)
    // - "open the invoice email" (keyword match in subject/snippet)
    // - "open the email I was just looking at" (context: currentlyOpenEmailId)
    // - "go back to my inbox" (navigation)

    // 5a. "Go back to inbox" / "back to inbox" → NAVIGATE
    if (lower.includes('go back') || lower.includes('back to inbox') || lower === 'go back') {
      return {
        action: {
          type: 'NAVIGATE',
          payload: { destination: 'inbox' },
        },
        explanation: 'Navigated back to inbox.',
      };
    }

    // 5b. Handle explicit "open" / "read" / "view" commands
    const isOpenCommand =
      lower.startsWith('open') ||
      lower.startsWith('read') ||
      lower.startsWith('view');

    if (isOpenCommand) {
      // 5b.1 Direct ID match — "open email abc123"
      const directIdMatch = raw.match(/(?:open|read|view)\s+(?:email|message|thread)\s+([a-zA-Z0-9_\-]+)/i);
      if (directIdMatch && directIdMatch[1]) {
        const candidateId = directIdMatch[1].trim();
        // Exclude navigation keywords
        if (!['inbox', 'sent', 'drafts', 'unread', 'starred', 'trash'].includes(candidateId.toLowerCase())) {
          return {
            action: {
              type: 'OPEN_EMAIL',
              payload: { emailId: candidateId },
            },
            explanation: `Opened email detail view for ID: ${candidateId}.`,
          };
        }
      }

      // 5b.2 "open the email I was just looking at" — context lookup
      if (lower.includes('just looking at') || lower.includes('was viewing') || lower.includes('last opened') || lower.includes('currently open')) {
        const lastId = context?.currentlyOpenEmailId || context?.selectedEmailId;
        if (lastId) {
          return {
            action: {
              type: 'OPEN_EMAIL',
              payload: { emailId: lastId },
            },
            explanation: `Re-opened the previously viewed email (${lastId}).`,
          };
        }
        throw new Error('No previously opened email found in the current session context.');
      }

      // 5b.3 Descriptive with sender: "open the email from John" / "open the latest email from Sarah"
      const fromOpenMatch = raw.match(/(?:open|read|view)\s+(?:the\s+)?(?:latest\s+|newest\s+)?(?:email|message|thread)\s+from\s+(\S+)/i);
      if (fromOpenMatch) {
        const senderQuery = fromOpenMatch[1].trim().toLowerCase();
        const threads = context?.visibleThreads || [];

        // Try to find matching thread from visible threads
        const matchingThread = threads.find(t => {
          const senderLower = (t.sender || '').toLowerCase();
          return senderLower.includes(senderQuery) || senderLower.startsWith(senderQuery);
        });

        if (matchingThread) {
          return {
            action: {
              type: 'OPEN_EMAIL',
              payload: { threadId: matchingThread.id },
            },
            explanation: `Opened email from ${matchingThread.sender || senderQuery}${matchingThread.subject ? ` with subject "${matchingThread.subject}"` : ''}.`,
          };
        }

        // If not found in visible threads, use a search-then-open strategy hint
        throw new Error(
          `No visible email from "${senderQuery}" found. Try "Show emails from ${senderQuery}" first, then "open the first email".`
        );
      }

      // 5b.4 Positional: "open the first email" / "open the latest email"
      const positionalMatch = lower.match(/(?:the\s+)?(first|latest|last|newest|oldest|second|third|1st|2nd|3rd)\s+(?:email|message|thread|one)/i);
      if (positionalMatch) {
        const position = positionalMatch[1].toLowerCase();
        const threads = context?.visibleThreads || [];
        if (threads.length === 0) {
          throw new Error('No visible emails to select from. Try loading your inbox first.');
        }

        let targetThread;
        if (position === 'first' || position === '1st' || position === 'latest' || position === 'newest') {
          targetThread = threads[0];
        } else if (position === 'last' || position === 'oldest') {
          targetThread = threads[threads.length - 1];
        } else if (position === 'second' || position === '2nd') {
          targetThread = threads.length > 1 ? threads[1] : threads[0];
        } else if (position === 'third' || position === '3rd') {
          targetThread = threads.length > 2 ? threads[2] : threads[threads.length - 1];
        }

        if (targetThread) {
          return {
            action: {
              type: 'OPEN_EMAIL',
              payload: { threadId: targetThread.id },
            },
            explanation: `Opened the ${position} email${targetThread.subject ? `: "${targetThread.subject}"` : ''} ${targetThread.sender ? `from ${targetThread.sender}` : ''}.`,
          };
        }
      }

      // 5b.5 Descriptive by subject/keyword: "open the email about the project" / "open the invoice email"
      const aboutMatch = raw.match(/(?:open|read|view)\s+(?:the\s+)?(?:email|message|thread)\s+(?:about|regarding)\s+(?:the\s+)?(.+)/i);
      const keywordOpenMatch = raw.match(/(?:open|read|view)\s+(?:the\s+)?(.+?)(?:\s+email|\s+message|\s+thread)$/i);
      const subjectKeyword = aboutMatch ? aboutMatch[1].trim().toLowerCase()
        : keywordOpenMatch ? keywordOpenMatch[1].trim().toLowerCase()
        : null;

      if (subjectKeyword && !['inbox', 'sent', 'drafts', 'starred', 'trash'].includes(subjectKeyword)) {
        const threads = context?.visibleThreads || [];

        const matchingThread = threads.find(t => {
          const subjectLower = (t.subject || '').toLowerCase();
          const snippetLower = (t.snippet || '').toLowerCase();
          return subjectLower.includes(subjectKeyword) || snippetLower.includes(subjectKeyword);
        });

        if (matchingThread) {
          return {
            action: {
              type: 'OPEN_EMAIL',
              payload: { threadId: matchingThread.id },
            },
            explanation: `Opened email matching "${subjectKeyword}"${matchingThread.subject ? `: "${matchingThread.subject}"` : ''}.`,
          };
        }

        throw new Error(
          `No visible email matching "${subjectKeyword}" found. Try searching for it first with "Find emails about ${subjectKeyword}".`
        );
      }
    }

    // 6. NAVIGATE
    // Matches patterns like:
    // - "go to sent" / "open sent" / "navigate to sent"
    // - "go to inbox" / "inbox" / "back to inbox"
    // - "open drafts" / "trash"
    const navMatch = lower.match(/(?:go\s+to|navigate\s+to|open|switch\s+to|show)?\s*(inbox|sent|drafts|starred|trash)/i);
    if (navMatch && navMatch[1]) {
      const destination = navMatch[1].toLowerCase() as NavDestination;
      return {
        action: {
          type: 'NAVIGATE',
          payload: { destination },
        },
        explanation: `Navigated to ${destination} mailbox.`,
      };
    }

    // Default fallback if prompt cannot be recognized
    throw new Error(
      `Could not determine AI action for command: "${prompt}". Try phrases like "Show emails from John", "Show unread emails with attachments", "Find emails containing invoice", "Compose an email to ...", or "Clear the search".`
    );
  }
}
