export const FEEDBACK_TYPES = ['Report a Bug', 'Feedback', 'Feature Request', 'Support'] as const;
export type FeedbackType = typeof FEEDBACK_TYPES[number];
