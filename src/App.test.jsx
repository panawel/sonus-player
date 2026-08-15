import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('mounts without throwing', () => {
    expect(() => render(<App />)).not.toThrow();
  });
});
