import type { ContentKind, DocumentProcessor, ProcessedPage, ProcessInput } from "../types.ts";

export type ProcessorRegistry = Partial<Record<ContentKind, DocumentProcessor>>;

/** Dispatches each validated response to the processor registered for its detected kind. */
export class ProcessorRouter implements DocumentProcessor {
    private readonly processors: ProcessorRegistry;

    constructor(processors: ProcessorRegistry) {
        this.processors = processors;
    }

    assertSupports(kinds: readonly ContentKind[]): void {
        const missing = kinds.filter((kind) => !this.processors[kind]);
        if (missing.length > 0) {
            throw new Error(`No processor registered for supported content kind(s): ${missing.join(", ")}`);
        }
    }

    process(input: ProcessInput): ProcessedPage {
        const processor = this.processors[input.kind];
        if (!processor) {
            throw new Error(`No processor registered for content kind "${input.kind}"`);
        }
        return processor.process(input);
    }
}
