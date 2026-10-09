import { render, screen } from '@testing-library/react';
import App from './App';

describe('App UI', () => {
  it('renders the app title and conversation area', () => {
    render(<App />);

    expect(screen.getByText('Deutsch Lehrer AI')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Conversation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /light/i })).toBeInTheDocument();
  });
});
