/** The in-browser test API's seeded accounts, used by the automated tests (all share one password). */
export const DEMO_PASSWORD = 'Password@123';

export const DEMO_ACCOUNTS = [
  { email: 'aarav@projectflow.dev', name: 'Aarav Sharma', role: 'Owner', hint: 'Owns Campus Connect Portal' },
  { email: 'priya@projectflow.dev', name: 'Priya Nair', role: 'Manager', hint: 'Reviews submitted work' },
  { email: 'rohan@projectflow.dev', name: 'Rohan Mehta', role: 'Member', hint: 'Works on assigned tasks' },
  { email: 'vikram@projectflow.dev', name: 'Vikram Rao', role: 'Viewer', hint: 'Read-only access' },
] as const;
