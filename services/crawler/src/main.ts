import { Crawler } from "./crawler/main.ts";
import Frontier from "./url-frontier/frontier.ts";
import server from "./http/main.ts";

async function startup() {
    const frontier = new Frontier();
    const crawler = new Crawler(frontier, {
        maxDepth: 1,
        maxPages: 1,
        concurrency: 1,
        allowedDomains: ["wagslane.dev", "toscrape.com"],
        maxPagesPerDomain: 1,
    });
 
    crawler.seed(["http://wagslane.dev", "https://books.toscrape.com"]);

    server.listen(3030, () => {
        console.log("server is listening on localhost:3030")
    });

    crawler.run();
}

startup();