import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ApiKeysAdmin from '@/components/admin/ApiKeysAdmin';
import { api } from '@/api';

vi.mock('@/api', () => ({
  api: {
    listApiKeys: vi.fn(),
    createApiKey: vi.fn(),
    updateApiKey: vi.fn(),
    deleteApiKey: vi.fn(),
    revealApiKey: vi.fn(),
    updateProviderConfig: vi.fn(),
  },
}));

const twoLlmKeys = {
  keys: [
    {
      id: 1,
      provider: 'llm',
      label: 'primary',
      value_preview: '***1111',
      enabled: true,
      total_uses: 2,
      last_used_at: null,
      last_error: null,
    },
    {
      id: 2,
      provider: 'openai',
      label: 'backup',
      value_preview: '***2222',
      enabled: true,
      total_uses: 0,
      last_used_at: null,
      last_error: null,
    },
  ],
  providers: {},
  configs: {
    llm: { provider: 'llm', base_url: 'https://old.example.test/v1' },
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  api.listApiKeys.mockResolvedValue(twoLlmKeys);
  api.updateProviderConfig.mockResolvedValue({
    config: { provider: 'llm', base_url: 'https://new.example.test/v1' },
  });
  api.updateApiKey.mockResolvedValue({ key: twoLlmKeys.keys[0] });
});

describe('ApiKeysAdmin', () => {
  it('shows a skeleton then merges legacy OpenAI keys into one LLM panel', async () => {
    let resolveList;
    api.listApiKeys.mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));
    render(<ApiKeysAdmin />);

    expect(screen.getByTestId('admin-api-keys-loading')).toBeInTheDocument();

    await act(async () => { resolveList(twoLlmKeys); });

    expect(await screen.findByTestId('admin-api-keys-section')).toHaveAttribute('data-provider', 'llm');
    expect(screen.getAllByTestId('admin-api-keys-row')).toHaveLength(2);
    expect(screen.getByTestId('llm-base-url')).toHaveValue('https://old.example.test/v1');
    expect(screen.getAllByText('LLM provider')).toHaveLength(1);
  });

  it('edits and saves the shared LLM base URL with a busy indicator', async () => {
    const user = userEvent.setup();
    let resolveUpdate;
    api.updateProviderConfig.mockReturnValue(new Promise((resolve) => { resolveUpdate = resolve; }));
    render(<ApiKeysAdmin />);

    const input = await screen.findByTestId('llm-base-url');
    await user.clear(input);
    await user.type(input, 'https://new.example.test/v1');
    await user.click(screen.getByTestId('llm-base-url-save'));

    expect(screen.getByTestId('llm-base-url-save')).toBeDisabled();
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    expect(api.updateProviderConfig).toHaveBeenCalledWith('llm', {
      base_url: 'https://new.example.test/v1',
    });

    await act(async () => {
      resolveUpdate({
        config: { provider: 'llm', base_url: 'https://new.example.test/v1' },
      });
    });
    expect(input).toHaveValue('https://new.example.test/v1');
    expect(screen.getByTestId('llm-base-url-saved')).toBeInTheDocument();
  });

  it('shows saving feedback while an edited key is persisted', async () => {
    const user = userEvent.setup();
    let resolveUpdate;
    api.updateApiKey.mockReturnValue(new Promise((resolve) => { resolveUpdate = resolve; }));
    render(<ApiKeysAdmin />);

    const editButtons = await screen.findAllByTestId('admin-api-keys-edit');
    await user.click(editButtons[0]);
    await user.type(screen.getByTestId('key-value'), 'sk-replacement');
    await user.click(screen.getByTestId('api-key-save'));

    expect(screen.getByTestId('api-key-save')).toBeDisabled();
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    expect(api.updateApiKey).toHaveBeenCalledWith(1, {
      label: 'primary',
      enabled: true,
      value: 'sk-replacement',
    });

    await act(async () => { resolveUpdate({ key: twoLlmKeys.keys[0] }); });
    expect(await screen.findByTestId('admin-api-keys-section')).toBeInTheDocument();
  });

  it('delete flow uses the custom ConfirmDialog and only calls the API after confirmation', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ApiKeysAdmin />);

    const deleteButtons = await screen.findAllByTestId('admin-api-keys-delete');
    await user.click(deleteButtons[0]);

    // Dialog appears, no native confirm() is invoked.
    expect(window.confirm).not.toHaveBeenCalled();
    expect(await screen.findByTestId('confirm-dialog')).toBeInTheDocument();
    expect(screen.getByText(/delete primary/i)).toBeInTheDocument();

    // Cancel keeps the key intact.
    await user.click(screen.getByTestId('confirm-dialog-cancel'));
    expect(api.deleteApiKey).not.toHaveBeenCalled();

    // Reopen and confirm — this time the API is called and the row goes away.
    await user.click(deleteButtons[0]);
    await user.click(screen.getByTestId('confirm-dialog-confirm'));
    await waitFor(() => expect(api.deleteApiKey).toHaveBeenCalledWith(1));
    confirmSpy.mockRestore();
  });
});
