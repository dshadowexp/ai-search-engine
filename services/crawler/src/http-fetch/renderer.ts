export interface RenderSignals { 
    textChars: number; 
    linkCount: number; 
    scriptCount: number;
    emptyAppRoot: boolean; 
    noscriptHint: boolean 
}

export const needsRender = (s: RenderSignals) =>
  s.emptyAppRoot || (s.textChars < 200 && s.scriptCount >= 3) || (s.noscriptHint && s.textChars < 500);

export interface Renderer {
  render(url: string, o: { signal?: AbortSignal }): Promise<RenderedPage>;
  close(): Promise<void>;
}

interface RenderedPage { 
    url: string; finalUrl: string; statusCode: number; html: string;
    requests: number; blockedRequests: number; renderMs: number 
}

// class RenderError extends Error { 
//     kind: "timeout" | "blocked" | "crashed" | "navigation"; 
//     retryable: boolean 
// }