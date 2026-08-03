import { z } from "zod";
import { API_LIMITS } from "./limits";

const sessionIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(API_LIMITS.maxSessionIdLength);

const runIdSchema = z.string().trim().min(1).max(API_LIMITS.maxRunIdLength);

const proposalIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(API_LIMITS.maxProposalIdLength);

const approvalIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(API_LIMITS.maxApprovalIdLength);

const reasonSchema = z
  .string()
  .trim()
  .max(API_LIMITS.maxReasonLength)
  .optional();

/** Client may only submit user turns; assistant/system roles are rejected. */
export const clientUserMessageSchema = z.object({
  role: z.literal("user"),
  content: z
    .string()
    .trim()
    .min(1)
    .max(API_LIMITS.maxMessageContentLength),
});

export const createSessionBodySchema = z
  .object({
    id: sessionIdSchema.optional(),
  })
  .strict();

export const sessionMessagesQuerySchema = z
  .object({
    useLangGraph: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true"),
  })
  .strict();

export const startRunBodySchema = z
  .object({
    kind: z.literal("start"),
    messages: z
      .array(clientUserMessageSchema)
      .min(1)
      .max(API_LIMITS.maxMessagesPerRequest),
    useLangGraph: z.boolean().optional().default(false),
    useMultiAgent: z.boolean().optional().default(false),
  })
  .strict();

export const resumeRunBodySchema = z
  .object({
    kind: z.literal("resume"),
    approvalId: approvalIdSchema,
    confirmation: z
      .object({
        decision: z.enum(["approved", "rejected"]),
        reason: reasonSchema,
      })
      .strict(),
  })
  .strict();

export const sessionRunBodySchema = z.discriminatedUnion("kind", [
  startRunBodySchema,
  resumeRunBodySchema,
]);

export const patchDecisionBodySchema = z
  .object({
    action: z.enum(["apply", "reject"]),
    reason: reasonSchema,
    files: z
      .array(
        z
          .object({
            path: z
              .string()
              .trim()
              .min(1)
              .max(API_LIMITS.maxPatchFilePathLength),
            content: z
              .string()
              .max(API_LIMITS.maxPatchFileContentLength),
          })
          .strict()
      )
      .max(API_LIMITS.maxPatchFiles)
      .optional(),
  })
  .strict();

export const toolApprovalDecisionBodySchema = z
  .object({
    decision: z.enum(["approved", "rejected"]),
    reason: reasonSchema,
  })
  .strict();

/** Legacy `/api/chat` POST body — discriminated by operation flags. */
export const chatPostBodySchema = z.union([
  z
    .object({
      sessionId: sessionIdSchema,
      deleteSession: z.literal(true),
    })
    .strict(),
  z
    .object({
      sessionId: sessionIdSchema,
      approvalId: approvalIdSchema,
      confirmation: z
        .object({
          decision: z.enum(["approved", "rejected"]),
          reason: reasonSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      sessionId: sessionIdSchema,
      patchAction: z
        .object({
          action: z.enum(["apply", "reject"]),
          proposalId: proposalIdSchema,
          reason: reasonSchema,
          files: z
            .array(
              z
                .object({
                  path: z
                    .string()
                    .trim()
                    .min(1)
                    .max(API_LIMITS.maxPatchFilePathLength),
                  content: z
                    .string()
                    .max(API_LIMITS.maxPatchFileContentLength),
                })
                .strict()
            )
            .max(API_LIMITS.maxPatchFiles)
            .optional(),
        })
        .strict(),
      useLangGraph: z.boolean().optional(),
      useMultiAgent: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      sessionId: sessionIdSchema,
      messages: z
        .array(clientUserMessageSchema)
        .min(1)
        .max(API_LIMITS.maxMessagesPerRequest),
      useLangGraph: z.boolean().optional().default(false),
      useMultiAgent: z.boolean().optional().default(false),
    })
    .strict(),
]);

export const chatGetQuerySchema = z
  .object({
    sessionId: sessionIdSchema.optional(),
    runId: runIdSchema.optional(),
    useLangGraph: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true"),
    includeSessions: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true"),
    includeRuns: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true"),
    includeTrace: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true"),
  })
  .strict()
  .superRefine((value, ctx) => {
    const flags = [
      value.includeSessions,
      value.includeRuns,
      value.includeTrace,
    ].filter(Boolean).length;

    if (flags > 1) {
      ctx.addIssue({
        code: "custom",
        message:
          "Specify only one of includeSessions, includeRuns, or includeTrace.",
      });
    }

    if (value.includeRuns && !value.sessionId) {
      ctx.addIssue({
        code: "custom",
        path: ["sessionId"],
        message: "sessionId is required when includeRuns=true.",
      });
    }

    if (value.includeTrace && !value.runId) {
      ctx.addIssue({
        code: "custom",
        path: ["runId"],
        message: "runId is required when includeTrace=true.",
      });
    }

    if (
      !value.includeSessions &&
      !value.includeRuns &&
      !value.includeTrace &&
      !value.sessionId
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["sessionId"],
        message: "sessionId is required to load messages.",
      });
    }
  });

export type CreateSessionBody = z.infer<typeof createSessionBodySchema>;
export type StartRunBody = z.infer<typeof startRunBodySchema>;
export type ResumeRunBody = z.infer<typeof resumeRunBodySchema>;
export type SessionRunBody = z.infer<typeof sessionRunBodySchema>;
export type PatchDecisionBody = z.infer<typeof patchDecisionBodySchema>;
export type ToolApprovalDecisionBody = z.infer<
  typeof toolApprovalDecisionBodySchema
>;
export type ChatPostBody = z.infer<typeof chatPostBodySchema>;
export type ChatGetQuery = z.infer<typeof chatGetQuerySchema>;

export {
  sessionIdSchema,
  runIdSchema,
  proposalIdSchema,
  approvalIdSchema,
};
