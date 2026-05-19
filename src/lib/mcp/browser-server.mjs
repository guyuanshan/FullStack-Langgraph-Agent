import { lookup } from "node:dns/promises";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "browser-mcp-server",
  version: "1.0.0",
});

const timeoutMs = Number.parseInt(process.env.BROWSER_TIMEOUT_MS ?? "10000", 10);
const maxTextChars = Number.parseInt(
  process.env.BROWSER_MAX_TEXT_CHARS ?? "20000",
  10
);
const maxLinkCount = Number.parseInt(
  process.env.BROWSER_MAX_LINK_COUNT ?? "200",
  10
);
const maxScreenshotBytes = Number.parseInt(
  process.env.BROWSER_MAX_SCREENSHOT_BYTES ?? "450000",
  10
);
const maxRedirects = Number.parseInt(
  process.env.BROWSER_MAX_REDIRECTS ?? "5",
  10
);
const maxPageHeight = Number.parseInt(
  process.env.BROWSER_MAX_PAGE_HEIGHT ?? "6000",
  10
);
const screenshotDir = path.join(process.cwd(), ".demo-output", "browser");
const browserExecutablePath =
  process.env.BROWSER_EXECUTABLE_PATH?.trim() ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const allowlist = (process.env.BROWSER_DOMAIN_ALLOWLIST ?? "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const blocklist = (
  process.env.BROWSER_DOMAIN_BLOCKLIST ??
  "localhost,127.0.0.1,0.0.0.0,::1,.local"
)
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

let browserPromise = null;
const browserSessions = new Map();

function makeTextResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload,
  };
}

function normalizeSessionId(inputSessionId) {
  const trimmed = typeof inputSessionId === "string" ? inputSessionId.trim() : "";
  return trimmed || "default-browser-session";
}

function matchesDomainRule(hostname, rules) {
  const normalizedHostname = hostname.toLowerCase();
  return rules.some((rule) => {
    if (rule.startsWith(".")) {
      return (
        normalizedHostname === rule.slice(1) ||
        normalizedHostname.endsWith(rule)
      );
    }

    return (
      normalizedHostname === rule ||
      normalizedHostname.endsWith(`.${rule}`)
    );
  });
}

function isPrivateIpv4(address) {
  return (
    address.startsWith("10.") ||
    address.startsWith("127.") ||
    address.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(address) ||
    address === "0.0.0.0"
  );
}

function isPrivateIpv6(address) {
  const normalizedAddress = address.toLowerCase();
  return (
    normalizedAddress === "::1" ||
    normalizedAddress.startsWith("fc") ||
    normalizedAddress.startsWith("fd") ||
    normalizedAddress.startsWith("fe80:")
  );
}

function isPrivateAddress(address) {
  return address.includes(":")
    ? isPrivateIpv6(address)
    : isPrivateIpv4(address);
}

async function assertSafeUrl(inputUrl) {
  let parsedUrl;

  try {
    parsedUrl = new URL(inputUrl);
  } catch {
    throw new Error("Invalid URL");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed");
  }

  if (matchesDomainRule(parsedUrl.hostname, blocklist)) {
    throw new Error("Access to this hostname is blocked");
  }

  if (allowlist.length > 0 && !matchesDomainRule(parsedUrl.hostname, allowlist)) {
    throw new Error("This hostname is not in the browser allowlist");
  }

  const dnsResults = await lookup(parsedUrl.hostname, {
    all: true,
    verbatim: true,
  }).catch(() => []);

  if (dnsResults.some((result) => isPrivateAddress(result.address))) {
    throw new Error("Access to private or local network addresses is blocked");
  }

  return parsedUrl;
}

function countRedirects(request) {
  let redirects = 0;
  let current = request;

  while (current?.redirectedFrom()) {
    redirects += 1;
    current = current.redirectedFrom();
  }

  return redirects;
}

function truncateText(text, maxChars) {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars)}\n...[truncated]`;
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch(
      existsSync(browserExecutablePath)
        ? {
            headless: true,
            executablePath: browserExecutablePath,
          }
        : {
            headless: true,
          }
    );
  }

  return browserPromise;
}

async function buildSessionState(sessionId) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    javaScriptEnabled: true,
    ignoreHTTPSErrors: false,
    viewport: {
      width: 1440,
      height: 1024,
    },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);
  const sessionState = {
    sessionId,
    context,
    page,
  };
  browserSessions.set(sessionId, sessionState);
  return sessionState;
}

async function getSessionState(inputSessionId) {
  const sessionId = normalizeSessionId(inputSessionId);
  const currentSession = browserSessions.get(sessionId);

  if (currentSession) {
    return currentSession;
  }

  return buildSessionState(sessionId);
}

async function closeSession(inputSessionId) {
  const sessionId = normalizeSessionId(inputSessionId);
  const currentSession = browserSessions.get(sessionId);

  if (!currentSession) {
    return false;
  }

  await currentSession.page.close().catch(() => undefined);
  await currentSession.context.close().catch(() => undefined);
  browserSessions.delete(sessionId);
  return true;
}

async function ensureCurrentPage(inputSessionId) {
  const sessionState = await getSessionState(inputSessionId);
  const currentUrl = sessionState.page.url();

  if (!currentUrl || currentUrl === "about:blank") {
    throw new Error("No page is open. Call browser_open_url first.");
  }

  await assertSafeUrl(currentUrl);
  return sessionState;
}

async function readLocatorText(page, selector, maxChars) {
  const text = selector
    ? await page.locator(selector).innerText()
    : await page.locator("body").innerText();

  return truncateText(text, maxChars);
}

async function toScreenshotPayload(page, selector, fullPage) {
  await mkdir(screenshotDir, { recursive: true });

  if (fullPage) {
    const metrics = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
    }));

    if (metrics.scrollHeight > maxPageHeight) {
      throw new Error(`Page height exceeds screenshot limit (${maxPageHeight}px)`);
    }
  }

  const fileName = `screenshot-${Date.now()}.png`;
  const filePath = path.join(screenshotDir, fileName);

  if (selector) {
    await page.locator(selector).screenshot({ path: filePath });
  } else {
    await page.screenshot({
      path: filePath,
      fullPage,
    });
  }

  const screenshotStat = await stat(filePath);

  if (screenshotStat.size > maxScreenshotBytes) {
    throw new Error(
      `Screenshot exceeds size limit (${maxScreenshotBytes} bytes)`
    );
  }

  const screenshotBytes = await readFile(filePath);

  return {
    filePath,
    bytes: screenshotStat.size,
    previewDataUrl: `data:image/png;base64,${screenshotBytes.toString("base64")}`,
  };
}

const browserSessionSchema = {
  browserSessionId: z
    .string()
    .optional()
    .describe("Internal browser session id. Usually injected by runtime."),
};

server.registerTool(
  "browser_open_url",
  {
    description: "Open a public webpage in a Playwright browser session.",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      url: z.string().url().describe("Public http or https URL to open"),
      ...browserSessionSchema,
    },
  },
  async ({ url, browserSessionId }) => {
    const parsedUrl = await assertSafeUrl(url);
    const sessionState = await getSessionState(browserSessionId);
    const response = await sessionState.page.goto(parsedUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    await assertSafeUrl(sessionState.page.url());
    const redirectCount = response ? countRedirects(response.request()) : 0;

    if (redirectCount > maxRedirects) {
      throw new Error(`Too many redirects (${redirectCount})`);
    }

    return makeTextResult({
      sessionId: sessionState.sessionId,
      url: sessionState.page.url(),
      title: await sessionState.page.title(),
      status: response?.status() ?? null,
      redirectCount,
    });
  }
);

server.registerTool(
  "browser_get_text",
  {
    description: "Extract text from the current page or a CSS selector.",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      selector: z
        .string()
        .optional()
        .describe("Optional CSS selector to scope the text extraction"),
      maxChars: z
        .number()
        .int()
        .min(100)
        .max(maxTextChars)
        .optional()
        .describe("Optional text limit override"),
      ...browserSessionSchema,
    },
  },
  async ({ selector, maxChars, browserSessionId }) => {
    const sessionState = await ensureCurrentPage(browserSessionId);
    const text = await readLocatorText(
      sessionState.page,
      selector?.trim() || undefined,
      maxChars ?? maxTextChars
    );

    return makeTextResult({
      sessionId: sessionState.sessionId,
      url: sessionState.page.url(),
      title: await sessionState.page.title(),
      selector: selector?.trim() || "body",
      text,
      textLength: text.length,
    });
  }
);

server.registerTool(
  "browser_get_links",
  {
    description: "Collect links from the current page.",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      selector: z
        .string()
        .optional()
        .describe("Optional CSS selector that contains the target links"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(maxLinkCount)
        .optional()
        .describe("Optional link count limit"),
      ...browserSessionSchema,
    },
  },
  async ({ selector, limit, browserSessionId }) => {
    const sessionState = await ensureCurrentPage(browserSessionId);
    const scope = selector?.trim() ? `${selector.trim()} a` : "a";
    const links = await sessionState.page
      .locator(scope)
      .evaluateAll((elements, maxCount) =>
        elements.slice(0, maxCount).map((element) => ({
          text: element.textContent?.trim() ?? "",
          href: element.href,
        })),
        limit ?? maxLinkCount
      );

    return makeTextResult({
      sessionId: sessionState.sessionId,
      url: sessionState.page.url(),
      title: await sessionState.page.title(),
      selector: selector?.trim() || null,
      links,
      linksCount: links.length,
    });
  }
);

server.registerTool(
  "browser_screenshot",
  {
    description: "Take a screenshot of the current page or a specific element.",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      selector: z
        .string()
        .optional()
        .describe("Optional CSS selector to screenshot instead of the full page"),
      fullPage: z
        .boolean()
        .optional()
        .describe("Whether to capture the full page"),
      ...browserSessionSchema,
    },
  },
  async ({ selector, fullPage = true, browserSessionId }) => {
    const sessionState = await ensureCurrentPage(browserSessionId);
    const screenshot = await toScreenshotPayload(
      sessionState.page,
      selector?.trim() || undefined,
      fullPage
    );

    return makeTextResult({
      sessionId: sessionState.sessionId,
      url: sessionState.page.url(),
      title: await sessionState.page.title(),
      selector: selector?.trim() || null,
      fullPage,
      ...screenshot,
    });
  }
);

server.registerTool(
  "browser_click",
  {
    description: "Click a CSS selector on the current page.",
    annotations: {
      destructiveHint: true,
    },
    inputSchema: {
      selector: z.string().describe("CSS selector to click"),
      ...browserSessionSchema,
    },
  },
  async ({ selector, browserSessionId }) => {
    const sessionState = await ensureCurrentPage(browserSessionId);
    await sessionState.page.locator(selector).click({ timeout: timeoutMs });
    await sessionState.page
      .waitForLoadState("domcontentloaded", { timeout: timeoutMs })
      .catch(() => undefined);
    await assertSafeUrl(sessionState.page.url());

    return makeTextResult({
      sessionId: sessionState.sessionId,
      url: sessionState.page.url(),
      title: await sessionState.page.title(),
      selector,
    });
  }
);

server.registerTool(
  "browser_type",
  {
    description: "Type text into an input, textarea, or contenteditable element.",
    annotations: {
      destructiveHint: true,
    },
    inputSchema: {
      selector: z.string().describe("CSS selector to target"),
      text: z.string().describe("Text to type"),
      clearFirst: z
        .boolean()
        .optional()
        .describe("Whether to clear the input before typing"),
      ...browserSessionSchema,
    },
  },
  async ({ selector, text, clearFirst = true, browserSessionId }) => {
    const sessionState = await ensureCurrentPage(browserSessionId);
    const locator = sessionState.page.locator(selector);
    await locator.click({ timeout: timeoutMs });

    if (clearFirst) {
      await locator.fill("");
    }

    await locator.type(text, { timeout: timeoutMs });

    return makeTextResult({
      sessionId: sessionState.sessionId,
      url: sessionState.page.url(),
      title: await sessionState.page.title(),
      selector,
      typedLength: text.length,
    });
  }
);

server.registerTool(
  "browser_submit",
  {
    description: "Submit a form or click a submit control on the current page.",
    annotations: {
      destructiveHint: true,
    },
    inputSchema: {
      selector: z
        .string()
        .describe("CSS selector for a form or submit control"),
      ...browserSessionSchema,
    },
  },
  async ({ selector, browserSessionId }) => {
    const sessionState = await ensureCurrentPage(browserSessionId);
    const locator = sessionState.page.locator(selector);
    const elementTag = await locator.evaluate((element) => element.tagName);

    if (typeof elementTag === "string" && elementTag.toLowerCase() === "form") {
      await locator.evaluate((form) => {
        if (form instanceof HTMLFormElement) {
          form.requestSubmit();
        }
      });
    } else {
      await locator.click({ timeout: timeoutMs });
    }

    await sessionState.page
      .waitForLoadState("domcontentloaded", { timeout: timeoutMs })
      .catch(() => undefined);
    await assertSafeUrl(sessionState.page.url());

    return makeTextResult({
      sessionId: sessionState.sessionId,
      url: sessionState.page.url(),
      title: await sessionState.page.title(),
      selector,
    });
  }
);

server.registerTool(
  "browser_reset_session",
  {
    description: "Reset the browser session context for the current conversation.",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      ...browserSessionSchema,
    },
  },
  async ({ browserSessionId }) => {
    const sessionId = normalizeSessionId(browserSessionId);
    await closeSession(sessionId);
    await buildSessionState(sessionId);

    return makeTextResult({
      sessionId,
      reset: true,
    });
  }
);

server.registerTool(
  "browser_close_session",
  {
    description: "Close the browser session context for the current conversation.",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      ...browserSessionSchema,
    },
  },
  async ({ browserSessionId }) => {
    const sessionId = normalizeSessionId(browserSessionId);
    const closed = await closeSession(sessionId);

    return makeTextResult({
      sessionId,
      closed,
    });
  }
);

const transport = new StdioServerTransport();

await server.connect(transport);
