/**
 * Acceptance criteria and checklists for the test API's sample tasks, keyed by project key and
 * task title.
 */
export const SEED_CRITERIA: Record<string, Record<string, { criteria: string[]; checklist: string[] }>> = {
  "ONB": {
    "Agree goals and success measures": {
      "criteria": [
        "Target: 70% of new users finish onboarding (from 52%)",
        "Measures agreed with engineering and support"
      ],
      "checklist": []
    },
    "Interview eight new users about sign-up": {
      "criteria": [
        "Eight interviews, notes shared",
        "Top three problems written up"
      ],
      "checklist": []
    },
    "Map where people drop out of today’s onboarding": {
      "criteria": [
        "Drop-off per screen, with numbers",
        "Shared with the team"
      ],
      "checklist": []
    },
    "Audit the current sign-up screens": {
      "criteria": [
        "Issues listed by severity"
      ],
      "checklist": []
    },
    "Design the three welcome screens": {
      "criteria": [
        "Light and dark versions",
        "Touch targets at least 44 pt",
        "Signed off by product"
      ],
      "checklist": []
    },
    "Choose the passkey library": {
      "criteria": [
        "Decision written down with reasons"
      ],
      "checklist": []
    },
    "Write the welcome copy": {
      "criteria": [
        "Under 12 words per headline",
        "Reviewed for tone"
      ],
      "checklist": []
    },
    "Build the welcome screens for iOS and Android": {
      "criteria": [
        "Matches the designs on both platforms",
        "Works with the largest text size",
        "Behind the onboarding-v2 flag"
      ],
      "checklist": []
    },
    "Passkey sign-in: server API": {
      "criteria": [
        "Register and sign in with a passkey",
        "Password fallback still works",
        "Rate limited"
      ],
      "checklist": []
    },
    "Connect passkey sign-in to the app": {
      "criteria": [
        "Sign in with a passkey on iOS and Android",
        "Clear message when a device has no passkey"
      ],
      "checklist": []
    },
    "Ask for notification permission at the right moment": {
      "criteria": [
        "Prompt shows once, after the first project",
        "Explains what notifications are for"
      ],
      "checklist": []
    },
    "Track onboarding events in analytics": {
      "criteria": [
        "Events visible in the dashboard",
        "No personal data in events"
      ],
      "checklist": []
    },
    "Accessibility check of the new flow": {
      "criteria": [
        "VoiceOver and TalkBack walkthrough",
        "No blocking issues open"
      ],
      "checklist": []
    },
    "Beta test with 50 new users": {
      "criteria": [
        "50 users through the new flow",
        "Completion rate compared with the old flow"
      ],
      "checklist": []
    },
    "Staged rollout plan": {
      "criteria": [
        "Steps and dates agreed",
        "Rollback tested"
      ],
      "checklist": []
    },
    "App Store screenshots and release notes": {
      "criteria": [
        "Screenshots for both stores",
        "Release notes reviewed"
      ],
      "checklist": []
    },
    "Help article for the new sign-in": {
      "criteria": [
        "Published before launch",
        "Linked from the sign-in screen"
      ],
      "checklist": []
    }
  },
  "CCP": {
    "Define user personas and journeys": {
      "criteria": [
        "Three personas based on at least 10 interviews",
        "Journeys for discovering, joining and registering"
      ],
      "checklist": []
    },
    "Design system: colours, type and components": {
      "criteria": [
        "Buttons, inputs, cards and badges documented",
        "Colour contrast meets WCAG AA in both themes"
      ],
      "checklist": []
    },
    "Database schema and ER diagram": {
      "criteria": [
        "ER diagram covers all entities",
        "Foreign keys and indexes defined"
      ],
      "checklist": []
    },
    "Set up Spring Boot project and CI pipeline": {
      "criteria": [
        "CI runs tests on every pull request"
      ],
      "checklist": []
    },
    "JWT authentication (login and register)": {
      "criteria": [
        "Passwords are stored with BCrypt",
        "Expired tokens return 401 and the client signs out",
        "Login is rate limited"
      ],
      "checklist": []
    },
    "Student profile page": {
      "criteria": [
        "Student can edit their own profile only"
      ],
      "checklist": []
    },
    "Event listing with search and filters": {
      "criteria": [
        "Search matches title and description",
        "Empty and loading states shown"
      ],
      "checklist": []
    },
    "Club directory API": {
      "criteria": [
        "Paginated with a default page size of 20",
        "Search covers name and category",
        "Returns 404 for unknown clubs"
      ],
      "checklist": [
        "Write integration tests",
        "Document endpoints in Swagger"
      ]
    },
    "Event registration flow": {
      "criteria": [
        "Registration is refused when an event is full",
        "Waitlisted students are promoted when someone cancels",
        "A confirmation email is sent"
      ],
      "checklist": [
        "Capacity check",
        "Waitlist promotion",
        "Confirmation email",
        "Tests for full events"
      ]
    },
    "Notification service (email and in-app)": {
      "criteria": [
        "Reminder emails are sent 24 hours before an event",
        "In-app notifications are stored and marked read"
      ],
      "checklist": [
        "SMTP configuration",
        "Reminder scheduler",
        "In-app notification table"
      ]
    },
    "Accessibility audit of core screens": {
      "criteria": [
        "No WCAG 2.1 AA failures on the five core screens"
      ],
      "checklist": []
    },
    "End-to-end tests for auth and events": {
      "criteria": [
        "Tests cover sign-up, login and registration",
        "Tests run in CI"
      ],
      "checklist": [
        "Sign-up test",
        "Login test",
        "Registration test"
      ]
    },
    "Admin dashboard wireframes": {
      "criteria": [
        "Covers registrations over time, popular events and club growth",
        "Includes empty states",
        "Includes the mobile layout"
      ],
      "checklist": []
    },
    "Admin analytics dashboard": {
      "criteria": [],
      "checklist": []
    },
    "Load testing and performance tuning": {
      "criteria": [],
      "checklist": []
    },
    "Deployment runbook": {
      "criteria": [],
      "checklist": []
    },
    "Fix timetable time-zone bug": {
      "criteria": [
        "Events keep their local date in every time zone"
      ],
      "checklist": []
    },
    "Write the user guide": {
      "criteria": [],
      "checklist": []
    }
  },
  "MBA": {
    "Competitor research": {
      "criteria": [
        "Five apps compared on the same criteria"
      ],
      "checklist": []
    },
    "Usability interviews (8 users)": {
      "criteria": [
        "Eight interviews summarised"
      ],
      "checklist": []
    },
    "New onboarding flow UI": {
      "criteria": [
        "Three steps or fewer",
        "KYC document capture works on iOS and Android"
      ],
      "checklist": []
    },
    "Biometric login": {
      "criteria": [
        "Fallback to PIN after three failed attempts",
        "Keys stored in the secure enclave"
      ],
      "checklist": [
        "Android fingerprint",
        "iOS Face ID",
        "PIN fallback"
      ]
    },
    "Transaction history redesign": {
      "criteria": [],
      "checklist": []
    },
    "Bill payments module": {
      "criteria": [],
      "checklist": []
    },
    "Spending insights charts": {
      "criteria": [],
      "checklist": []
    },
    "Security penetration test": {
      "criteria": [],
      "checklist": []
    },
    "Regression test suite": {
      "criteria": [
        "Covers login, transfers and payments",
        "Runs in under 10 minutes"
      ],
      "checklist": []
    },
    "App store assets": {
      "criteria": [],
      "checklist": []
    },
    "Push notification preferences": {
      "criteria": [],
      "checklist": []
    },
    "Offline mode for balances": {
      "criteria": [],
      "checklist": []
    }
  },
  "LMS": {
    "Book catalogue CRUD": {
      "criteria": [
        "Search by title, author and ISBN"
      ],
      "checklist": []
    },
    "Issue and return workflow": {
      "criteria": [
        "Due date set on issue"
      ],
      "checklist": []
    },
    "Fine calculation": {
      "criteria": [
        "Rate is configurable"
      ],
      "checklist": []
    },
    "Member management": {
      "criteria": [],
      "checklist": []
    },
    "Reports for librarians": {
      "criteria": [],
      "checklist": []
    },
    "Staff training session": {
      "criteria": [],
      "checklist": []
    }
  },
  "ASP": {
    "Problem statement and survey": {
      "criteria": [
        "At least 40 responses"
      ],
      "checklist": []
    },
    "Planner algorithm spike": {
      "criteria": [
        "Never schedules over a class",
        "Handles a week with 30+ events"
      ],
      "checklist": []
    },
    "Timetable import (CSV and ICS)": {
      "criteria": [
        "Imports CSV and .ics files",
        "Recurring events expand correctly"
      ],
      "checklist": [
        "CSV parser",
        "ICS parser",
        "Recurrence rules"
      ]
    },
    "Prototype screens": {
      "criteria": [],
      "checklist": []
    },
    "Usability test plan": {
      "criteria": [],
      "checklist": []
    },
    "Pilot recruitment": {
      "criteria": [],
      "checklist": []
    }
  },
  "HAC": {
    "Landing page design": {
      "criteria": [],
      "checklist": []
    },
    "Team registration form": {
      "criteria": [],
      "checklist": []
    },
    "Schedule page": {
      "criteria": [],
      "checklist": []
    }
  }
};
