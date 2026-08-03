export const API_LIMITS = {
  maxJsonDepth: 8,
  maxBodyBytes: 1_048_576,
  maxMessageContentLength: 32_000,
  maxMessagesPerRequest: 40,
  maxSessionIdLength: 128,
  maxRunIdLength: 128,
  maxApprovalIdLength: 128,
  maxProposalIdLength: 128,
  maxReasonLength: 2_000,
  maxPatchFiles: 50,
  maxPatchFileContentLength: 500_000,
  maxPatchFilePathLength: 512,
} as const;
