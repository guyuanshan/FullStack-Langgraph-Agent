import { lookup } from "node:dns/promises";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
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
let contextPromise = null;
let pagePromise = null;

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

  const dnsResults = await lookup(parsedUrl.hostname, { all: true, verbatim: true })
    .catch(() => []);

  if (dnsResults.some((result) => isPrivateAddress(result.address))) {
    throw new Error("Access to private or local network addresses is blocked");
  }

  return parsedUrl;
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

async function getContext() {
  if (!contextPromise) {
    contextPromise = (async () => {
      const browser = await getBrowser();
      return browser.newContext({
        javaScriptEnabled: true,
        ignoreHTTPSErrors: false,
      });
    })();
  }

  return contextPromise;
}

async function getPage() {
  if (!pagePromise) {
    pagePromise = (async () => {
      const context = await getContext();
      const page = await context.newPage();
      page.setDefaultTimeout(timeoutMs);
      return page;
    })();
  }

  return pagePromise;
}

async function ensureCurrentPage() {
  const page = await getPage();
  const currentUrl = page.url();

  if (!currentUrl || currentUrl === "about:blank") {
    throw new Error("No page is open. Call browser_open_url first.");
  }

  await assertSafeUrl(currentUrl);
  return page;
}

function truncateText(text, maxChars) {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars)}\n...[truncated]`;
}

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

async function readLocatorText(page, selector) {
  if (!selector) {
    const text = await page.locator("body").innerText();
    return truncateText(text, maxTextChars);
  }

  const text = await page.locator(selector).innerText();
  return truncateText(text, maxTextChars);
}

server.registerTool(
  "browser_open_url",
  {
    description: "Open a public webpage in a Playwright browser session.",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      url: z.string().url().describe("Public http or https URL to open"),
    },
  },
  async ({ url }) => {
    const parsedUrl = await assertSafeUrl(url);
    const page = await getPage();
    const response = await page.goto(parsedUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    await assertSafeUrl(page.url());

    return makeTextResult({
      url: page.url(),
      title: await page.title(),
      status: response?.status() ?? null,
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
    },
  },
  async ({ selector, maxChars }) => {
    const page = await ensureCurrentPage();
    const text = await readLocatorText(page, selector?.trim() || undefined);

    return makeTextResult({
      url: page.url(),
      selector: selector?.trim() || "body",
      text: truncateText(text, maxChars ?? maxTextChars),
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
    },
  },
  async ({ selector, limit }) => {
    const page = await ensureCurrentPage();
    const scope = selector?.trim() ? `${selector.trim()} a` : "a";
    const links = await page.locator(scope).evaluateAll((elements, maxCount) =>
      elements.slice(0, maxCount).map((element) => ({
        text: element.textContent?.trim() ?? "",
        href: element.href,
      })),
      limit ?? maxLinkCount
    );

    return makeTextResult({
      url: page.url(),
      selector: selector?.trim() || null,
      links,
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
    },
  },
  async ({ selector, fullPage = true }) => {
    const page = await ensureCurrentPage();
    await mkdir(screenshotDir, { recursive: true });
    const fileName = `screenshot-${Date.now()}.png`;
    const filePath = path.join(screenshotDir, fileName);

    if (selector?.trim()) {
      await page.locator(selector.trim()).screenshot({ path: filePath });
    } else {
      await page.screenshot({
        path: filePath,
        fullPage,
      });
    }

    return makeTextResult({
      url: page.url(),
      selector: selector?.trim() || null,
      filePath,
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
    },
  },
  async ({ selector }) => {
    const page = await ensureCurrentPage();
    const locator = page.locator(selector);
    await locator.click({ timeout: timeoutMs });
    await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs }).catch(
      () => undefined
    );
    await assertSafeUrl(page.url());

    return makeTextResult({
      url: page.url(),
      selector,
      title: await page.title(),
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
    },
  },
  async ({ selector, text, clearFirst = true }) => {
    const page = await ensureCurrentPage();
    const locator = page.locator(selector);

    await locator.click({ timeout: timeoutMs });

    if (clearFirst) {
      await locator.fill("");
    }

    await locator.type(text, { timeout: timeoutMs });

    return makeTextResult({
      url: page.url(),
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
    },
  },
  async ({ selector }) => {
    const page = await ensureCurrentPage();
    const locator = page.locator(selector);
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

    await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs }).catch(
      () => undefined
    );
    await assertSafeUrl(page.url());

    return makeTextResult({
      url: page.url(),
      selector,
      title: await page.title(),
    });
  }
);

const transport = new StdioServerTransport();

await server.connect(transport);
