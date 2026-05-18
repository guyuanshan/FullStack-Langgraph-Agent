import type {
  ToolDefinition,
  ToolPermission,
  ToolRiskLevel,
} from "./types";

const DANGEROUS_BROWSER_PATTERNS = [
  /login/i,
  /sign[ -]?in/i,
  /password/i,
  /passcode/i,
  /\botp\b/i,
  /\b2fa\b/i,
  /payment/i,
  /checkout/i,
  /\bcard\b/i,
  /\bcvv\b/i,
  /delete/i,
  /remove/i,
  /destroy/i,
  /unsubscribe/i,
];

function shouldElevateBrowserRisk(args: Record<string, unknown>) {
  const values = [
    args.url,
    args.selector,
    args.text,
    args.placeholder,
    args.label,
    args.submitText,
  ];

  return values.some(
    (value) =>
      typeof value === "string" &&
      DANGEROUS_BROWSER_PATTERNS.some((pattern) => pattern.test(value))
  );
}

export function resolveToolRiskLevel(
  tool: ToolDefinition | undefined,
  args: Record<string, unknown>
): ToolRiskLevel {
  const baseRiskLevel = tool?.riskLevel ?? "safe";

  if (
    tool?.name &&
    (tool.name === "browser_click" ||
      tool.name === "browser_type" ||
      tool.name === "browser_submit") &&
    shouldElevateBrowserRisk(args)
  ) {
    return "dangerous";
  }

  return baseRiskLevel;
}

export function resolveToolPermissions(
  tool: ToolDefinition | undefined
): ToolPermission[] {
  return tool?.permissions ?? [];
}
