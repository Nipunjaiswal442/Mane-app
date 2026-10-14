import { z } from 'zod';
export const evidenceSchema = z
  .object({ start_s: z.number().finite().nonnegative(), end_s: z.number().finite().nonnegative() })
  .refine((value) => value.end_s > value.start_s, 'Evidence must have positive duration');
export const minutesSchema = z
  .object({
    title: z.string().min(1).max(500),
    held_at: z.string().datetime({ offset: true }).nullable(),
    attendees: z.array(z.object({ name: z.string(), matched_user_id: z.string().uuid().nullable() })),
    summary: z.string(),
    agenda: z.array(z.string()),
    decisions: z.array(z.object({ text: z.string(), evidence: z.array(evidenceSchema).min(1) })),
    action_items: z.array(
      z.object({
        text: z.string(),
        owner: z.string().nullable(),
        due_date: z.string().date().nullable(),
        evidence: z.array(evidenceSchema).min(1),
      }),
    ),
    open_questions: z.array(z.string()),
    risks: z.array(z.string()),
    next_meeting: z.string().nullable(),
    confidence_notes: z.array(z.string()),
  })
  .strict();
export const MinutesSchema = minutesSchema;
export type Minutes = z.infer<typeof minutesSchema>;
export const transcriptSchema = z.object({
  language: z.string(),
  segments: z.array(
    z.object({
      start_s: z.number().nonnegative(),
      end_s: z.number().nonnegative(),
      speaker: z.string().nullable(),
      text: z.string(),
    }),
  ),
});
export type Transcript = z.infer<typeof transcriptSchema>;
