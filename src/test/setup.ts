import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

const localStorageMock = {
	getItem: vi.fn(() => null),
	setItem: vi.fn(),
	removeItem: vi.fn(),
	clear: vi.fn(),
};

Object.defineProperty(window, 'localStorage', {
	value: localStorageMock,
});

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
	value: vi.fn(),
	writable: true,
});
