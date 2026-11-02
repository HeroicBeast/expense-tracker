// @vitest-environment jsdom
// End-to-end UI smoke tests: render the real <App/>, drive the real modals,
// and assert that derived state (today's spend, account pills, list rows,
// friend nets) updates correctly.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import App from '../src/App.jsx';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
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
