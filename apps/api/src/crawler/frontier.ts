import type { HostState } from "./types.js";

class Frontier {
    private hosts: Map<string, HostState>;

    constructor() {
        this.hosts = new Map();
    }
}