// @vitest-environment jsdom
// End-to-end UI smoke tests: render the real <App/>, drive the real modals,
// and assert that derived state (today's spend, account pills, list rows,
// friend nets) updates correctly.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';
import App from '../src/App.jsx';

beforeEach(() => {
  // jsdom keeps the URL across tests — always start from the Home route.
  window.location.hash = '#/';
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.location.hash = '#/';
});

/** Text of the hero "Today's Spend" number (the only ₹-only <p> on Home). */
const heroSpend = () =>
  [...document.querySelectorAll('p')]
    .map((p) => p.textContent)
    .find((t) => /^₹[\d,]+(\.\d+)?$/.test(t)) ?? null;

async function renderApp() {
  const utils = render(<App />);
  await waitFor(() => expect(heroSpend()).toBe('₹0'), { timeout: 4000 });
  return utils;
}

describe('app shell', () => {
  it('renders Home with balance pills, hero metric and the 4-tab bottom nav + FAB', async () => {
    await renderApp();

    expect(screen.getByText('UPI')).toBeInTheDocument();
    expect(screen.getByText('UPI Lite')).toBeInTheDocument();
    expect(screen.getByText('Cash')).toBeInTheDocument();
    expect(screen.getByText('Transfer / Top-Up')).toBeInTheDocument();

    expect(heroSpend()).toBe('₹0');
    expect(screen.getByText(/All Transactions/i)).toBeInTheDocument();
    expect(screen.getByText('No transactions yet')).toBeInTheDocument();

    expect(screen.getByLabelText('Add transaction')).toBeInTheDocument();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Friends')).toBeInTheDocument();
    expect(screen.getByText('Analytics')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });
});

describe('add expense flow', () => {
  it('saves an expense and immediately updates Today’s Spend, the list and the UPI pill', async () => {
    await renderApp();

    fireEvent.click(screen.getByLabelText('Add transaction'));
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(within(dialog).getByPlaceholderText('0'), { target: { value: '250' } });
    fireEvent.click(within(dialog).getByText('Groceries'));
    fireEvent.click(within(dialog).getByText('Save Expense'));

    // Today's spend hero flips from ₹0 to ₹250.
    await waitFor(() => expect(heroSpend()).toBe('₹250'));

    // Master list now contains the row; modal closed.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Groceries')).toBeInTheDocument();

    // Cash outflow shows on the UPI pill AND the row (−₹250 each).
    await waitFor(() => expect(screen.getAllByText('−₹250').length).toBeGreaterThanOrEqual(1));
  });

  it('records a 1-tap internal transfer with zero budget impact', async () => {
    await renderApp();

    fireEvent.click(screen.getByText('Transfer / Top-Up'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('UPI → UPI Lite (Top-Up)')).toBeInTheDocument();

    fireEvent.change(within(dialog).getByPlaceholderText('0'), { target: { value: '500' } });
    fireEvent.click(within(dialog).getByText('Record Transfer'));

    // Transfer row appears; Today's Spend stays ₹0 (no budget impact).
    await screen.findByText('Top-Up');
    expect(heroSpend()).toBe('₹0');

    // UPI 0 → −500 (pill), UPI Lite 0 → +₹500 (pill + neutral transfer row).
    expect(screen.getByText('−₹500')).toBeInTheDocument();
    expect(screen.getAllByText('₹500').length).toBeGreaterThanOrEqual(1);
  });
});

describe('analytics & settings screens', () => {
  it('renders Analytics with the summary, category chart and budget breakdown', async () => {
    await renderApp();

    fireEvent.click(screen.getByText('Analytics'));
    await screen.findByText('Total Monthly Spend');
    expect(screen.getByText(/Category Spend/)).toBeInTheDocument();
    expect(screen.getByText('Daily Spend Trend & Budget Pace')).toBeInTheDocument();
    expect(screen.getByText('Budget Breakdown')).toBeInTheDocument();
    // Shown both in the summary card and the breakdown legend.
    expect(screen.getAllByText('Fixed Overhead').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Variable Spend').length).toBeGreaterThanOrEqual(2);
  });

  it('renders Settings with budget, balances, categories and backup actions', async () => {
    await renderApp();

    fireEvent.click(screen.getByText('Settings'));
    await screen.findByText('Monthly Budget');
    expect(screen.getByText('Starting Balances')).toBeInTheDocument();
    expect(screen.getByText('Categories')).toBeInTheDocument();
    expect(screen.getByText('Export JSON Backup')).toBeInTheDocument();
    expect(screen.getByText('Import JSON Backup')).toBeInTheDocument();
    expect(screen.getByText('Generate Financial Report')).toBeInTheDocument();
    // All 10 pre-loaded categories are editable here.
    expect(screen.getByDisplayValue('Food')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Househelp')).toBeInTheDocument();
  });
});

describe('financial report flow', () => {
  it('opens the date picker and shows the red inline error when the period has no data', async () => {
    await renderApp();

    fireEvent.click(screen.getByText('Settings'));
    fireEvent.click(await screen.findByText('Generate Financial Report'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Start Date')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('End Date')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Generate' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

    // Fresh ledger → zero transactions in range → mandated error, no file.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Generate' }));
    await within(dialog).findByText('No data found for this selected period.');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('No data found for this selected period.');
    // Modal stays open so the user can adjust the dates.
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('generates and downloads a .md report when the period contains data', async () => {
    // jsdom has no Blob URL support — stub the download plumbing.
    const createObjectURL = vi.fn(() => 'blob:financial-report');
    const revokeObjectURL = vi.fn();
    window.URL.createObjectURL = createObjectURL;
    window.URL.revokeObjectURL = revokeObjectURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    try {
      await renderApp();

      // Create one in-range expense so the period is not empty.
      fireEvent.click(screen.getByLabelText('Add transaction'));
      const txDialog = await screen.findByRole('dialog');
      fireEvent.change(within(txDialog).getByPlaceholderText('0'), { target: { value: '420' } });
      fireEvent.click(within(txDialog).getByText('Save Expense'));
      await waitFor(() => expect(heroSpend()).toBe('₹420'));

      fireEvent.click(screen.getByText('Settings'));
      fireEvent.click(await screen.findByText('Generate Financial Report'));
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Generate' }));

      await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
      const blob = createObjectURL.mock.calls[0][0];
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.size).toBeGreaterThan(0);
      expect(blob.type).toContain('text/markdown');
      // Report downloads and the modal closes.
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      clickSpy.mockRestore();
      delete window.URL.createObjectURL;
      delete window.URL.revokeObjectURL;
    }
  });
});

describe('smart notes & quick settle', () => {
  it('suggests previously used notes via datalist, filtered by selected category', async () => {
    await renderApp();

    // Log a Food expense carrying a distinctive note.
    fireEvent.click(screen.getByLabelText('Add transaction'));
    let dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('0'), { target: { value: '250' } });
    fireEvent.click(within(dialog).getByText('Food'));
    fireEvent.change(within(dialog).getByPlaceholderText('Add a note...'), {
      target: { value: 'Paneer butter masala' },
    });
    fireEvent.click(within(dialog).getByText('Save Expense'));
    await waitFor(() => expect(heroSpend()).toBe('₹250'));

    // Re-open: Food is the default category → the note is offered.
    fireEvent.click(screen.getByLabelText('Add transaction'));
    dialog = await screen.findByRole('dialog');
    const noteInput = within(dialog).getByPlaceholderText('Add a note...');
    const readOptions = () => {
      const list = document.getElementById(noteInput.getAttribute('list'));
      return [...list.querySelectorAll('option')].map((o) => o.value);
    };
    expect(readOptions()).toContain('Paneer butter masala');

    // Switch to Travel → Food notes must vanish from the suggestions.
    fireEvent.click(within(dialog).getByText('Travel'));
    expect(readOptions()).not.toContain('Paneer butter masala');

    fireEvent.click(within(dialog).getByLabelText('Close'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('1-tap Settle Full fills the exact outstanding balance', async () => {
    await renderApp();

    // Ravi + equal split of ₹900 → owes you ₹450.
    fireEvent.click(screen.getByText('Friends'));
    fireEvent.click(screen.getAllByText('Add Friend')[0]);
    const addDialog = await screen.findByRole('dialog');
    fireEvent.change(within(addDialog).getByPlaceholderText("Friend's name"), {
      target: { value: 'Ravi' },
    });
    fireEvent.click(within(addDialog).getByRole('button', { name: 'Add Friend' }));
    await waitFor(() => expect(screen.getByText('Ravi')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Add transaction'));
    const txDialog = await screen.findByRole('dialog');
    fireEvent.change(within(txDialog).getByPlaceholderText('0'), { target: { value: '900' } });
    fireEvent.click(within(txDialog).getByText('Split this bill'));
    fireEvent.click(await within(txDialog).findByText('Ravi'));
    fireEvent.click(within(txDialog).getByText('Save Expense'));
    await screen.findAllByText('+₹450');

    // Settle Up → Settle Full types the odd balance for you.
    fireEvent.click(screen.getByText('Settle Up'));
    const settleDialog = await screen.findByRole('dialog');
    const amountInput = within(settleDialog).getByPlaceholderText('0');
    expect(amountInput.value).toBe('');
    fireEvent.click(within(settleDialog).getByText('Settle Full'));
    expect(amountInput.value).toBe('450');
    expect(within(settleDialog).queryByRole('alert')).toBeNull();
  });
});

describe('initial balance when adding a friend', () => {
  it('migrates a pre-app debt into the ledger without touching accounts or budget', async () => {
    await renderApp();

    // --- Friend A: they owe me ₹250 (positive) ---
    fireEvent.click(screen.getByText('Friends'));
    fireEvent.click(screen.getAllByText('Add Friend')[0]);
    let addDialog = await screen.findByRole('dialog');
    expect(within(addDialog).getByLabelText(/Initial Balance/)).toBeInTheDocument();
    fireEvent.change(within(addDialog).getByPlaceholderText("Friend's name"), {
      target: { value: 'Suresh' },
    });
    fireEvent.change(within(addDialog).getByLabelText(/Initial Balance/), {
      target: { value: '250' },
    });
    fireEvent.click(within(addDialog).getByRole('button', { name: 'Add Friend' }));

    // Ledger shows +₹250 (summary card + row pill) with zero transactions.
    const positive = await screen.findAllByText('+₹250');
    expect(positive.length).toBeGreaterThanOrEqual(2);

    // --- Friend B: I owe them ₹100 (negative) ---
    fireEvent.click(screen.getAllByText('Add Friend')[0]);
    addDialog = await screen.findByRole('dialog');
    fireEvent.change(within(addDialog).getByPlaceholderText("Friend's name"), {
      target: { value: 'Vikram' },
    });
    fireEvent.change(within(addDialog).getByLabelText(/Initial Balance/), {
      target: { value: '100' },
    });
    fireEvent.click(within(addDialog).getByText('I owe them'));
    fireEvent.click(within(addDialog).getByRole('button', { name: 'Add Friend' }));
    await screen.findByText('−₹100');

    // CRITICAL rule: Home must be completely untouched — no spend, no cash flow.
    fireEvent.click(screen.getByText('Home'));
    await waitFor(() => expect(heroSpend()).toBe('₹0'));
    expect(screen.getAllByText('₹0').length).toBeGreaterThanOrEqual(3); // hero + 3 account pills
  });
});

describe('friend flows', () => {
  it('adds a friend, splits a bill you paid, and shows the running ledger', async () => {
    await renderApp();

    // --- Add a friend from the Friends tab ---
    fireEvent.click(screen.getByText('Friends'));
    fireEvent.click(screen.getAllByText('Add Friend')[0]);
    const addDialog = await screen.findByRole('dialog');
    fireEvent.change(within(addDialog).getByPlaceholderText("Friend's name"), {
      target: { value: 'Ravi' },
    });
    fireEvent.click(within(addDialog).getByRole('button', { name: 'Add Friend' }));
    await waitFor(() => expect(screen.getByText('Ravi')).toBeInTheDocument());
    expect(screen.getByText('Net')).toBeInTheDocument();

    // --- Log a split expense you paid: ₹900, equal, you + Ravi ---
    fireEvent.click(screen.getByLabelText('Add transaction'));
    const txDialog = await screen.findByRole('dialog');
    fireEvent.change(within(txDialog).getByPlaceholderText('0'), { target: { value: '900' } });
    fireEvent.click(within(txDialog).getByText('Split this bill'));
    fireEvent.click(await within(txDialog).findByText('Ravi')); // choose participant
    fireEvent.click(within(txDialog).getByText('Save Expense'));

    // Friend balance: +₹450 — shown both in the summary card and the row pill.
    const nets = await screen.findAllByText('+₹450');
    expect(nets.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('owes you')).toBeInTheDocument();

    // --- Open the friend's chronological ledger ---
    fireEvent.click(screen.getByText('Ravi'));
    await screen.findByText('Split bill · Food');
    expect(screen.getByText(/bal \+₹450/)).toBeInTheDocument();
  });
});

describe('audit log & starting balance guard', () => {
  const WARNING =
    'Are you sure you want to change your starting balance? This will immediately recalculate your current live balances.';

  it('confirms before applying a starting-balance change and records it in the audit log', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      await renderApp();
      fireEvent.click(screen.getByText('Settings'));
      await screen.findByText('Starting Balances');

      const upiInput = screen.getAllByDisplayValue('0')[0]; // three balance fields, UPI first

      // Blurring without touching the value must NOT prompt.
      fireEvent.blur(upiInput);
      expect(confirmSpy).not.toHaveBeenCalled();

      // Change 0 → 5000: the exact warning must be shown, and only on confirm does it save.
      fireEvent.change(upiInput, { target: { value: '5000' } });
      fireEvent.blur(upiInput);
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(confirmSpy).toHaveBeenCalledWith(WARNING);
      expect(upiInput).toHaveValue('5000');

      // The change is visible in the View Audit Log modal with an Indian timestamp.
      fireEvent.click(await screen.findByRole('button', { name: 'View Audit Log' }));
      const dialog = await screen.findByRole('dialog');
      expect(
        within(dialog).getByText('Changed UPI starting balance from ₹0 to ₹5,000'),
      ).toBeInTheDocument();
      expect(within(dialog).getAllByText(/\d{2} \w{3} \d{4}, \d{1,2}:\d{2}/).length).toBeGreaterThan(0);
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('reverts the field and logs nothing when the user declines the confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      await renderApp();
      fireEvent.click(screen.getByText('Settings'));
      await screen.findByText('Starting Balances');

      const upiInput = screen.getAllByDisplayValue('0')[0];
      fireEvent.change(upiInput, { target: { value: '5000' } });
      fireEvent.blur(upiInput);
      expect(confirmSpy).toHaveBeenCalledWith(WARNING);
      expect(upiInput).toHaveValue('0'); // reverted to the stored value

      fireEvent.click(await screen.findByRole('button', { name: 'View Audit Log' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(/No changes recorded yet/)).toBeInTheDocument();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('records transaction edits and deletions in the audit log, newest first', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      await renderApp();

      // Log a ₹500 Groceries expense.
      fireEvent.click(screen.getByLabelText('Add transaction'));
      let dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByPlaceholderText('0'), { target: { value: '500' } });
      fireEvent.click(within(dialog).getByText('Groceries'));
      fireEvent.click(within(dialog).getByText('Save Expense'));
      await waitFor(() => expect(heroSpend()).toBe('₹500'));

      // Tap the row → edit the amount 500 → 450.
      fireEvent.click(screen.getByText('Groceries'));
      dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Edit Transaction')).toBeInTheDocument();
      const amountInput = within(dialog).getByPlaceholderText('0');
      expect(amountInput).toHaveValue('500');
      fireEvent.change(amountInput, { target: { value: '450' } });
      fireEvent.click(within(dialog).getByText('Save Changes'));
      await waitFor(() => expect(heroSpend()).toBe('₹450'));

      // Delete it (confirm mocked) — both actions must be in the log.
      fireEvent.click(screen.getByText('Groceries'));
      dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByText('Delete Transaction'));
      await waitFor(() => expect(heroSpend()).toBe('₹0'));

      fireEvent.click(screen.getByText('Settings'));
      fireEvent.click(await screen.findByRole('button', { name: 'View Audit Log' }));
      const auditDialog = await screen.findByRole('dialog');

      const editDesc = within(auditDialog).getByText(
        'Edited transaction: Changed amount from ₹500 to ₹450',
      );
      const deleteDesc = within(auditDialog).getByText('Deleted transaction: ₹450 for Groceries');
      expect(editDesc).toBeInTheDocument();
      expect(deleteDesc).toBeInTheDocument();

      // Newest first: the delete entry sits above the edit entry.
      const preceding = Node.DOCUMENT_POSITION_PRECEDING;
      expect(editDesc.compareDocumentPosition(deleteDesc) & preceding).toBeTruthy();
    } finally {
      confirmSpy.mockRestore();
    }
  });
});

describe('swipe left to duplicate', () => {
  /** Drag a row `dx` px and release it. */
  const swipeLeft = (row, dx) => {
    fireEvent.touchStart(row, { touches: [{ clientX: 0, clientY: 20 }] });
    fireEvent.touchMove(row, { touches: [{ clientX: dx, clientY: 22 }] });
    fireEvent.touchEnd(row, { changedTouches: [{ clientX: dx, clientY: 22 }] });
  };

  it('duplicates past the threshold with haptic feedback, a (Copy) note and an audit entry', async () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true, writable: true });
    try {
      await renderApp();

      // ₹500 Groceries with a note.
      fireEvent.click(screen.getByLabelText('Add transaction'));
      let dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByPlaceholderText('0'), { target: { value: '500' } });
      fireEvent.click(within(dialog).getByText('Groceries'));
      fireEvent.change(within(dialog).getByPlaceholderText('Add a note...'), {
        target: { value: 'Weekly groceries' },
      });
      fireEvent.click(within(dialog).getByText('Save Expense'));
      await waitFor(() => expect(heroSpend()).toBe('₹500'));

      // Swipe well past the threshold (jsdom viewport 1024px → threshold 307.2px).
      const row = screen.getByText('Groceries').closest('button');
      swipeLeft(row, -400);
      expect(vibrate).toHaveBeenCalledWith(50); // light haptic exactly once

      // Duplicate lands: same amount + category + verbatim note, hero doubles.
      await waitFor(() => expect(heroSpend()).toBe('₹1,000'));
      expect(screen.getAllByText('Groceries')).toHaveLength(2);
      expect(screen.getAllByText('Weekly groceries')).toHaveLength(2); // both rows, no "(Copy)"

      // Audit log carries the spec wording.
      fireEvent.click(screen.getByText('Settings'));
      fireEvent.click(await screen.findByRole('button', { name: 'View Audit Log' }));
      const auditDialog = await screen.findByRole('dialog');
      expect(
        within(auditDialog).getByText('Duplicated transaction via swipe: Groceries - ₹500'),
      ).toBeInTheDocument();
    } finally {
      delete navigator.vibrate;
    }
  });

  it('snaps back without duplicating when the swipe stays below the threshold', async () => {
    await renderApp();

    fireEvent.click(screen.getByLabelText('Add transaction'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('0'), { target: { value: '250' } });
    fireEvent.click(within(dialog).getByText('Save Expense'));
    await waitFor(() => expect(heroSpend()).toBe('₹250'));

    const row = screen.getByText('Food').closest('button');
    const content = row.querySelector('span[class*="bg-zinc-900"]');

    // Mid-drag: the row visibly follows the finger…
    fireEvent.touchStart(row, { touches: [{ clientX: 0, clientY: 20 }] });
    fireEvent.touchMove(row, { touches: [{ clientX: -40, clientY: 21 }] });
    expect(content.style.transform).toBe('translateX(-40px)');

    // …and on release it snaps back to 0 with no duplication.
    fireEvent.touchEnd(row, { changedTouches: [{ clientX: -40, clientY: 21 }] });
    expect(content.style.transform).toBe('translateX(0px)');
    expect(screen.getAllByText('Food')).toHaveLength(1);
    expect(heroSpend()).toBe('₹250');
  });
});

describe('swipe right to delete with undo', () => {
  const addExpense = async (amount, category) => {
    fireEvent.click(screen.getByLabelText('Add transaction'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('0'), { target: { value: String(amount) } });
    if (category) fireEvent.click(within(dialog).getByText(category));
    fireEvent.click(within(dialog).getByText('Save Expense'));
    await waitFor(() => expect(heroSpend()).toBe(`₹${amount}`));
  };

  const swipeRight = (row, dx) => {
    fireEvent.touchStart(row, { touches: [{ clientX: 0, clientY: 20 }] });
    fireEvent.touchMove(row, { touches: [{ clientX: dx, clientY: 21 }] });
    fireEvent.touchEnd(row, { changedTouches: [{ clientX: dx, clientY: 21 }] });
  };

  it('optimistically hides the row with a Deleted. + UNDO toast; Undo restores without logging', async () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true, writable: true });
    try {
      await renderApp();
      await addExpense(500, 'Groceries');

      const row = screen.getByText('Groceries').closest('button');
      swipeRight(row, 400); // jsdom viewport 1024px → threshold 307.2px
      expect(vibrate).toHaveBeenCalledWith(50);

      // Optimistic update: row gone from the list, totals recalculated, toast up.
      expect(screen.queryByText('Groceries')).toBeNull();
      expect(heroSpend()).toBe('₹0');
      expect(screen.getByText('Deleted.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'UNDO' })).toBeInTheDocument();

      // Undo inside the window: everything restores instantly, nothing logged.
      fireEvent.click(screen.getByRole('button', { name: 'UNDO' }));
      expect(screen.queryByText('Deleted.')).toBeNull();
      expect(screen.getByText('Groceries')).toBeInTheDocument();
      expect(heroSpend()).toBe('₹500');

      fireEvent.click(screen.getByText('Settings'));
      fireEvent.click(await screen.findByRole('button', { name: 'View Audit Log' }));
      const auditDialog = await screen.findByRole('dialog');
      expect(within(auditDialog).getByText(/No changes recorded yet/)).toBeInTheDocument();
    } finally {
      delete navigator.vibrate;
    }
  });

  it('commits the hard delete after the 4-second timeout and writes the audit entry', async () => {
    await renderApp();
    await addExpense(500, 'Groceries');

    const row = screen.getByText('Groceries').closest('button');
    swipeRight(row, 400);
    expect(screen.getByText('Deleted.')).toBeInTheDocument();

    // Wait out the 4s undo window inside act() so the timer's dispatch is flushed.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 4100));
    });

    // Toast gone, deletion permanent, audit log records it.
    expect(screen.queryByText('Deleted.')).toBeNull();
    expect(screen.queryByText('Groceries')).toBeNull();
    expect(heroSpend()).toBe('₹0');

    fireEvent.click(screen.getByText('Settings'));
    fireEvent.click(await screen.findByRole('button', { name: 'View Audit Log' }));
    const auditDialog = await screen.findByRole('dialog');
    expect(
      within(auditDialog).getByText('Deleted transaction: ₹500 for Groceries'),
    ).toBeInTheDocument();
  });

  it('snaps back without deleting when the right swipe stays below the threshold', async () => {
    await renderApp();
    await addExpense(250, null);

    const row = screen.getByText('Food').closest('button');
    const content = row.querySelector('span[class*="bg-zinc-900"]');

    fireEvent.touchStart(row, { touches: [{ clientX: 0, clientY: 20 }] });
    fireEvent.touchMove(row, { touches: [{ clientX: 40, clientY: 21 }] });
    expect(content.style.transform).toBe('translateX(40px)');

    fireEvent.touchEnd(row, { changedTouches: [{ clientX: 40, clientY: 21 }] });
    expect(content.style.transform).toBe('translateX(0px)');
    expect(screen.queryByText('Deleted.')).toBeNull();
    expect(screen.getAllByText('Food')).toHaveLength(1);
    expect(heroSpend()).toBe('₹250');
  });
});

describe('bi-directional forgiveness', () => {
  it('lets a friend forgive your debt as a zero-cashflow round-off with an audit entry', async () => {
    await renderApp();

    // A personal expense first, so "no budget impact" is provable later.
    fireEvent.click(screen.getByLabelText('Add transaction'));
    let txDialog = await screen.findByRole('dialog');
    fireEvent.change(within(txDialog).getByPlaceholderText('0'), { target: { value: '250' } });
    fireEvent.click(within(txDialog).getByText('Save Expense'));
    await waitFor(() => expect(heroSpend()).toBe('₹250'));

    // Vikram: you owe him ₹100 via the ledger-only Initial Balance seed.
    fireEvent.click(screen.getByText('Friends'));
    fireEvent.click(screen.getAllByText('Add Friend')[0]);
    const addDialog = await screen.findByRole('dialog');
    fireEvent.change(within(addDialog).getByPlaceholderText("Friend's name"), {
      target: { value: 'Vikram' },
    });
    fireEvent.change(within(addDialog).getByLabelText(/Initial Balance/), {
      target: { value: '100' },
    });
    fireEvent.click(within(addDialog).getByText('I owe them'));
    fireEvent.click(within(addDialog).getByRole('button', { name: 'Add Friend' }));
    // −₹100 appears in the summary net AND the friend row pill.
    const owing = await screen.findAllByText('−₹100');
    expect(owing.length).toBeGreaterThanOrEqual(1);

    // The Forgive button is ENABLED even though YOU owe (net < 0).
    const forgiveBtn = screen.getByRole('button', { name: 'Forgive / Round Off' });
    expect(forgiveBtn).toBeEnabled();
    fireEvent.click(forgiveBtn);

    const dialog = await screen.findByRole('dialog');
    // Direction defaults to "They Forgive Me"; the full debt is prefilled.
    expect(within(dialog).getByRole('button', { name: 'They Forgive Me' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'I Forgive Them' })).toBeDisabled();
    expect(within(dialog).getByPlaceholderText('0')).toHaveValue('100');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Round Off — Zero Cash Flow' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Strictly a ledger adjustment: debt gone, nothing logged against budget.
    await screen.findByText('settled up');
    expect(screen.queryByText('−₹100')).toBeNull();

    fireEvent.click(screen.getByText('Home'));
    await waitFor(() => expect(heroSpend()).toBe('₹250')); // unchanged — no Misc expense
    expect(screen.queryByText('−₹350')).toBeNull(); // accounts untouched

    // Audit log records the bi-directional wording.
    fireEvent.click(screen.getByText('Settings'));
    fireEvent.click(await screen.findByRole('button', { name: 'View Audit Log' }));
    const auditDialog = await screen.findByRole('dialog');
    expect(
      within(auditDialog).getByText('Friend forgave ₹100 owed by you'),
    ).toBeInTheDocument();
  });
});
