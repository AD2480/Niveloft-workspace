import { API_BASE_URL } from '@/config';
import { createBackendStartup } from '@/lib/backendStartup';

const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
const base = new URL(API_BASE_URL, origin);
export const backendStartup = createBackendStartup(`${base.origin}/actuator/health`);
