export interface RobotsRules {
    isAllowed(url: string): boolean;
    crawlDelayMs?: number | undefined;
}

export interface RobotsPolicy {
    load(origin: string): Promise<RobotsRules>;
}

export const ALLOW_ALL: RobotsRules = { isAllowed: () => true };

interface Rule {
    allow: boolean;
    re: RegExp;
    length: number;
}

interface Group {
    agents: string[];
    rules: Rule[];
    delayMs?: number;
}

const escapeRegex = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

function compile(pattern: string): RegExp {
  let p = pattern;
  let anchored = false;
  if (p.endsWith("$")) {
    anchored = true;
    p = p.slice(0, -1);
  }
  return new RegExp("^" + p.split("*").map(escapeRegex).join(".*") + (anchored ? "$" : ""));
}

export function parseRobotsTxt(text: string, userAgent: string): RobotsRules {
    const ua = userAgent.toLowerCase().split("/")[0]?.trim();
    const groups: Group[] = [];
    let cur: Group | null = null;
    let lastWasAgent = false;

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.replace(/#.*$/, "").trim();
        const idx = line.indexOf(":");
        if (!line || idx < 0) continue;
        const field = line.slice(0, idx).trim().toLowerCase();
        const value = line.slice(idx + 1).trim();

        if (field === "user-agent") {
            if (!cur || !lastWasAgent) {
                cur = { agents: [], rules: [] };
                groups.push(cur);
            }
            cur.agents.push(value.toLowerCase());
            lastWasAgent = true;
            continue;
        }

        lastWasAgent = false;
        if (!cur) 
            continue;

        if (field === "allow" || field === "disallow") {
            if (value) 
                cur.rules.push({ allow: field === "allow", re: compile(value), length: value.length });
        } else if (field === "crawl-delay") {
            const n = Number(value);
            if (Number.isFinite(n) && n >= 0) cur.delayMs = n * 1000;
        }
    }

    const specificity = (g: Group) =>
        Math.max(-1, ...g.agents.map((a) => (a === "*" ? 0 : a && ua?.includes(a) ? a.length : -1)));
    const best = Math.max(-1, ...groups.map(specificity));
    const matched = best >= 0 ? groups.filter((g) => specificity(g) === best) : [];
    const rules = matched.flatMap((g) => g.rules);
    const crawlDelayMs = matched.find((g) => g.delayMs !== undefined)?.delayMs;

    return {
        crawlDelayMs,
        isAllowed(url: string): boolean {
            let u: URL;
            try {
                u = new URL(url);
            } catch {
                return false;
            }
            const path = u.pathname + u.search;
            let winner: Rule | null = null;
            for (const r of rules) {
                if (!r.re.test(path)) continue;
                if (!winner || r.length > winner.length || (r.length === winner.length && r.allow && !winner.allow)) winner = r;
            }
            return winner ? winner.allow : true;
        },
    };
}

export class HttpRobotsPolicy implements RobotsPolicy {
    private readonly userAgent: string;
    private readonly fetchImpl: typeof fetch;
    private readonly timeoutMs: number;

    constructor(
        userAgent: string,
        fetchImpl: typeof fetch = fetch,
        timeoutMs = 10_000,
    ) {
        this.userAgent = userAgent;
        this.fetchImpl = fetchImpl;
        this.timeoutMs = timeoutMs;
    }

    async load(origin: string): Promise<RobotsRules> {
        let url = `${origin}/robots.txt`;
        for (let hop = 0; hop <= 5; hop++) {
            const res = await this.fetchImpl(url, {
                redirect: "manual",
                headers: { "user-agent": this.userAgent },
                signal: AbortSignal.timeout(this.timeoutMs),
            });
            if (res.status >= 300 && res.status < 400) {
                const loc = res.headers.get("location");
                if (!loc) throw new Error("robots.txt redirect without Location");
                const next = new URL(loc, url);
                if (next.origin !== origin) throw new Error("cross-origin robots.txt redirect");
                url = next.href;
                continue;
            }
            if (res.status === 429 || res.status >= 500) throw new Error(`robots.txt HTTP ${res.status}`);
            if (res.status >= 400) return ALLOW_ALL; // no robots.txt => no restrictions
            return parseRobotsTxt((await res.text()).slice(0, 512 * 1024), this.userAgent);
        }
        throw new Error("too many robots.txt redirects");
    }  
}