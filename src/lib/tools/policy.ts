import type { AuthContext } from "../auth/tenant-resolution";
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
  /\bprod(?:uction)?\b/i,
  /secret/i,
  /credential/i,
  /api[ _-]?key/i,
  /token/i,
];
const SENSITIVE_FILE_PATTERNS = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)(?:id_rsa|id_ed25519)(?:\.|$)/i,
  /(^|\/)(?:credentials?|secrets?)(?:\.|\/|$)/i,
  /\.(?:pem|p12|pfx|key)$/i,
];
const HIGH_RISK_BROWSER_DOMAINS = (
  process.env.BROWSER_HIGH_RISK_DOMAINS ??
  "accounts.google.com,login.microsoftonline.com,github.com,checkout.stripe.com,paypal.com"
)
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

function matchesHostname(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function valuesFromArgs(args: Record<string, unknown>) {
  return Object.values(args).flatMap((value) =>
    Array.isArray(value) ? value : [value]
  );
}

function shouldElevateBrowserRisk(args: Record<string, unknown>) {
  return valuesFromArgs(args).some(
    (value) =>
      typeof value === "string" &&
      DANGEROUS_BROWSER_PATTERNS.some((pattern) => pattern.test(value))
  );
}

function parseBrowserUrl(args: Record<string, unknown>) {
  if (typeof args.url !== "string") {
    return null;
  }

  try {
    return new URL(args.url);
  } catch {
    return null;
  }
}

function isHighRiskBrowserDomain(args: Record<string, unknown>) {
  const parsed = parseBrowserUrl(args);

  if (!parsed) {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();
  return HIGH_RISK_BROWSER_DOMAINS.some((domain) =>
    matchesHostname(hostname, domain)
  );
}

function isPrivateBrowserTarget(args: Record<string, unknown>) {
  const parsed = parseBrowserUrl(args);

  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    return true;
  }

  const hostname = parsed.hostname.toLowerCase();

  return (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname.endsWith(".local") ||
    hostname.startsWith("127.") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  );
}

function requiresBrowserTargetUrl(toolName: string) {
  return (
    toolName === "browser_open_url" ||
    toolName === "browser_click" ||
    toolName === "browser_type" ||
    toolName === "browser_submit"
  );
}

function containsSensitiveFileTarget(args: Record<string, unknown>) {
  const candidates = [
    args.filePath,
    args.path,
    args.directory,
    ...(Array.isArray(args.paths) ? args.paths : []),
  ];

  return candidates.some(
    (value) =>
      typeof value === "string" &&
      SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(value.trim()))
  );
}

function hasCrossTenantArgument(
  auth: AuthContext,
  args: Record<string, unknown>
) {
  const candidates = [args.tenantId, args.targetTenantId];

  return candidates.some(
    (value) => typeof value === "string" && value !== auth.tenantId
  );
}

function hasInvalidGitTarget(
  toolName: string,
  args: Record<string, unknown>
) {
  if (!toolName.startsWith("git_")) {
    return false;
  }

  if (
    typeof args.remote === "string" &&
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(args.remote.trim())
  ) {
    return true;
  }

  const branch =
    typeof args.branchName === "string"
      ? args.branchName
      : typeof args.head === "string"
        ? args.head
        : undefined;

  return (
    typeof branch === "string" &&
    (!branch.trim() ||
      branch.startsWith("-") ||
      branch.includes("..") ||
      /[\s~^:?*[\]\\]/.test(branch))
  );
}

export function getToolPolicyDenyReason(
  toolName: string,
  auth: AuthContext,
  args: Record<string, unknown>
) {
  if (hasCrossTenantArgument(auth, args)) {
    return "Cross-tenant tool arguments are not allowed.";
  }

  if (
    (toolName.startsWith("fs_") ||
      toolName === "project_read_files" ||
      toolName === "project_memory_refresh") &&
    containsSensitiveFileTarget(args)
  ) {
    return "Access to credential or secret files is not allowed.";
  }

  if (requiresBrowserTargetUrl(toolName) && isPrivateBrowserTarget(args)) {
    return "Browser URL must be a public HTTP or HTTPS target.";
  }

  if (hasInvalidGitTarget(toolName, args)) {
    return "Git remote or branch arguments are invalid.";
  }

  return null;
}

export function resolveToolRiskLevel(
  tool: ToolDefinition,
  args: Record<string, unknown>
): ToolRiskLevel | undefined {
  const baseRiskLevel = tool.riskLevel;

  if (!baseRiskLevel) {
    return undefined;
  }

  if (
    tool.name === "browser_open_url" &&
    isHighRiskBrowserDomain(args) &&
    baseRiskLevel === "safe"
  ) {
    return "confirm_required";
  }

  if (
    (tool.name === "browser_click" ||
      tool.name === "browser_type" ||
      tool.name === "browser_submit") &&
    (shouldElevateBrowserRisk(args) || isHighRiskBrowserDomain(args))
  ) {
    return "dangerous";
  }

  return baseRiskLevel;
}

export function resolveToolPermissions(
  tool: ToolDefinition
): ToolPermission[] | undefined {
  return tool.permissions ? [...tool.permissions] : undefined;
}
