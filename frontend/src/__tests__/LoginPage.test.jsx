import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@/theme/ThemeContext';
import { AuthProvider } from '@/auth/AuthContext';
import LoginPage from '@/auth/LoginPage';

vi.mock('@/api', () => ({
  api: { login: vi.fn(), me: vi.fn() },
  setAuthToken: vi.fn(),
  clearAuthToken: vi.fn(),
}));

function renderLogin() {
  return render(
    <ThemeProvider>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  try { localStorage.clear(); } catch {}
  document.documentElement.removeAttribute('data-theme');
  vi.clearAllMocks();
});

describe('LoginPage', () => {
  it('renders the sign-in form with username, password, and submit', () => {
    renderLogin();
    expect(screen.getByTestId('login-form')).toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('submits entered credentials to the login API', async () => {
    const { api } = await import('@/api');
    api.login.mockResolvedValue({
      access_token: 'tok', user: { username: 'admin', role: 'admin', site_keys: ['*'] },
    });
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByTestId('login-username'), 'admin');
    await user.type(screen.getByTestId('login-password'), 'admin-dev');
    await user.click(screen.getByTestId('login-submit'));

    await waitFor(() => expect(api.login).toHaveBeenCalledWith('admin', 'admin-dev'));
  });

  it('shows an error message when login is rejected', async () => {
    const { api } = await import('@/api');
    api.login.mockRejectedValue(new Error('Invalid username or password'));
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByTestId('login-username'), 'admin');
    await user.type(screen.getByTestId('login-password'), 'wrong');
    await user.click(screen.getByTestId('login-submit'));

    const alert = await screen.findByTestId('login-error');
    expect(alert).toHaveTextContent(/invalid username or password/i);
  });

  it('toggles the theme via the login theme button', async () => {
    const user = userEvent.setup();
    renderLogin();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    await user.click(screen.getByTestId('login-theme-toggle'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('toggles password visibility via the eye button', async () => {
    const user = userEvent.setup();
    renderLogin();
    const field = screen.getByTestId('login-password');
    const toggle = screen.getByTestId('login-password-toggle');
    expect(field).toHaveAttribute('type', 'password');

    await user.click(toggle);
    expect(field).toHaveAttribute('type', 'text');

    await user.click(toggle);
    expect(field).toHaveAttribute('type', 'password');
  });
});
