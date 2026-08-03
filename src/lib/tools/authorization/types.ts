import type { AuthContext } from "../../auth/tenant-resolution";
import type {
  ToolArgs,
  ToolPermission,
  ToolRiskLevel,
} from "../types";

export type ToolAuthorizationRequest = {
  auth: AuthContext;
  sessionId: string;
  projectId?: string;
  runId: string | null;
  stepId: string | null;
  toolCallId: string;
  toolName: string;
  args: ToolArgs;
};

export type ToolExecutionApproval = Readonly<{
  approved: true;
}>;

export type ToolPolicyDecision =
  | {
      action: "allow";
      riskLevel: "safe";
      reason: string;
    }
  | {
      action: "require_approval";
      riskLevel: Exclude<ToolRiskLevel, "safe">;
      reason: string;
      requiredRole: "member" | "admin";
    }
  | {
      action: "deny";
      riskLevel: ToolRiskLevel;
      reason: string;
    };

export type ToolAuthorization = {
  source: "local" | "mcp";
  permissions: ToolPermission[];
  summary?: string;
  decision: ToolPolicyDecision;
};

export type ToolPolicyInput = {
  auth: AuthContext;
  toolName: string;
  args: ToolArgs;
  source: "local" | "mcp";
  permissions: ToolPermission[];
  sessionId: string;
  projectId?: string;
  riskLevel?: ToolRiskLevel;
  registered: boolean;
};

export type AuthorizeAndExecuteToolInput = ToolAuthorizationRequest & {
  approval?: ToolExecutionApproval;
  /**
   * Runtime-only arguments such as progress callbacks and scoped browser/session
   * identifiers. Policy is always evaluated against the original `args`.
   */
  executionArgs?: ToolArgs;
};

export type ToolGatewayResult =
  | (ToolAuthorization & {
      status: "success";
      result: unknown;
    })
  | (ToolAuthorization & {
      status: "error";
      error: string;
    })
  | (ToolAuthorization & {
      status: "approval_required";
      error: string;
    })
  | (ToolAuthorization & {
      status: "denied";
      error: string;
    });
