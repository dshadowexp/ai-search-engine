export const USER_AGENT = "MyCrawlerBot/1.0 (+https://example.com/bot)";
export const MAX_CONTENT_BYTES = 5 * 1024 * 1024; // 5MB cap per page
export const FETCH_TIMEOUT_MS = 10_000;
export const PUPPETEER_TIMEOUT_MS = 15_000;

export const TRACKING_PARAMS = new Set([
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "fbclid",
    "gclid",
]);

// File extensions that are almost never worth crawling as "pages" —
// images, stylesheets, scripts, archives, binaries, media.
export const NON_CRAWLABLE_EXTENSIONS = new Set([
    "jpg", "jpeg", "png", "gif", "svg", "webp", "ico", "bmp",
    "css", "js", "mjs", "json", "xml",
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    "zip", "tar", "gz", "rar", "7z",
    "mp3", "mp4", "avi", "mov", "wav", "webm",
    "woff", "woff2", "ttf", "eot",
]);